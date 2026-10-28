import 'server-only';
import { db } from '../supabaseAdmin';
import { fetchAll } from '../almoxarifado/stockData';
import { normalize } from '../max/text';

export interface SupplierHint {
  supplier_id: string;
  name: string;
  homologation: string;
  score: number;
  reasons: string[];
  lead_days: number | null;
  lead_business: boolean;
  mode: 'pronta' | 'producao';
  in_contract: boolean;
  last_price: number | null;
}

const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'com', 'para', 'tam', 'e', 'a', 'o', 'em', 'c', 'cada', 'par']);
const words = (s: string) => normalize(s).split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));

/**
 * Quem pode fornecer cada item, do mais provável ao menos:
 *  item cadastrado no fornecedor (com prazo/contrato) > já vendeu (pedidos e notas) > o que fornece combina com o item.
 * Fornecedores bloqueados ou inativos ficam de fora.
 */
export async function suggestSuppliers(items: { key: string; item_id: string | null; name: string }[]): Promise<Record<string, SupplierHint[]>> {
  const out: Record<string, SupplierHint[]> = {};
  // página por página (o Supabase para em 1000 linhas por consulta)
  const sups = await fetchAll<Record<string, unknown>>('suppliers', 'id, name, trade_name, category, brands, homologation, active, lead_days, lead_business', { column: 'id' });
  const live = sups.filter((s) => s.active !== false && s.homologation !== 'bloqueado');
  if (!live.length) return out;
  const ids = items.map((i) => i.item_id).filter(Boolean) as string[];
  const [{ data: prods }, { data: eqs }, { data: pos }] = await Promise.all([
    ids.length ? db().from('supplier_products').select('*').in('item_id', ids) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    ids.length ? db().from('supplier_items').select('supplier_id, item_id').in('item_id', ids) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    db().from('purchase_orders').select('supplier_id, items, created_at, status').neq('status', 'cancelado').order('created_at', { ascending: false }).limit(1000),
  ]);
  for (const it of items) {
    const hints = new Map<string, SupplierHint>();
    const add = (sid: string, pts: number, why: string, extra: Partial<SupplierHint> = {}) => {
      const s = live.find((x) => x.id === sid);
      if (!s) return;
      const h = hints.get(sid) ?? {
        supplier_id: sid,
        name: (s.trade_name as string) || (s.name as string),
        homologation: String(s.homologation ?? 'homologado'),
        score: 0,
        reasons: [],
        lead_days: (s.lead_days as number) ?? null,
        lead_business: s.lead_business !== false,
        mode: 'pronta' as const,
        in_contract: false,
        last_price: null,
      };
      h.score += pts;
      if (!h.reasons.includes(why)) h.reasons.push(why);
      Object.assign(h, Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== null && v !== undefined)));
      hints.set(sid, h);
    };
    if (it.item_id) {
      for (const p of (prods ?? []).filter((x) => x.item_id === it.item_id)) {
        add(String(p.supplier_id), p.in_contract ? 6 : 4, p.in_contract ? 'item do contrato' : 'fornece este item', {
          lead_days: (p.lead_days as number) ?? undefined,
          lead_business: p.lead_business !== false,
          mode: p.mode === 'producao' ? 'producao' : 'pronta',
          in_contract: Boolean(p.in_contract),
          last_price: p.last_price === null || p.last_price === undefined ? undefined : Number(p.last_price),
        });
      }
      for (const e of (eqs ?? []).filter((x) => x.item_id === it.item_id)) add(String(e.supplier_id), 2, 'já entregou (nota fiscal)');
    }
    for (const o of pos ?? []) {
      const line = ((o.items as { item_id: string | null; name: string; unit_price: number }[]) ?? []).find((l) => (it.item_id ? l.item_id === it.item_id : normalize(l.name) === normalize(it.name)));
      if (line && o.supplier_id) add(String(o.supplier_id), 2, 'já comprado dele', { last_price: hints.get(String(o.supplier_id))?.last_price ?? Number(line.unit_price) });
    }
    const w = words(it.name);
    if (w.length) {
      for (const s of live) {
        const what = words(`${s.category ?? ''} ${s.brands ?? ''}`);
        if (what.some((x) => w.some((y) => y.startsWith(x.slice(0, 5)) || x.startsWith(y.slice(0, 5))))) add(String(s.id), 1, 'fornece itens parecidos');
      }
    }
    out[it.key] = [...hints.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, 6);
  }
  return out;
}
