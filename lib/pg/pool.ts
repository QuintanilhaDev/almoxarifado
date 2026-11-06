import 'server-only';
import pg from 'pg';
import { parse as parseArray } from 'postgres-array';

/**
 * Conexão direta com o Postgres (servidor próprio da empresa).
 * Ligada quando existe DATABASE_URL; sem ela, o sistema continua usando o Supabase.
 */
export const DIRECT = Boolean(process.env.DATABASE_URL);

// Mesmo formato de dados que o Supabase devolvia, para nenhuma tela perceber a troca:
// números como número, datas como texto, data-hora em ISO com fuso.
const { types } = pg;
types.setTypeParser(20, (v) => Number(v)); // int8
types.setTypeParser(1700, (v) => Number(v)); // numeric
types.setTypeParser(1082, (v) => v); // date → 'AAAA-MM-DD'
types.setTypeParser(1114, (v) => v.replace(' ', 'T')); // timestamp
types.setTypeParser(1184, (v) => {
  // timestamptz: '2026-11-06 14:00:00.123+00' → '2026-11-06T14:00:00.123+00:00'
  const s = v.replace(' ', 'T');
  return /[+-]\d\d$/.test(s) ? `${s}:00` : s;
});

// listas de datas também em texto (o padrão do driver viraria objeto Date)
types.setTypeParser(1182 as Parameters<typeof types.setTypeParser>[0], (v) => parseArray(v, (x) => x)); // date[]
types.setTypeParser(1185 as Parameters<typeof types.setTypeParser>[0], (v) => parseArray(v, (x) => types.getTypeParser(1184)(x) as string)); // timestamptz[]

let pool: pg.Pool | null = null;
export function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.DATABASE_POOL_MAX) || 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      options: '-c timezone=UTC',
    });
    pool.on('error', (e) => console.error('[postgres] conexão ociosa caiu:', e.message));
  }
  return pool;
}
