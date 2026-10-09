import { NextResponse } from 'next/server';
import { requireAlmox } from '@/lib/access';
import { fail, serverError } from '@/lib/http';
import { MAX_SPAN_MS, loadRange } from '@/lib/almoxarifado/rangeData';

export const dynamic = 'force-dynamic';

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
    const data = await loadRange(fromMs, toMs);
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return serverError(e);
  }
}
