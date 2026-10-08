/**
 * Supabase de mentira (PostgREST mínimo, em memória) para testar o Max Hub sem internet.
 * Uso: node tests/mock-supabase.mjs [porta]   ·   LEGACY=1 simula o banco sem o maxhub.sql
 */
import http from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.argv[2] || 54321);
const LEGACY = process.env.LEGACY === '1';
const NOCAT = process.env.NOCAT === '1'; // banco ainda sem o categorias.sql
const HASH = '$2b$10$c3tnk4UPkHj9.kv9pl7KsuDlaHAWcXU2EzcaZSKcTtwSADSM2pAIW'; // 123456
const now = Date.now();
const iso = (minAgo) => new Date(now - minAgo * 60000).toISOString();
const full = { solicitacoes: 'edit', estoque: 'edit', postos: 'edit', metricas: 'edit', formulario: 'edit', emails: 'edit' };
const admin = (username, display_name, extra = {}) => ({
  id: randomUUID(), username, display_name, password_hash: HASH, created_at: iso(50000), updated_at: iso(50000),
  ...(LEGACY ? { is_master: Boolean(extra.is_master) } : { is_master: false, sector: null, sector_role: 'member', permissions: {}, active: true, created_by: null, last_login_at: null, ...extra }),
});
const CATS = { 'Bota de segurança': ['Max Forte', 'EPI'], 'Camisa social manga curta': ['Max Serviços'], 'Calça tática': ['Max Forte'], 'Boné': ['Max Forte', 'Max Serviços'], 'Cinto tático': ['Acessório'], 'Colete refletivo': ['EPI'] };
const item = (ref, name, size, quantity, min_quantity = 0, cost = 25) => ({ id: randomUUID(), ref, name, size, unit: 'Cada', quantity, min_quantity, cost, ...(NOCAT ? {} : { categories: CATS[name] ?? [] }), name_key: name.toLowerCase(), size_key: (size || '').toLowerCase(), created_by: 'Neilton', created_at: iso(9000), updated_at: iso(100) });
const posto = (name, city) => ({ id: randomUUID(), name, name_key: name.toLowerCase(), code: null, city, address: null, supervisor: 'Sup. ' + name, notes: null, created_by: 'Neilton', created_at: iso(9000), updated_at: iso(9000) });

const items = [item(1, 'Bota de segurança', '40', 12, 5), item(2, 'Bota de segurança', '42', 3, 5), item(3, 'Bota de segurança', '44', 0, 5), item(4, 'Camisa social manga curta', 'G', 40, 10), item(5, 'Camisa social manga curta', 'M', 22, 10), item(6, 'Calça tática', '44', 9, 10), item(7, 'Boné', null, 70), item(8, 'Cinto tático', null, 15), item(9, 'Colete refletivo', null, 0, 2), item(10, 'Rádio comunicador', null, 6, 0, 480)];
const postos = [posto('Posto 01', 'Salvador'), posto('Posto 02', 'Lauro de Freitas'), posto('Shopping Barra', 'Salvador'), posto('Hospital Aliança', 'Salvador')];
const req = (protocol, status, collaborator, p, minAgo) => ({ id: randomUUID(), protocol, email: 'sup1@empresa.com.br', collaborator, posto: p, answers: [{ fieldId: 'motivo', label: 'Motivo', type: 'textarea', value: 'Reposição de fardamento' }], attachments: [], status, handled_by: status === 'nova' ? null : 'Neilton', created_at: iso(minAgo), updated_at: iso(minAgo), stock_applications: [] });
const mov = (i, kind, quantity, minAgo, p = null) => ({ id: randomUUID(), item_id: items[i].id, item_name: items[i].name + (items[i].size ? ' · ' + items[i].size : ''), posto_id: p ? p.id : null, posto_name: p ? p.name : null, kind, quantity, before_qty: 10, after_qty: 10, note: null, by_name: 'Neilton', created_at: iso(minAgo) });

const db = {
  admins: [
    admin('mateus', 'Mateus Quintanilha', { is_master: true }),
    admin('neilton', 'Neilton', { sector: 'almoxarifado', sector_role: 'master', permissions: full }),
    admin('juliana', 'Juliana Souza', { sector: 'almoxarifado', permissions: { ...full, estoque: 'view', postos: 'none', formulario: 'none', emails: 'none' } }),
    admin('carla', 'Carla Dias', { sector: 'rh', sector_role: 'master' }),
    admin('pedro', 'Pedro Alves', {}),
    admin('inativo', 'Usuário Inativo', { sector: 'financeiro', active: false }),
  ],
  hub_meta: [],
  authorized_emails: [{ id: randomUUID(), email: 'sup1@empresa.com.br', supervisor_name: 'Marcos', posto: 'Posto 01', created_by: 'Neilton', created_at: iso(8000) }],
  form_config: [],
  requests: [req(1, 'resolvida', 'Ana Lima', 'Posto 01', 6000), req(2, 'pendente', 'Bruno Reis', 'Posto 02', 2800), req(3, 'nova', 'Caio Melo', 'Shopping Barra', 300), req(4, 'nova', 'Dani Rocha', 'Posto 01', 40), req(12, 'pendente', 'Edu Santos', 'Hospital Aliança', 1500)],
  stock_items: items,
  postos,
  posto_stock: [{ posto_id: postos[0].id, item_id: items[0].id, quantity: 4, updated_at: iso(500) }, { posto_id: postos[0].id, item_id: items[6].id, quantity: 10, updated_at: iso(500) }, { posto_id: postos[2].id, item_id: items[3].id, quantity: 6, updated_at: iso(500) }],
  stock_movements: [mov(0, 'entrada', 20, 7000), mov(3, 'entrada', 50, 5000), mov(0, 'transferencia', 4, 2000, postos[0]), mov(6, 'transferencia', 10, 1900, postos[0]), mov(1, 'saida', 7, 900), mov(3, 'transferencia', 6, 700, postos[2]), mov(4, 'saida', 3, 200), mov(5, 'entrada', 5, 100), mov(1, 'saida', 2, 30)],
};
const HIDDEN = LEGACY ? ['sector', 'sector_role', 'permissions', 'active', 'created_by', 'last_login_at'] : [];
const EMBED = { stock_items: ['stock_items', 'item_id'], postos: ['postos', 'posto_id'] };

function cast(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null') return null;
  return v;
}
function filterRows(rows, params) {
  let out = rows;
  for (const [k, raw] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
    const dot = raw.indexOf('.');
    const op = raw.slice(0, dot);
    const val = raw.slice(dot + 1);
    const cmp = (a) => (a === null || a === undefined ? '' : String(a));
    if (op === 'eq') out = out.filter((r) => cmp(r[k]) === val);
    else if (op === 'neq') out = out.filter((r) => cmp(r[k]) !== val);
    else if (op === 'gte') out = out.filter((r) => cmp(r[k]) >= val);
    else if (op === 'lte') out = out.filter((r) => cmp(r[k]) <= val);
    else if (op === 'is') out = out.filter((r) => (r[k] ?? null) === cast(val));
    else if (op === 'in') {
      const set = val.replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, ''));
      out = out.filter((r) => set.includes(cmp(r[k])));
    }
  }
  return out;
}
function project(table, rows, select) {
  if (!select || select === '*') return { rows: rows.map((r) => ({ ...r })) };
  const cols = [];
  let depth = 0;
  let cur = '';
  for (const ch of select) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { cols.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) cols.push(cur.trim());
  for (const c of cols) {
    const name = c.split('(')[0];
    if (table === 'admins' && HIDDEN.includes(name)) return { error: { code: '42703', message: `column admins.${name} does not exist` } };
    if (NOCAT && table === 'stock_items' && name === 'categories') return { error: { code: '42703', message: 'column stock_items.categories does not exist' } };
  }
  return {
    rows: rows.map((r) => {
      const o = {};
      for (const c of cols) {
        const m = c.match(/^(\w+)\((.*)\)$/);
        if (m && EMBED[m[1]]) {
          const [t, fk] = EMBED[m[1]];
          const rel = db[t].find((x) => x.id === r[fk]);
          o[m[1]] = rel ? Object.fromEntries(m[2].split(',').map((k) => [k.trim(), rel[k.trim()]])) : null;
        } else o[c] = r[c] === undefined ? null : r[c];
      }
      return o;
    }),
  };
}
function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

http
  .createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return send(res, 204);
    const url = new URL(req.url, 'http://x');
    let raw = '';
    for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : null;
    if (url.pathname.startsWith('/realtime/')) return send(res, 202, {});
    if (url.pathname.startsWith('/rest/v1/rpc/')) return send(res, 404, { code: 'PGRST202', message: 'função não existe no banco de teste' });
    const m = url.pathname.match(/^\/rest\/v1\/(\w+)$/);
    if (!m || !db[m[1]]) return send(res, 404, { code: '42P01', message: 'relation does not exist' });
    const table = m[1];
    const params = [...url.searchParams];
    const select = url.searchParams.get('select');
    const prefer = req.headers.prefer || '';
    const wantObject = (req.headers.accept || '').includes('vnd.pgrst.object');
    const reply = (rows, status = 200) => {
      const p = project(table, rows, select);
      if (p.error) return send(res, 400, p.error);
      if (wantObject) {
        if (p.rows.length !== 1) return send(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${p.rows.length} rows` });
        return send(res, status, p.rows[0]);
      }
      return send(res, status, p.rows);
    };
    const badColumn = (obj) => (table === 'admins' ? Object.keys(obj).find((k) => HIDDEN.includes(k)) : NOCAT && table === 'stock_items' && 'categories' in obj ? 'categories' : null);

    if (req.method === 'GET') {
      let rows = filterRows(db[table], params);
      for (const ord of (url.searchParams.getAll('order').join(',') || '').split(',').filter(Boolean).reverse()) {
        const [col, dir] = ord.split('.');
        rows = [...rows].sort((a, b) => (String(a[col] ?? '') < String(b[col] ?? '') ? -1 : String(a[col] ?? '') > String(b[col] ?? '') ? 1 : 0) * (dir === 'desc' ? -1 : 1));
      }
      const offset = Number(url.searchParams.get('offset') || 0);
      const limit = url.searchParams.get('limit');
      rows = rows.slice(offset, limit ? offset + Number(limit) : undefined);
      return reply(rows);
    }
    if (req.method === 'POST') {
      const list = Array.isArray(body) ? body : [body];
      const bad = list.map(badColumn).find(Boolean);
      if (bad) return send(res, 400, { code: 'PGRST204', message: `Could not find the '${bad}' column of '${table}' in the schema cache` });
      const created = [];
      for (const row of list) {
        const unique = table === 'admins' ? 'username' : table === 'authorized_emails' ? 'email' : null;
        if (unique && db[table].some((r) => r[unique] === row[unique])) {
          if (prefer.includes('ignore-duplicates')) continue;
          return send(res, 409, { code: '23505', message: 'duplicate key value violates unique constraint' });
        }
        const full = { id: randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...(table === 'admins' && !LEGACY ? { is_master: false, sector: null, sector_role: 'member', permissions: {}, active: true, last_login_at: null } : {}), ...(table === 'stock_items' ? { ref: db.stock_items.length + 1, unit: 'Cada', quantity: 0, min_quantity: 0, cost: null, name_key: String(row.name || '').toLowerCase(), size_key: String(row.size || '').toLowerCase(), ...(NOCAT ? {} : { categories: [] }) } : {}), ...row };
        db[table].push(full);
        created.push(full);
      }
      return prefer.includes('return=representation') ? reply(created, 201) : send(res, 201);
    }
    if (req.method === 'PATCH') {
      const bad = badColumn(body);
      if (bad) return send(res, 400, { code: 'PGRST204', message: `Could not find the '${bad}' column of '${table}' in the schema cache` });
      const rows = filterRows(db[table], params);
      if (table === 'admins' && body.username && db.admins.some((r) => r.username === body.username && !rows.includes(r))) return send(res, 409, { code: '23505', message: 'duplicate key' });
      rows.forEach((r) => Object.assign(r, body));
      return prefer.includes('return=representation') ? reply(rows) : send(res, 204);
    }
    if (req.method === 'DELETE') {
      const rows = filterRows(db[table], params);
      db[table] = db[table].filter((r) => !rows.includes(r));
      return prefer.includes('return=representation') ? reply(rows) : send(res, 204);
    }
    send(res, 405, { message: 'método não suportado' });
  })
  .listen(PORT, () => console.log(`supabase de teste em http://localhost:${PORT}${LEGACY ? ' (modo legado)' : ''}`));
