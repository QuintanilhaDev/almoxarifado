import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/access';
import { AccessError, fail, readJson, serverError } from '@/lib/http';
import { broadcast } from '@/lib/broadcast';
import { rateLimit } from '@/lib/rateLimit';
import { UUID_RE, str } from '@/lib/almoxarifado/stockData';
import { almoxEdit, canSeePurchases } from '@/lib/compras/access';
import { COLS, missingTable, setupFail, toRequest } from '@/lib/compras/server';
import { LIMITS, type PurchaseItem } from '@/lib/compras/types';

export const dynamic = 'force-dynamic';

/** Lista as solicitações de compra (as mais recentes primeiro). */
export async function GET() {
  try {
    const user = await requireUser();
    if (!canSeePurchases(user)) throw new AccessError(403, 'Você não tem acesso às solicitações de compra.');
    const { data, error } = await db().from('purchase_requests').select(COLS).order('created_at', { ascending: false }).limit(500);
    if (error) {
      if (missingTable(error)) return setupFail();
      throw error;
    }
    return NextResponse.json({ requests: (data ?? []).map((r) => toRequest(r as Record<string, unknown>)) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return serverError(e);
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** O Almoxarifado pede uma compra. */
export async function POST(req: Request) {
  const body = await readJson<{ items?: unknown; reason?: unknown; priority?: unknown; needed_by?: unknown }>(req);
  if (!body) return fail('Dados inválidos.');
  try {
    const user = await requireUser();
    if (!almoxEdit(user)) throw new AccessError(403, 'Só quem tem permissão de edição em Compras, no Almoxarifado, pode pedir compras.');
    if (!rateLimit(`compra:${user.id}`, 20, 60_000).ok) return fail('Muitos pedidos em sequência. Espere um instante.', 429);

    // ----- itens -----
    if (!Array.isArray(body.items) || body.items.length === 0) return fail('Adicione pelo menos um item.');
    if (body.items.length > LIMITS.items) return fail(`No máximo ${LIMITS.items} itens por solicitação.`);
    const raw = body.items.map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>) : {}));
    const ids = [...new Set(raw.map((x) => (typeof x.item_id === 'string' ? x.item_id : '')).filter(Boolean))];
    if (ids.some((id) => !UUID_RE.test(id))) return fail('Item do estoque inválido.');
    let stock = new Map<string, { id: string; name: string; size: string | null; unit: string; quantity: number; min_quantity: number }>();
    if (ids.length) {
      const { data, error } = await db().from('stock_items').select('id, name, size, unit, quantity, min_quantity').in('id', ids);
      if (error) throw error;
      stock = new Map((data ?? []).map((d) => [d.id as string, d as never]));
      if (stock.size !== ids.length) return fail('Um dos itens não existe mais no estoque. Atualize a página e confira.', 409);
    }
    const items: PurchaseItem[] = [];
    const seen = new Set<string>();
    for (const [i, x] of raw.entries()) {
      const q = typeof x.quantity === 'number' ? x.quantity : Number(String(x.quantity ?? '').replace(',', '.'));
      if (!Number.isInteger(q) || q < 1 || q > LIMITS.quantity) return fail(`Item ${i + 1}: a quantidade precisa ser um número inteiro entre 1 e ${LIMITS.quantity.toLocaleString('pt-BR')}.`);
      const note = str(x.note, LIMITS.note);
      const id = typeof x.item_id === 'string' && x.item_id ? x.item_id : null;
      if (id) {
        // dados do item vêm do banco (não do navegador): nome, tamanho e saldo de agora
        const s = stock.get(id)!;
        if (seen.has(id)) return fail(`O item ${s.name}${s.size ? ' ' + s.size : ''} aparece duas vezes. Junte as quantidades em uma linha.`);
        seen.add(id);
        items.push({ item_id: id, name: s.name, size: s.size, unit: s.unit || 'Cada', quantity: q, note, stock: s.quantity, min: s.min_quantity });
      } else {
        const name = str(x.name, LIMITS.name);
        if (!name) return fail(`Item ${i + 1}: diga o nome do item.`);
        const size = str(x.size, 40);
        const key = `${name.toLowerCase()}|${(size ?? '').toLowerCase()}`;
        if (seen.has(key)) return fail(`O item ${name} aparece duas vezes. Junte as quantidades em uma linha.`);
        seen.add(key);
        items.push({ item_id: null, name, size, unit: str(x.unit, 20) ?? 'Cada', quantity: q, note, stock: null, min: null });
      }
    }

    // ----- demais campos -----
    const priority = body.priority === 'urgente' ? 'urgente' : 'normal';
    const reason = str(body.reason, LIMITS.reason);
    let needed_by: string | null = null;
    if (body.needed_by) {
      const d = String(body.needed_by);
      const t = Date.parse(d + 'T12:00:00-03:00');
      if (!DATE_RE.test(d) || !Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== d) return fail('Data de "precisa até" inválida.');
      const today = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10); // hoje em Salvador
      if (d < today) return fail('A data de "precisa até" já passou.');
      if ((t - Date.now()) / 86_400_000 > 366) return fail('A data de "precisa até" está longe demais (mais de um ano).');
      needed_by = d;
    }

    const now = new Date().toISOString();
    const { data, error } = await db()
      .from('purchase_requests')
      .insert({
        from_sector: 'almoxarifado',
        status: 'nova',
        priority,
        reason,
        needed_by,
        items,
        requested_by: user.display_name,
        requested_by_id: user.id,
        history: [{ at: now, by: user.display_name, status: 'nova', note: null }],
      })
      .select(COLS)
      .single();
    if (error) {
      if (missingTable(error)) return setupFail();
      throw error;
    }
    const row = toRequest(data as Record<string, unknown>);
    await broadcast('purchase:new', { id: row.id, number: row.number, by: user.display_name, priority, count: items.length });
    return NextResponse.json({ request: row });
  } catch (e) {
    return serverError(e);
  }
}
