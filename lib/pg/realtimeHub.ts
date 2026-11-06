import 'server-only';
import { EventEmitter } from 'node:events';
import pg from 'pg';
import { getPool } from './pool';

/**
 * Tempo real do próprio Max Hub (sem o Supabase Realtime).
 *
 * Quem altera algo chama publish(); o aviso passa pelo próprio Postgres (NOTIFY) e
 * chega a todos os processos do sistema, que repassam às telas abertas por
 * /api/tempo-real (Server-Sent Events). Assim funciona mesmo com mais de um processo.
 */
export type Msg = { topic: string; event: string; payload: Record<string, unknown> };
const CHANNEL = 'maxhub_tempo_real';

const bus = new EventEmitter();
bus.setMaxListeners(0);
let listener: pg.Client | null = null;
let starting: Promise<void> | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;

async function start(): Promise<void> {
  if (listener) return;
  if (starting) return starting;
  starting = (async () => {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL, options: '-c timezone=UTC' });
    c.on('notification', (n) => {
      if (n.channel !== CHANNEL || !n.payload) return;
      try {
        bus.emit('msg', JSON.parse(n.payload) as Msg);
      } catch {
        /* aviso malformado: ignora */
      }
    });
    const reconnect = () => {
      if (listener === c) listener = null;
      c.end().catch(() => undefined);
      // as telas conferem sozinhas enquanto isso; tenta de novo em alguns segundos
      if (!retry && bus.listenerCount('msg')) retry = setTimeout(() => ((retry = null), void start().catch(() => undefined)), 3000);
    };
    c.on('error', reconnect);
    c.on('end', reconnect);
    await c.connect();
    await c.query(`listen ${CHANNEL}`);
    listener = c;
  })().finally(() => {
    starting = null;
  });
  return starting;
}

/** manda o aviso para todas as telas conectadas (em qualquer processo) */
export async function publish(msg: Msg): Promise<void> {
  const text = JSON.stringify(msg);
  // o NOTIFY do Postgres aceita até ~8 KB: aviso maior vai cortado só no payload
  const safe = text.length < 7500 ? text : JSON.stringify({ ...msg, payload: {} });
  try {
    await getPool().query('select pg_notify($1, $2)', [CHANNEL, safe]);
  } catch {
    // banco indisponível: entrega ao menos para quem está neste processo
    bus.emit('msg', JSON.parse(safe) as Msg);
  }
}

/** inscreve uma tela; devolve a função para cancelar */
export async function subscribe(fn: (m: Msg) => void): Promise<() => void> {
  bus.on('msg', fn);
  await start().catch(() => undefined);
  return () => bus.off('msg', fn);
}
