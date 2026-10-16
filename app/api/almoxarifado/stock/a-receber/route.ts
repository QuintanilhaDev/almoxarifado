import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireAlmox } from '@/lib/access';
import { serverError } from '@/lib/http';
import { missingPC } from '@/lib/compras/pcServer';
import { onOrderByItem } from '@/lib/compras/painel';

export const dynamic = 'force-dynamic';

/**
 * Para o Estoque: por item, o que está em compra (a receber, com previsão e atraso), o que
 * está em conferência/quarentena (aceito na conferência, ainda sem entrada) e as
 * requisições pendentes (demanda ainda sem reserva). Nada disso é saldo físico.
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
    const demand: Record<string, number> = {};
    const { data: orders } = await db().from('material_orders').select('items, stage').not('stage', 'in', '(cancelado,concluido)');
    for (const o of orders ?? []) {
      for (const l of (o.items as { item_id?: string | null; qty?: number; delivered?: number; reserved?: number }[]) ?? []) {
        const left = (Number(l.qty) || 0) - (Number(l.delivered) || 0) - (Number(l.reserved) || 0);
        if (l.item_id && left > 0) demand[l.item_id] = (demand[l.item_id] ?? 0) + left;
      }
    }
    return NextResponse.json({ on_order, quarantine, demand }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return serverError(e);
  }
}
