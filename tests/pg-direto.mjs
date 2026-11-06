/**
 * Banco de teste para o MODO SERVIDOR PRÓPRIO (Postgres direto, sem Supabase).
 * Recria o banco do zero num Postgres de verdade, roda os arquivos supabase/*.sql na mesma
 * ordem do simulador e carrega os mesmos dados de teste (tests/seed.mjs).
 *
 * Uso: TEST_DATABASE_URL=postgres://postgres@/maxhub_teste?host=/tmp&port=55432 node tests/pg-direto.mjs
 *      (STORAGE_DIR, se definido, também é esvaziado)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { buildSeed } from './seed.mjs';

const URL_ = process.env.TEST_DATABASE_URL;
if (!URL_) {
  console.error('Defina TEST_DATABASE_URL');
  process.exit(1);
}
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'supabase');
const FILES = ['schema.sql', 'estoque.sql', 'baixa_e_usuarios.sql', 'maxhub.sql', 'categorias.sql', 'max_aprendizado.sql', 'compras.sql', 'pedidos_e_notas.sql', 'desligamento.sql', 'fornecedores.sql', 'compras_pedidos.sql', 'controle_rh.sql', 'contratos_e_devolucoes.sql', 'chamados.sql'];

const u = new URL(URL_.replace(/^postgres(ql)?:/, 'http:'));
const dbName = u.pathname.replace(/^\//, '');
const admin = new pg.Client({ connectionString: URL_.replace(`/${dbName}`, '/postgres') });
await admin.connect();
await admin.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`, [dbName]);
await admin.query(`drop database if exists "${dbName}"`);
await admin.query(`create database "${dbName}"`);
for (const r of ['anon', 'authenticated', 'service_role']) await admin.query(`do $$ begin create role ${r} nologin; exception when duplicate_object then null; end $$`);
await admin.end();

const c = new pg.Client({ connectionString: URL_ });
await c.connect();
for (const f of FILES) {
  try {
    await c.query(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  } catch (e) {
    console.error(`ERRO em ${f}:`, e.message);
    process.exit(1);
  }
}
await c.query('delete from public.admins');

const types = new Map();
const r = await c.query(`select table_name, column_name, udt_name, is_generated, identity_generation from information_schema.columns where table_schema = 'public'`);
for (const x of r.rows) {
  if (!types.has(x.table_name)) types.set(x.table_name, new Map());
  types.get(x.table_name).set(x.column_name, { udt: x.udt_name, generated: x.is_generated === 'ALWAYS', identity: x.identity_generation });
}
const seed = buildSeed({});
for (const table of ['admins', 'authorized_emails', 'postos', 'stock_items', 'posto_stock', 'requests', 'stock_movements']) {
  for (const row of seed[table] ?? []) {
    const cols = Object.keys(row).filter((k) => types.get(table)?.has(k) && !types.get(table).get(k).generated);
    const vals = cols.map((k) => {
      const t = types.get(table).get(k);
      const v = row[k];
      if (v === null || v === undefined) return null;
      if (t.udt === 'jsonb' || t.udt === 'json') return JSON.stringify(v);
      return v;
    });
    const ov = cols.some((k) => types.get(table).get(k).identity === 'ALWAYS') ? ' overriding system value' : '';
    await c.query(`insert into public.${table} (${cols.map((k) => `"${k}"`).join(',')})${ov} values (${cols.map((_, i) => `$${i + 1}`).join(',')})`, vals);
  }
}
for (const [table, cs] of types) {
  for (const [col, t] of cs) {
    if (t.identity) await c.query(`select setval(pg_get_serial_sequence('public.${table}', '${col}'), greatest(1, (select coalesce(max("${col}"), 0) from public.${table})), (select count(*) > 0 from public.${table}))`);
  }
}
await c.end();
if (process.env.STORAGE_DIR && process.env.STORAGE_DIR.includes('teste')) fs.rmSync(process.env.STORAGE_DIR, { recursive: true, force: true });
console.log(`banco de teste pronto: ${dbName}`);
