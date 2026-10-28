import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireAlmox } from '@/lib/access';
import { serverError } from '@/lib/http';
import { missingPC } from '@/lib/compras/pcServer';
import { onOrderByItem } from '@/lib/compras/painel';
import { demandByItem } from '@/lib/almoxarifado/reposicao';

export const dynamic = 'force-dynamic';

/**
 * Para o Estoque: por item, o que está em compra (a receber, com previsão e atraso), o que
 * está em conferência/quarentena (aceito na conferência, ainda sem entrada) e as
 * requisições pendentes (pedidos encaminhados, sem compra vinculada e ainda sem reserva).
 * Nada disso é saldo físico.
 */
export async function GET() {
  try {
    await requireAlmox('estoque', 'view');
    let on_order: Awaited<ReturnType<typeof onOrderByItem>> = {};
    try {
      on_order = await onOrderByItem();
    } catch (e) {
      if (!missingPC(e)) throw e;
    }
    const quarantine: Record<string, number> = {};
    const { data: notes } = await db().from('fiscal_notes').select('items, status').in('status', ['aberta', 'conferencia', 'divergencia', 'parcial']);
    for (const n of notes ?? []) {
      for (const l of (n.items as { item_id?: string | null; accepted?: number; received?: number }[]) ?? []) {
        const wait = (Number(l.accepted) || 0) - (Number(l.received) || 0);
        if (l.item_id && wait > 0) quarantine[l.item_id] = (quarantine[l.item_id] ?? 0) + wait;
      }
    }
    // mesma definição da Reposição (pedidos encaminhados, linhas sem compra)
    const demand: Record<string, number> = Object.fromEntries(await demandByItem());
    return NextResponse.json({ on_order, quarantine, demand }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return serverError(e);
  }
}
