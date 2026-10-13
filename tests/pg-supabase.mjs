/**
 * Supabase de teste com Postgres DE VERDADE (PGlite, em memória) por trás de um PostgREST mínimo.
 * Roda todos os arquivos supabase/*.sql (tabelas, regras, funções) e carrega os dados de teste,
 * então as funções do banco (movimentações, reservas, entregas, notas fiscais…) são testadas de verdade.
 *
 * Uso: node tests/pg-supabase.mjs [porta]
 *   NOCAT=1 NOMEM=1 NOCOMPRAS=1 NOP3=1  → simula o banco sem o respectivo arquivo .sql
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { buildSeed } from './seed.mjs';

const PORT = Number(process.argv[2] || 54321);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'supabase');
const env = (k) => process.env[k] === '1';
const NOCAT = env('NOCAT');

const pg = new PGlite();
const sqlFiles = [
  'schema.sql',
  'estoque.sql',
  'baixa_e_usuarios.sql',
  'maxhub.sql',
  ...(NOCAT ? [] : ['categorias.sql']),
  ...(env('NOMEM') ? [] : ['max_aprendizado.sql']),
  ...(env('NOCOMPRAS') ? [] : ['compras.sql']),
  ...(env('NOP3') || !fs.existsSync(path.join(ROOT, 'projeto3.sql')) ? [] : ['projeto3.sql']),
];

/* ------------------------------------------------------------------ */
/* preparo do banco                                                    */
/* ------------------------------------------------------------------ */
const types = new Map(); // tabela → coluna → { udt, generated }
async function loadTypes() {
  types.clear();
  const r = await pg.query(`select table_name, column_name, udt_name, is_generated, identity_generation
                              from information_schema.columns where table_schema = 'public'`);
  for (const c of r.rows) {
    if (!types.has(c.table_name)) types.set(c.table_name, new Map());
    types.get(c.table_name).set(c.column_name, { udt: c.udt_name, generated: c.is_generated === 'ALWAYS', identity: c.identity_generation === 'ALWAYS' });
  }
}

async function setup() {
  await pg.exec('create role anon; create role authenticated; create role service_role;');
  for (const f of sqlFiles) {
    const sql = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/create extension[^;]*;/gi, '').replace(/notify pgrst[^;]*;/gi, '');
    try {
      await pg.exec(sql);
    } catch (e) {
      console.error(`ERRO ao rodar ${f}:`, e.message);
      process.exit(1);
    }
  }
  // os .sql criam usuários reais (neilton, juliana, master); nos testes usamos os nossos
  await pg.exec('delete from public.admins');
  await loadTypes();
  const seed = buildSeed({ NOCAT });
  const order = ['admins', 'authorized_emails', 'postos', 'stock_items', 'posto_stock', 'requests', 'stock_movements'];
  for (const table of order) for (const row of seed[table] ?? []) await insertRow(table, row, { seed: true });
  // números automáticos (ref, protocolo…) continuam depois dos dados de teste
  for (const [table, cols] of types) {
    for (const [col, t] of cols) {
      if (t.identity) await pg.query(`select setval(pg_get_serial_sequence('public.${table}', '${col}'), greatest(1, (select coalesce(max("${col}"), 0) from public.${table})), (select count(*) > 0 from public.${table}))`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* conversões JS ⇄ Postgres                                           */
/* ------------------------------------------------------------------ */
function colInfo(table, col) {
  return types.get(table)?.get(col);
}
function toParam(table, col, v) {
  const t = colInfo(table, col);
  if (v === null || v === undefined) return { sql: 'null', value: undefined };
  if (!t) return { sql: '$', value: typeof v === 'object' ? JSON.stringify(v) : v };
  if (t.udt === 'jsonb' || t.udt === 'json') return { sql: `$::${t.udt}`, value: JSON.stringify(v) };
  if (t.udt.startsWith('_')) return { sql: `$::${t.udt.slice(1)}[]`, value: Array.isArray(v) ? v : [v] };
  return { sql: `$::${t.udt}`, value: typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v };
}
function fromRow(table, row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === '__ctid') continue;
    const t = colInfo(table, k);
    if (v instanceof Date) out[k] = t?.udt === 'date' ? v.toISOString().slice(0, 10) : v.toISOString();
    else if (typeof v === 'bigint') out[k] = Number(v);
    else if (t?.udt === 'numeric' && typeof v === 'string') out[k] = Number(v);
    else out[k] = v;
  }
  return out;
}
function pgError(e) {
  return { code: e.code || 'XX000', message: e.message, details: e.detail ?? null, hint: e.hint ?? null };
}

async function insertRow(table, row, { seed = false, conflict = null, merge = false } = {}) {
  const cols = Object.keys(row).filter((k) => {
    const t = colInfo(table, k);
    if (!t) return false; // coluna que não existe neste banco: ignorada (o PostgREST recusaria; ver badColumn)
    if (t.generated) return false;
    if (t.identity && !seed) return false;
    return true;
  });
  const params = [];
  const vals = cols.map((c) => {
    const p = toParam(table, c, row[c]);
    if (p.sql === 'null') return 'null';
    params.push(p.value);
    return p.sql.replace('$', '$' + params.length);
  });
  const overriding = seed && cols.some((c) => colInfo(table, c)?.identity) ? ' overriding system value' : '';
  let sql = cols.length ? `insert into public.${table} (${cols.map((c) => `"${c}"`).join(',')})${overriding} values (${vals.join(',')})` : `insert into public.${table} default values`;
  if (conflict) {
    const keys = conflict.split(',').map((c) => `"${c.trim()}"`).join(',');
    const upd = cols.filter((c) => !conflict.split(',').map((x) => x.trim()).includes(c));
    sql += merge && upd.length ? ` on conflict (${keys}) do update set ${upd.map((c) => `"${c}" = excluded."${c}"`).join(',')}` : ` on conflict (${keys}) do nothing`;
  }
  sql += ' returning *';
  const r = await pg.query(sql, params);
  return r.rows.map((x) => fromRow(table, x));
}

/* ------------------------------------------------------------------ */
/* filtros no estilo PostgREST (aplicados em JS sobre as linhas)       */
/* ------------------------------------------------------------------ */
function cast(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null') return null;
  return v;
}
const str = (a) => (a === null || a === undefined ? '' : typeof a === 'object' ? JSON.stringify(a) : String(a));
function cmpVal(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (a !== '' && b !== '' && !Number.isNaN(na) && !Number.isNaN(nb) && typeof a !== 'boolean') return na - nb;
  return str(a) < str(b) ? -1 : str(a) > str(b) ? 1 : 0;
}
function test(r, k, op, val) {
  const a = r[k];
  switch (op) {
    case 'eq':
      return str(a) === val;
    case 'neq':
      return str(a) !== val;
    case 'gt':
      return a !== null && cmpVal(a, val) > 0;
    case 'gte':
      return a !== null && cmpVal(a, val) >= 0;
    case 'lt':
      return a !== null && cmpVal(a, val) < 0;
    case 'lte':
      return a !== null && cmpVal(a, val) <= 0;
    case 'is':
      return (a ?? null) === cast(val);
    case 'in': {
      const set = val.replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, ''));
      return set.includes(str(a));
    }
    case 'like':
    case 'ilike': {
      const re = new RegExp('^' + val.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/%/g, '.*') + '$', op === 'ilike' ? 'i' : '');
      return re.test(str(a));
    }
    case 'cs': {
      const want = val.startsWith('{') ? val.replace(/^\{|\}$/g, '').split(',').filter(Boolean).map((x) => x.replace(/^"|"$/g, '')) : JSON.parse(val);
      if (Array.isArray(a)) return (Array.isArray(want) ? want : [want]).every((w) => a.map(String).includes(String(w)));
      if (a && typeof a === 'object') return Object.entries(want).every(([kk, vv]) => JSON.stringify(a[kk]) === JSON.stringify(vv));
      return false;
    }
    default:
      return true;
  }
}
function filterRows(rows, params) {
  let out = rows;
  for (const [k, raw] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
    if (k === 'or') {
      const parts = raw.replace(/^\(|\)$/g, '').split(',');
      out = out.filter((r) => parts.some((p) => {
        const [col, op, ...rest] = p.split('.');
        return test(r, col, op, rest.join('.'));
      }));
      continue;
    }
    const dot = raw.indexOf('.');
    let op = raw.slice(0, dot);
    let val = raw.slice(dot + 1);
    let neg = false;
    if (op === 'not') {
      neg = true;
      const d2 = val.indexOf('.');
      op = val.slice(0, d2);
      val = val.slice(d2 + 1);
    }
    out = out.filter((r) => test(r, k, op, val) !== neg);
  }
  return out;
}
async function rowsOf(table) {
  const r = await pg.query(`select ctid::text as __ctid, * from public.${table}`);
  return r.rows.map((x) => ({ ...fromRow(table, x), __ctid: x.__ctid }));
}
/** select=a,b,rel(c,d) — relações por chave estrangeira simples */
const EMBED = { stock_items: ['stock_items', 'item_id'], postos: ['postos', 'posto_id'] };
async function project(table, rows, select) {
  const clean = (r) => {
    const { __ctid, ...rest } = r;
    void __ctid;
    return rest;
  };
  if (!select || select === '*') return { rows: rows.map(clean) };
  const cols = [];
  let depth = 0;
  let cur = '';
  for (const ch of select) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      cols.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) cols.push(cur.trim());
  const known = types.get(table);
  for (const c of cols) {
    const name = c.split('(')[0].split(':')[0].trim();
    if (!c.includes('(') && name !== '*' && known && !known.has(name)) {
      return { error: { code: '42703', message: `column ${table}.${name} does not exist` } };
    }
  }
  const rel = {};
  for (const c of cols) {
    const m = c.match(/^(\w+)\((.*)\)$/);
    if (m && EMBED[m[1]]) rel[m[1]] = await rowsOf(EMBED[m[1]][0]);
  }
  return {
    rows: rows.map((r) => {
      const o = {};
      for (const c of cols) {
        const m = c.match(/^(\w+)\((.*)\)$/);
        if (m && EMBED[m[1]]) {
          const [, fk] = EMBED[m[1]];
          const hit = rel[m[1]].find((x) => x.id === r[fk]);
          o[m[1]] = hit ? Object.fromEntries(m[2].split(',').map((k) => [k.trim(), hit[k.trim()]])) : null;
        } else if (c === '*') Object.assign(o, clean(r));
        else o[c] = r[c] === undefined ? null : r[c];
      }
      return o;
    }),
  };
}

/* ------------------------------------------------------------------ */
/* servidor                                                            */
/* ------------------------------------------------------------------ */
function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
}
const statusOf = (e) => (e.code === '23505' ? 409 : e.code === '42P01' ? 404 : 400);

let queue = Promise.resolve();
const serial = (fn) => {
  const p = queue.then(fn, fn);
  queue = p.catch(() => undefined);
  return p;
};

async function handle(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204);
  const url = new URL(req.url, 'http://x');
  let raw = '';
  for await (const c of req) raw += c;
  const body = raw ? JSON.parse(raw) : null;
  if (url.pathname.startsWith('/realtime/')) return send(res, 202, {});

  // ---------- funções (rpc) ----------
  const fn = url.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/);
  if (fn) {
    const args = body && typeof body === 'object' ? body : {};
    const keys = Object.keys(args);
    const params = keys.map((k) => (args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k]));
    try {
      const r = await pg.query(`select * from public.${fn[1]}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')})`, params);
      if (r.fields.length === 1 && r.fields[0].name === fn[1]) {
        const v = r.rows[0]?.[fn[1]];
        return send(res, 200, typeof v === 'bigint' ? Number(v) : v ?? null);
      }
      return send(res, 200, r.rows.map((x) => fromRow('', x)));
    } catch (e) {
      if (/function .* does not exist/i.test(e.message)) return send(res, 404, { code: 'PGRST202', message: e.message });
      return send(res, statusOf(e), pgError(e));
    }
  }

  const m = url.pathname.match(/^\/rest\/v1\/(\w+)$/);
  if (!m || !types.has(m[1])) return send(res, 404, { code: '42P01', message: `relation "public.${m?.[1]}" does not exist` });
  const table = m[1];
  const params = [...url.searchParams];
  const select = url.searchParams.get('select');
  const prefer = req.headers.prefer || '';
  const wantObject = (req.headers.accept || '').includes('vnd.pgrst.object');
  const reply = async (rows, status = 200) => {
    const p = await project(table, rows, select);
    if (p.error) return send(res, 400, p.error);
    if (wantObject) {
      if (p.rows.length !== 1) return send(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${p.rows.length} rows` });
      return send(res, status, p.rows[0]);
    }
    return send(res, status, p.rows);
  };
  const badColumn = (obj) => Object.keys(obj).find((k) => !types.get(table).has(k));

  try {
    if (req.method === 'GET' || req.method === 'HEAD') {
      let rows = filterRows(await rowsOf(table), params);
      for (const ord of (url.searchParams.getAll('order').join(',') || '').split(',').filter(Boolean).reverse()) {
        const [col, dir, nulls] = ord.split('.');
        rows = [...rows].sort((a, b) => {
          const av = a[col];
          const bv = b[col];
          if (av === null && bv !== null) return nulls === 'nullsfirst' ? -1 : 1;
          if (bv === null && av !== null) return nulls === 'nullsfirst' ? 1 : -1;
          return cmpVal(av, bv) * (dir === 'desc' ? -1 : 1);
        });
      }
      const total = rows.length;
      const offset = Number(url.searchParams.get('offset') || 0);
      const limit = url.searchParams.get('limit');
      rows = rows.slice(offset, limit ? offset + Number(limit) : undefined);
      if (prefer.includes('count=exact')) res.setHeader('Content-Range', `${offset}-${offset + rows.length - 1}/${total}`);
      return reply(rows);
    }
    if (req.method === 'POST') {
      const list = Array.isArray(body) ? body : [body];
      const bad = list.map(badColumn).find(Boolean);
      if (bad) return send(res, 400, { code: 'PGRST204', message: `Could not find the '${bad}' column of '${table}' in the schema cache` });
      const conflict = url.searchParams.get('on_conflict');
      const created = [];
      await pg.exec('begin');
      try {
        for (const row of list) {
          created.push(...(await insertRow(table, row, { conflict: conflict ?? (prefer.includes('ignore-duplicates') ? null : null), merge: prefer.includes('merge-duplicates') })));
        }
        await pg.exec('commit');
      } catch (e) {
        await pg.exec('rollback');
        throw e;
      }
      return prefer.includes('return=representation') ? reply(created, 201) : send(res, 201);
    }
    if (req.method === 'PATCH') {
      const bad = badColumn(body);
      if (bad) return send(res, 400, { code: 'PGRST204', message: `Could not find the '${bad}' column of '${table}' in the schema cache` });
      const rows = filterRows(await rowsOf(table), params);
      if (!rows.length) return prefer.includes('return=representation') ? reply([]) : send(res, 204);
      const sets = [];
      const vals = [];
      for (const [k, v] of Object.entries(body)) {
        const p = toParam(table, k, v);
        if (p.sql === 'null') sets.push(`"${k}" = null`);
        else {
          vals.push(p.value);
          sets.push(`"${k}" = ${p.sql.replace('$', '$' + vals.length)}`);
        }
      }
      vals.push(rows.map((r) => r.__ctid));
      const r = await pg.query(`update public.${table} set ${sets.join(', ')} where ctid = any($${vals.length}::tid[]) returning *`, vals);
      return prefer.includes('return=representation') ? reply(r.rows.map((x) => fromRow(table, x))) : send(res, 204);
    }
    if (req.method === 'DELETE') {
      const rows = filterRows(await rowsOf(table), params);
      if (rows.length) await pg.query(`delete from public.${table} where ctid = any($1::tid[])`, [rows.map((r) => r.__ctid)]);
      return prefer.includes('return=representation') ? reply(rows) : send(res, 204);
    }
    return send(res, 405, { message: 'método não suportado' });
  } catch (e) {
    return send(res, statusOf(e), pgError(e));
  }
}

try {
  await setup();
} catch (e) {
  console.error('ERRO no preparo do banco de teste:', e.message, e.query ?? '');
  process.exit(1);
}
http
  .createServer((req, res) => {
    serial(() => handle(req, res)).catch((e) => {
      console.error(e);
      try {
        send(res, 500, { message: String(e.message || e) });
      } catch {
        /* resposta já enviada */
      }
    });
  })
  .listen(PORT, () => console.log(`supabase de teste (Postgres) em http://localhost:${PORT} · ${sqlFiles.join(', ')}`));
