import 'server-only';
import { nameKey } from '../compras/fornecedores';
import { db } from '../supabaseAdmin';
import { bestMatches, normalize } from '../max/text';
import type { StockItem } from '../almoxarifado/types';
import type { NfeItem } from './nfe';

export const NOTE_COLS =
  'id, number, series, access_key, supplier_id, supplier_name, cnpj, company, company_cnpj, issue_date, received_date, status, items, totals, installments, payment, purchase_request_id, note, created_by, posted_at, history, created_at, updated_at';

export interface NoteLine extends Partial<NfeItem> {
  code: string;
  description: string;
  unit: string;
  qty: number;
  unit_cost: number;
  total: number;
  item_id: string | null;
  received: number;
  /** como a ligação foi achada: pelo código do fornecedor (aprendido) ou pelo nome */
  via?: 'fornecedor' | 'nome' | null;
}

export interface FiscalNote {
  id: string;
  number: string;
  series: string | null;
  access_key: string | null;
  supplier_id: string | null;
  supplier_name: string;
  cnpj: string | null;
  company: string | null;
  company_cnpj: string | null;
  issue_date: string | null;
  received_date: string | null;
  status: 'aberta' | 'parcial' | 'lancada' | 'estornada';
  items: NoteLine[];
  totals: Record<string, number>;
  installments: { n: string; due: string | null; value: number }[];
  payment: string | null;
  purchase_request_id: string | null;
  note: string | null;
  created_by: string | null;
  posted_at: string | null;
  history: { at: string; by: string; what: string }[];
  created_at: string;
  updated_at: string;
}

export function toNote(r: Record<string, unknown>): FiscalNote {
  return {
    ...(r as unknown as FiscalNote),
    items: Array.isArray(r.items) ? (r.items as NoteLine[]) : [],
    installments: Array.isArray(r.installments) ? (r.installments as FiscalNote['installments']) : [],
    history: Array.isArray(r.history) ? (r.history as FiscalNote['history']) : [],
    totals: (r.totals as Record<string, number>) ?? {},
  };
}

/** Palavras da descrição da NF que não ajudam a achar o item ("TAM", "N", "PRETA"…). */
const NOISE = /\b(tam|tamanho|n|no|num|numero|un|und|par|pc|pcs|cx|ref|cod|cor|preto|preta|branco|branca|azul|marinho|cinza)\b/g;
const sizeIn = (desc: string) => {
  const n = normalize(desc);
  const m = n.match(/\b(?:tam(?:anho)?|n|numero|no)\s*([a-z0-9]{1,3})\b/) || n.match(/\b(pp|p|m|g|gg|xg|xgg|eg|[3-5]\d)\b\s*$/);
  return m ? m[1] : null;
};

/** Sugere o item do estoque para uma linha da nota (o que o fornecedor já ligou antes vem primeiro). */
export function suggestItem(line: { code: string; description: string }, items: StockItem[], learned: Map<string, string>): { item_id: string | null; via: 'fornecedor' | 'nome' | null; options: { id: string; label: string; score: number }[] } {
  const label = (i: StockItem) => i.name + (i.size ? ` ${i.size}` : '');
  const known = line.code ? learned.get(line.code) : undefined;
  const active = items.filter((i) => i.active !== false);
  if (known && items.some((i) => i.id === known)) {
    const it = items.find((i) => i.id === known)!;
    return { item_id: it.id, via: 'fornecedor', options: [{ id: it.id, label: label(it), score: 1 }] };
  }
  const clean = normalize(line.description).replace(NOISE, ' ').replace(/\s+/g, ' ');
  const size = sizeIn(line.description);
  const hits = bestMatches(clean, active, (i) => i.name, 0.5, 12);
  let options = hits.map((h) => ({ id: h.item.id, label: label(h.item), score: h.score + (size && normalize(h.item.size ?? '') === size ? 0.3 : size && h.item.size ? -0.2 : 0) }));
  options = options.sort((a, b) => b.score - a.score).slice(0, 6);
  // liga sozinho só se for claro: nome bem parecido e (quando a nota fala de tamanho) o tamanho bate
  const top = options[0];
  const second = options[1];
  const clear = top && top.score >= 0.95 && (!second || top.score - second.score >= 0.2);
  return { item_id: clear ? top.id : null, via: clear ? 'nome' : null, options };
}

export async function learnedFor(cnpj: string | null): Promise<{ supplierId: string | null; map: Map<string, string> }> {
  if (!cnpj) return { supplierId: null, map: new Map() };
  const { data: s } = await db().from('suppliers').select('id').eq('cnpj', cnpj).maybeSingle();
  if (!s) return { supplierId: null, map: new Map() };
  const { data } = await db().from('supplier_items').select('supplier_code, item_id').eq('supplier_id', s.id);
  return { supplierId: s.id as string, map: new Map((data ?? []).map((r) => [r.supplier_code as string, r.item_id as string])) };
}

/** Fornecedor pelo CNPJ (cria na primeira nota). */
export async function ensureSupplier(name: string, cnpj: string | null): Promise<string | null> {
  if (cnpj) {
    const { data } = await db().from('suppliers').select('id').eq('cnpj', cnpj).maybeSingle();
    if (data) return data.id as string;
  }
  // mesmo nome (razão social ou fantasia) de um fornecedor já cadastrado em Compras: usa ele, sem duplicar
  const key = nameKey(name);
  if (key) {
    const { data: all } = await db().from('suppliers').select('id, name, trade_name, cnpj').limit(20000);
    const same = ((all ?? []) as { id: string; name: string; trade_name?: string | null; cnpj: string | null }[]).find(
      (x) => (nameKey(x.name) === key || (x.trade_name ? nameKey(x.trade_name) === key : false)) && (!cnpj || !x.cnpj || x.cnpj === cnpj),
    );
    if (same) {
      if (cnpj && !same.cnpj) await db().from('suppliers').update({ cnpj }).eq('id', same.id);
      return same.id;
    }
  }
  const { data, error } = await db().from('suppliers').insert({ name, cnpj }).select('id').single();
  if (error) {
    if (error.code === '23505' && cnpj) {
      const { data: again } = await db().from('suppliers').select('id').eq('cnpj', cnpj).maybeSingle();
      return (again?.id as string) ?? null;
    }
    throw error;
  }
  return data.id as string;
}
