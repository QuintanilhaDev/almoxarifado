import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireAlmox } from '@/lib/access';
import { fail, serverError } from '@/lib/http';
import { IN_KINDS, OUT_KINDS } from '@/lib/almoxarifado/metrics';
import type { RangeData } from '@/lib/almoxarifado/range';

export const dynamic = 'force-dynamic';

const PAGE = 1000;
const MAX_ROWS = 50_000;
const MAX_SPAN_MS = 400 * 86_400_000;

async function readAll<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>) {
  const rows: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    const part = (data ?? []) as T[];
    rows.push(...part);
    if (part.length < PAGE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

/**
 * Movimentação do estoque em QUALQUER intervalo (?from=ISO&to=ISO), para a Max responder
 * perguntas como "quantos itens saíram nas últimas 15 horas".
 * Entradas = entrada + devolução de posto · Saídas = saída + envio a posto (igual à tela de Métricas).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const fromMs = Date.parse(url.searchParams.get('from') || '');
  const now = Date.now();
  const toMs = Math.min(Date.parse(url.searchParams.get('to') || '') || now, now + 60_000);
  if (!Number.isFinite(fromMs) || fromMs >= toMs) return fail('Período inválido.');
  if (toMs - fromMs > MAX_SPAN_MS) return fail('Período longo demais (máximo de 400 dias).');
  try {
    await requireAlmox(['metricas', 'estoque'], 'view');
    const fromIso = new Date(fromMs).toISOString();
    const toIso = new Date(toMs).toISOString();
    const sb = db();
    const [mv, rq] = await Promise.all([
      readAll<{ kind: string; quantity: number; item_name: string; posto_name: string | null }>((a, b) =>
        sb
          .from('stock_movements')
          .select('id, created_at, kind, quantity, item_name, posto_name')
          .gte('created_at', fromIso)
          .lte('created_at', toIso)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .range(a, b),
      ),
      readAll<{ status: string }>((a, b) =>
        sb
          .from('requests')
          .select('id, created_at, status')
          .gte('created_at', fromIso)
          .lte('created_at', toIso)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .range(a, b),
      ),
    ]);

    const totals: RangeData['totals'] = { in: 0, out: 0, inMoves: 0, outMoves: 0, itemsIn: 0, itemsOut: 0, toPostos: 0, returned: 0, consumed: 0, adjustments: 0 };
    const items = new Map<string, { name: string; in: number; out: number }>();
    const postos = new Map<string, { name: string; received: number }>();
    for (const m of mv.rows) {
      const q = Number(m.quantity) || 0;
      const isIn = IN_KINDS.includes(m.kind);
      const isOut = OUT_KINDS.includes(m.kind);
      if (m.kind === 'baixa_posto') totals.consumed += q;
      if (m.kind === 'ajuste') totals.adjustments++;
      if (!isIn && !isOut) continue;
      const it = items.get(m.item_name) ?? { name: m.item_name, in: 0, out: 0 };
      if (isIn) {
        totals.in += q;
        totals.inMoves++;
        it.in += q;
        if (m.kind === 'devolucao') totals.returned += q;
      } else {
        totals.out += q;
        totals.outMoves++;
        it.out += q;
        if (m.kind === 'transferencia') {
          totals.toPostos += q;
          const name = m.posto_name || 'Posto removido';
          const p = postos.get(name) ?? { name, received: 0 };
          p.received += q;
          postos.set(name, p);
        }
      }
      items.set(m.item_name, it);
    }
    for (const it of items.values()) {
      if (it.in > 0) totals.itemsIn++;
      if (it.out > 0) totals.itemsOut++;
    }
    const requests = { total: rq.rows.length, nova: 0, pendente: 0, resolvida: 0 };
    for (const r of rq.rows) {
      if (r.status === 'nova') requests.nova++;
      else if (r.status === 'pendente') requests.pendente++;
      else if (r.status === 'resolvida') requests.resolvida++;
    }
    const data: RangeData = {
      from: fromIso,
      to: toIso,
      totals,
      items: [...items.values()].sort((a, b) => b.out + b.in - (a.out + a.in) || a.name.localeCompare(b.name, 'pt-BR')).slice(0, 500),
      postos: [...postos.values()].sort((a, b) => b.received - a.received).slice(0, 50),
      requests,
      truncated: mv.truncated || rq.truncated,
    };
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return serverError(e);
  }
}
