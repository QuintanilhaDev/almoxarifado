import 'server-only';
import type { PoolClient } from 'pg';
import { getPool } from './pool';

/**
 * Consultas direto no Postgres com a MESMA forma de escrever do Supabase
 * (db().from('tabela').select(...).eq(...).order(...)), para o sistema inteiro
 * funcionar no servidor próprio sem reescrever cada tela.
 *
 * Cobre o que o Max Hub usa: select (com contagem e relações "tabela(colunas)"),
 * insert, update, upsert, delete, filtros eq/neq/gt/gte/lt/lte/in/is/contains/not/or,
 * order, limit, range, single, maybeSingle e rpc (funções do banco).
 * Os erros saem no mesmo formato ({ code, message, details, hint }).
 */

export type PgError = { code: string; message: string; details: string | null; hint: string | null };
type Result<T = unknown> = { data: T | null; error: PgError | null; count: number | null; status: number; statusText: string };

/* ---------------- tipos das colunas (para converter valores) ---------------- */
type Col = { udt: string; generated: boolean; identity: boolean };
let cols: Map<string, Map<string, Col>> | null = null;
let colsAt = 0;
let colsLoading: Promise<void> | null = null;
async function loadCols(force = false) {
  if (!force && cols && Date.now() - colsAt < 60_000) return;
  if (colsLoading) return colsLoading;
  colsLoading = (async () => {
    const r = await getPool().query(
      `select table_name, column_name, udt_name, is_generated, identity_generation
         from information_schema.columns where table_schema = 'public'`,
    );
    const m = new Map<string, Map<string, Col>>();
    for (const c of r.rows) {
      if (!m.has(c.table_name)) m.set(c.table_name, new Map());
      m.get(c.table_name)!.set(c.column_name, { udt: c.udt_name, generated: c.is_generated === 'ALWAYS', identity: c.identity_generation === 'ALWAYS' });
    }
    cols = m;
    colsAt = Date.now();
  })().finally(() => {
    colsLoading = null;
  });
  return colsLoading;
}
const colOf = (table: string, col: string) => cols?.get(table)?.get(col);

/* relação "outra_tabela(colunas)" no select: acha a chave estrangeira entre as duas */
const fkCache = new Map<string, { local: string; remote: string } | null>();
async function fkBetween(table: string, rel: string) {
  const key = `${table}>${rel}`;
  if (fkCache.has(key)) return fkCache.get(key)!;
  const r = await getPool().query(
    `select a.attname as local, af.attname as remote
       from pg_constraint c
       join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
       join pg_attribute af on af.attrelid = c.confrelid and af.attnum = c.confkey[1]
      where c.contype = 'f' and c.conrelid = ('public.' || $1)::regclass and c.confrelid = ('public.' || $2)::regclass
        and array_length(c.conkey, 1) = 1
      limit 1`,
    [table, rel],
  );
  const v = r.rows[0] ? { local: String(r.rows[0].local), remote: String(r.rows[0].remote) } : null;
  fkCache.set(key, v);
  return v;
}

const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
function ident(name: string): string {
  if (!IDENT.test(name)) throw Object.assign(new Error(`nome inválido: ${name}`), { code: '42602' });
  return `"${name}"`;
}

/** converte o valor para o tipo da coluna (jsonb vira texto JSON; listas viram array do Postgres) */
function param(table: string, col: string, v: unknown, params: unknown[]): string {
  if (v === undefined) return 'default';
  if (v === null) return 'null';
  const t = colOf(table, col);
  if (t && (t.udt === 'jsonb' || t.udt === 'json')) {
    params.push(JSON.stringify(v));
    return `$${params.length}::${t.udt}`;
  }
  if (t && t.udt.startsWith('_')) {
    params.push(Array.isArray(v) ? v : [v]);
    return `$${params.length}::${t.udt.slice(1)}[]`;
  }
  params.push(typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v);
  return t ? `$${params.length}::${t.udt}` : `$${params.length}`;
}

/* ---------------- filtros ---------------- */
type Filter = { sql: (table: string, params: unknown[]) => string };

function cmp(col: string, op: string, value: unknown, neg = false): Filter {
  return {
    sql: (table, params) => {
      const c = ident(col);
      let out: string;
      switch (op) {
        case 'eq':
        case 'neq':
        case 'gt':
        case 'gte':
        case 'lt':
        case 'lte': {
          const sym = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }[op];
          out = `${c} ${sym} ${param(table, col, value, params)}`;
          break;
        }
        case 'like':
        case 'ilike':
          params.push(String(value).replace(/\*/g, '%'));
          out = `${c}::text ${op} $${params.length}`;
          break;
        case 'is': {
          const v = value === null || value === 'null' ? 'null' : value === true || value === 'true' ? 'true' : value === false || value === 'false' ? 'false' : null;
          if (!v) throw Object.assign(new Error(`valor inválido para "is": ${String(value)}`), { code: '22023' });
          out = `${c} is ${v}`;
          break;
        }
        case 'in': {
          const list = Array.isArray(value)
            ? value
            : String(value)
                .replace(/^\(|\)$/g, '')
                .split(',')
                .map((x) => x.trim().replace(/^"|"$/g, ''))
                .filter((x) => x !== '');
          if (!list.length) {
            out = 'false';
            break;
          }
          const t = colOf(table, col);
          params.push(list.map((x) => (x === null ? null : String(x))));
          out = `${c}${t ? '' : '::text'} = any($${params.length}::${t && !t.udt.startsWith('_') ? t.udt : 'text'}[])`;
          break;
        }
        case 'cs': {
          const t = colOf(table, col);
          if (t && (t.udt === 'jsonb' || t.udt === 'json')) {
            params.push(JSON.stringify(value));
            out = `${c} @> $${params.length}::jsonb`;
          } else {
            const list = Array.isArray(value) ? value : String(value).replace(/^\{|\}$/g, '').split(',').filter(Boolean);
            params.push(list);
            out = `${c} @> $${params.length}::${t && t.udt.startsWith('_') ? t.udt.slice(1) : 'text'}[]`;
          }
          break;
        }
        default:
          throw Object.assign(new Error(`filtro não suportado: ${op}`), { code: '42601' });
      }
      return neg ? `not (${out})` : out;
    },
  };
}

/** "a.eq.1,b.in.(x,y),c.is.null" (sintaxe do .or do Supabase) */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}
function orFilter(expr: string): Filter {
  const parts = splitTop(expr.replace(/^\(|\)$/g, ''));
  const filters = parts.map((p) => {
    const m = p.match(/^(\w+)\.(not\.)?(\w+)\.(.*)$/);
    if (!m) throw Object.assign(new Error(`filtro "or" inválido: ${p}`), { code: '42601' });
    const [, col, not, op, raw] = m;
    const val = op === 'in' ? raw : raw === 'null' && op === 'is' ? null : raw;
    return cmp(col, op, val, Boolean(not));
  });
  return { sql: (table, params) => `(${filters.map((f) => f.sql(table, params)).join(' or ')})` };
}

/* ---------------- select com relações ---------------- */
type SelItem = { kind: 'star' } | { kind: 'col'; name: string; alias: string } | { kind: 'rel'; rel: string; alias: string; cols: string[] };
function parseSelect(sel: string): SelItem[] {
  const s = sel.replace(/\s+/g, ' ').trim() || '*';
  return splitTop(s).map((p) => {
    if (p === '*') return { kind: 'star' } as const;
    const rel = p.match(/^(?:(\w+):)?(\w+)\((.*)\)$/);
    if (rel) return { kind: 'rel', alias: rel[1] || rel[2], rel: rel[2], cols: splitTop(rel[3]).map((x) => x.trim()) } as const;
    const m = p.match(/^(?:(\w+):)?(\w+)$/);
    if (!m) throw Object.assign(new Error(`select inválido: ${p}`), { code: '42601' });
    return { kind: 'col', alias: m[1] || m[2], name: m[2] } as const;
  });
}
async function selectList(table: string, sel: string, alias: string): Promise<string> {
  const items = parseSelect(sel);
  const out: string[] = [];
  for (const it of items) {
    if (it.kind === 'star') out.push(`${alias}.*`);
    else if (it.kind === 'col') out.push(`${alias}.${ident(it.name)} as ${ident(it.alias)}`);
    else {
      const fk = await fkBetween(table, it.rel);
      if (!fk) throw Object.assign(new Error(`sem relação entre ${table} e ${it.rel}`), { code: 'PGRST200' });
      const inner = it.cols.includes('*') ? `to_jsonb(r)` : `jsonb_build_object(${it.cols.map((c) => `'${c.replace(/'/g, '')}', r.${ident(c)}`).join(', ')})`;
      out.push(`(select ${inner} from public.${ident(it.rel)} r where r.${ident(fk.remote)} = ${alias}.${ident(fk.local)}) as ${ident(it.alias)}`);
    }
  }
  return out.join(', ');
}

/* ---------------- erros no formato do Supabase ---------------- */
function toError(e: unknown): PgError {
  const x = e as { code?: string; message?: string; detail?: string; hint?: string };
  return { code: String(x?.code ?? 'XX000'), message: String(x?.message ?? e), details: x?.detail ?? null, hint: x?.hint ?? null };
}
const ok = <T>(data: T | null, count: number | null = null, status = 200): Result<T> => ({ data, error: null, count, status, statusText: 'OK' });
const bad = (e: unknown): Result<never> => {
  const err = toError(e);
  const status = err.code === '23505' ? 409 : err.code === 'PGRST116' ? 406 : err.code === '42P01' ? 404 : 400;
  return { data: null, error: err, count: null, status, statusText: 'Error' };
};

/* ---------------- construtor de consultas ---------------- */
type Op = 'select' | 'insert' | 'update' | 'upsert' | 'delete';

export class Query<T = unknown> implements PromiseLike<Result<T>> {
  private op: Op = 'select';
  private sel = '*';
  private returning: string | null = null;
  private filters: Filter[] = [];
  private orders: { col: string; asc: boolean; nullsFirst?: boolean }[] = [];
  private lim: number | null = null;
  private off = 0;
  private mode: 'many' | 'single' | 'maybe' = 'many';
  private countMode: 'exact' | null = null;
  private head = false;
  private values: Record<string, unknown>[] = [];
  private patch: Record<string, unknown> = {};
  private conflict: string | null = null;
  private ignoreDup = false;

  constructor(private table: string) {}

  select(columns = '*', opts?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }) {
    if (this.op === 'select') {
      this.sel = columns;
      if (opts?.count) this.countMode = 'exact';
      if (opts?.head) this.head = true;
    } else this.returning = columns || '*';
    return this;
  }
  insert(v: Record<string, unknown> | Record<string, unknown>[]) {
    this.op = 'insert';
    this.values = Array.isArray(v) ? v : [v];
    return this;
  }
  upsert(v: Record<string, unknown> | Record<string, unknown>[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    this.op = 'upsert';
    this.values = Array.isArray(v) ? v : [v];
    this.conflict = opts?.onConflict ?? null;
    this.ignoreDup = Boolean(opts?.ignoreDuplicates);
    return this;
  }
  update(v: Record<string, unknown>) {
    this.op = 'update';
    this.patch = v;
    return this;
  }
  delete() {
    this.op = 'delete';
    return this;
  }
  eq(c: string, v: unknown) {
    this.filters.push(cmp(c, 'eq', v));
    return this;
  }
  neq(c: string, v: unknown) {
    this.filters.push(cmp(c, 'neq', v));
    return this;
  }
  gt(c: string, v: unknown) {
    this.filters.push(cmp(c, 'gt', v));
    return this;
  }
  gte(c: string, v: unknown) {
    this.filters.push(cmp(c, 'gte', v));
    return this;
  }
  lt(c: string, v: unknown) {
    this.filters.push(cmp(c, 'lt', v));
    return this;
  }
  lte(c: string, v: unknown) {
    this.filters.push(cmp(c, 'lte', v));
    return this;
  }
  like(c: string, v: string) {
    this.filters.push(cmp(c, 'like', v));
    return this;
  }
  ilike(c: string, v: string) {
    this.filters.push(cmp(c, 'ilike', v));
    return this;
  }
  is(c: string, v: unknown) {
    this.filters.push(cmp(c, 'is', v));
    return this;
  }
  in(c: string, v: readonly unknown[]) {
    this.filters.push(cmp(c, 'in', [...v]));
    return this;
  }
  contains(c: string, v: unknown) {
    this.filters.push(cmp(c, 'cs', v));
    return this;
  }
  not(c: string, op: string, v: unknown) {
    this.filters.push(cmp(c, op, v, true));
    return this;
  }
  or(expr: string) {
    this.filters.push(orFilter(expr));
    return this;
  }
  match(obj: Record<string, unknown>) {
    for (const [k, v] of Object.entries(obj)) this.filters.push(cmp(k, 'eq', v));
    return this;
  }
  filter(c: string, op: string, v: unknown) {
    this.filters.push(cmp(c, op, v));
    return this;
  }
  order(col: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) {
    this.orders.push({ col, asc: opts?.ascending ?? true, nullsFirst: opts?.nullsFirst });
    return this;
  }
  limit(n: number) {
    this.lim = n;
    return this;
  }
  range(from: number, to: number) {
    this.off = from;
    this.lim = to - from + 1;
    return this;
  }
  single() {
    this.mode = 'single';
    return this as unknown as Query<T>;
  }
  maybeSingle() {
    this.mode = 'maybe';
    return this as unknown as Query<T>;
  }
  throwOnError() {
    return this;
  }
  abortSignal() {
    return this;
  }

  private where(params: unknown[]): string {
    if (!this.filters.length) return '';
    return ' where ' + this.filters.map((f) => f.sql(this.table, params)).join(' and ');
  }

  private async run(client?: PoolClient): Promise<Result<T>> {
    const q = (text: string, values: unknown[]) => (client ?? getPool()).query(text, values);
    await loadCols();
    if (!cols?.has(this.table)) {
      // tabela criada há pouco (rodaram um .sql novo): confere de novo antes de dizer que não existe
      await loadCols(true);
      if (!cols?.has(this.table)) return bad({ code: '42P01', message: `relation "public.${this.table}" does not exist` });
    }
    const t = `public.${ident(this.table)}`;
    const params: unknown[] = [];
    let text: string;
    const ret = async () => (this.returning !== null ? ` returning ${await selectList(this.table, this.returning || '*', t)}` : '');

    if (this.op === 'select') {
      if (this.head) {
        const r = await q(`select count(*)::int as n from ${t}${this.where(params)}`, params);
        return ok<T>(null, r.rows[0].n);
      }
      text = `select ${await selectList(this.table, this.sel, 't')} from ${t} t${this.where(params)}`;
      if (this.orders.length) text += ' order by ' + this.orders.map((o) => `t.${ident(o.col)} ${o.asc ? 'asc' : 'desc'}${o.nullsFirst === undefined ? '' : o.nullsFirst ? ' nulls first' : ' nulls last'}`).join(', ');
      if (this.lim !== null) text += ` limit ${Math.max(0, Math.floor(this.lim))}`;
      if (this.off) text += ` offset ${Math.max(0, Math.floor(this.off))}`;
    } else if (this.op === 'insert' || this.op === 'upsert') {
      if (!this.values.length) return ok<T>((this.returning !== null ? [] : null) as T | null);
      const tc = cols.get(this.table)!;
      const keys = [...new Set(this.values.flatMap((v) => Object.keys(v)))].filter((k) => {
        const c = tc.get(k);
        return !(c && (c.generated || c.identity));
      });
      const rows = this.values.map((v) => `(${keys.map((k) => (k in v ? param(this.table, k, v[k], params) : 'default')).join(', ')})`);
      text = keys.length ? `insert into ${t} (${keys.map(ident).join(', ')}) values ${rows.join(', ')}` : `insert into ${t} default values`;
      if (this.op === 'upsert') {
        const target = (this.conflict ?? 'id').split(',').map((x) => x.trim());
        const upd = keys.filter((k) => !target.includes(k));
        text += ` on conflict (${target.map(ident).join(', ')}) ` + (this.ignoreDup || !upd.length ? 'do nothing' : `do update set ${upd.map((k) => `${ident(k)} = excluded.${ident(k)}`).join(', ')}`);
      }
      text += await ret();
    } else if (this.op === 'update') {
      const sets = Object.entries(this.patch)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${ident(k)} = ${param(this.table, k, v, params)}`);
      if (!sets.length) return ok<T>((this.returning !== null ? [] : null) as T | null);
      // os filtros se referem à tabela pelo nome; "t" é só um apelido para as relações do returning
      text = `update ${t} set ${sets.join(', ')}${this.where(params)}${await ret()}`;
    } else {
      text = `delete from ${t}${this.where(params)}${await ret()}`;
    }

    const r = await q(text, params);
    const wantRows = this.op === 'select' || this.returning !== null;
    if (!wantRows) return ok<T>(null, null, this.op === 'insert' || this.op === 'upsert' ? 201 : 204);
    const rows = r.rows as unknown[];
    if (this.mode === 'single') {
      if (rows.length !== 1) return bad({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', detail: `The result contains ${rows.length} rows` });
      return ok<T>(rows[0] as T);
    }
    if (this.mode === 'maybe') {
      if (rows.length > 1) return bad({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', detail: `The result contains ${rows.length} rows` });
      return ok<T>((rows[0] ?? null) as T | null);
    }
    let count: number | null = null;
    if (this.countMode && this.op === 'select') {
      const p2: unknown[] = [];
      const c = await q(`select count(*)::int as n from ${t}${this.where(p2)}`, p2);
      count = c.rows[0].n;
    }
    return ok<T>(rows as T, count);
  }

  async exec(): Promise<Result<T>> {
    try {
      return await this.run();
    } catch (e) {
      const code = (e as { code?: string })?.code;
      // coluna nova criada há pouco: atualiza o mapa de colunas para a próxima vez
      if (code === '42703' || code === '42P01') cols = null;
      return bad(e);
    }
  }

  then<R1 = Result<T>, R2 = never>(onfulfilled?: ((value: Result<T>) => R1 | PromiseLike<R1>) | null, onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null): PromiseLike<R1 | R2> {
    return this.exec().then(onfulfilled, onrejected);
  }
}

/** db().rpc('funcao', { p_x: 1 }) */
export async function rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<Result<T>> {
  try {
    const keys = Object.keys(args);
    keys.forEach(ident);
    const params = keys.map((k) => (args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k]));
    const r = await getPool().query(`select * from public.${ident(fn)}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')})`, params);
    // função que devolve um valor só (número, json, void): vem numa coluna com o nome dela
    if (r.fields.length === 1 && r.fields[0].name === fn) return ok<T>((r.rows[0]?.[fn] ?? null) as T);
    return ok<T>(r.rows as T);
  } catch (e) {
    return bad(e);
  }
}
