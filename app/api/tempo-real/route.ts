import { currentUser } from '@/lib/auth';
import { auditTopic } from '@/lib/audit';
import { clientKey } from '@/lib/rateLimit';
import { DIRECT } from '@/lib/pg/pool';
import { subscribe, type Msg } from '@/lib/pg/realtimeHub';
import { REALTIME_CHANNEL } from '@/lib/realtimeEvents';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** avisos que o formulário público (sem login) pode receber */
const PUBLIC_EVENTS = new Set(['form:update']);
const MAX_PER_IP = 30;
const g = globalThis as unknown as { __rtConns?: Map<string, number> };
const conns = (g.__rtConns ??= new Map());

/**
 * Tempo real do servidor próprio: uma conexão aberta (Server-Sent Events) por tela.
 * - sem login: só o aviso de formulário alterado (formulário dos supervisores);
 * - com login: os avisos gerais do sistema;
 * - master: também a auditoria ao vivo.
 */
export async function GET(req: Request) {
  if (!DIRECT) return new Response('Tempo real do servidor próprio desligado.', { status: 404 });
  const ip = clientKey(req);
  if ((conns.get(ip) ?? 0) >= MAX_PER_IP) return new Response('Conexões demais.', { status: 429 });
  const user = await currentUser().catch(() => null);
  const audit = user?.is_master ? await auditTopic() : null;

  const enc = new TextEncoder();
  let stop = () => {};
  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      conns.set(ip, (conns.get(ip) ?? 0) + 1);
      let closed = false;
      const send = (text: string) => {
        if (closed) return;
        try {
          ctrl.enqueue(enc.encode(text));
        } catch {
          close();
        }
      };
      const unsub = await subscribe((m: Msg) => {
        const allowed = m.topic === REALTIME_CHANNEL ? Boolean(user) || PUBLIC_EVENTS.has(m.event) : audit !== null && m.topic === audit;
        if (allowed) send(`data: ${JSON.stringify(m)}\n\n`);
      });
      // a conexão fica aberta; um "sinal de vida" a cada 20 s impede o proxy de derrubá-la
      const beat = setInterval(() => send(`: ok\n\n`), 20_000);
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(beat);
        unsub();
        conns.set(ip, Math.max(0, (conns.get(ip) ?? 1) - 1));
        try {
          ctrl.close();
        } catch {
          /* já fechada */
        }
      };
      stop = close;
      req.signal.addEventListener('abort', close);
      send(`retry: 3000\n: conectado\n\n`);
    },
    cancel() {
      stop();
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
