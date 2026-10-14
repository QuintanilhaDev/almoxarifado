import 'server-only';
import { db } from '../supabaseAdmin';
import { fail } from '../http';
import { bestMatches, normalize } from '../max/text';
import type { StockItem } from '../almoxarifado/types';
import type { MaterialOrder, OrderItem } from './types';
import { lineLabel, orderLabel } from './types';

export const ORDER_COLS =
  'id, number, origin, stage, priority, needed_by, company, posto_id, posto_name, collaborator_id, collaborator_name, matricula, role, start_date, reason, requester, supervisor, source_request_id, items, flags, history, forwarded_by, forwarded_at, validated_by, validated_at, closed_at, created_at, updated_at';

/** A tabela/função ainda não existe (falta rodar o supabase/projeto3.sql)? */
export function missingP3(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  return ['42P01', 'PGRST205', 'PGRST202', '42703', 'PGRST204', '42883'].includes(err?.code ?? '') || /does not exist|could not find/i.test(err?.message ?? '');
}
export const P3_SETUP = 'Esta função ainda não foi ativada no banco. Rode o arquivo supabase/projeto3.sql no SQL Editor do Supabase.';
export const p3Fail = () => fail(P3_SETUP, 409, { setup: true });

/** Mensagem de "raise exception" do banco; MINIMO| vira pedido de liberação excepcional. */
export function dbRule(e: unknown): { message: string; minimum: boolean } | null {
  const err = e as { code?: string; message?: string } | null;
  if (err?.code !== 'P0001' || !err.message) return null;
  const minimum = err.message.startsWith('MINIMO|');
  return { message: minimum ? err.message.slice(7) : err.message, minimum };
}

export function toOrder(r: Record<string, unknown>): MaterialOrder {
  return {
    ...(r as unknown as MaterialOrder),
    number: Number(r.number),
    items: Array.isArray(r.items) ? (r.items as OrderItem[]).map((l) => ({ ...l, qty: Number(l.qty) || 0, reserved: Number(l.reserved) || 0, delivered: Number(l.delivered) || 0 })) : [],
    flags: Array.isArray(r.flags) ? (r.flags as string[]) : [],
    history: Array.isArray(r.history) ? (r.history as MaterialOrder['history']) : [],
  };
}

export async function loadOrder(id: string): Promise<MaterialOrder | null> {
  const { data, error } = await db().from('material_orders').select(ORDER_COLS).eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? toOrder(data as Record<string, unknown>) : null;
}

/* ------------------------------------------------------------------ */
/* configurações (hub_meta)                                            */
/* ------------------------------------------------------------------ */
export interface P3Config {
  /** solicitações dos supervisores passam pela Operação (Uesley) antes do Almoxarifado */
  routing: boolean;
  /** dias de antecedência do alerta de troca anual */
  tradeAlertDays: number;
  /** troca extraordinária reinicia a contagem da troca anual? (decisão da Gestão; padrão: não) */
  extraResetsCycle: boolean;
  /** prazo de reposição padrão (dias) quando o item não tem um próprio */
  defaultLeadDays: number;
  /** janela para calcular o consumo médio (dias) */
  consumptionDays: number;
}
export const DEFAULT_CONFIG: P3Config = { routing: false, tradeAlertDays: 30, extraResetsCycle: false, defaultLeadDays: 15, consumptionDays: 90 };

export async function getConfig(): Promise<P3Config> {
  const { data } = await db().from('hub_meta').select('value').eq('key', 'p3_config').maybeSingle();
  const v = (data?.value ?? {}) as Partial<P3Config>;
  return { ...DEFAULT_CONFIG, ...v };
}
export async function setConfig(patch: Partial<P3Config>): Promise<P3Config> {
  const cur = await getConfig();
  const next: P3Config = {
    routing: typeof patch.routing === 'boolean' ? patch.routing : cur.routing,
    tradeAlertDays: clampInt(patch.tradeAlertDays, 1, 180) ?? cur.tradeAlertDays,
    extraResetsCycle: typeof patch.extraResetsCycle === 'boolean' ? patch.extraResetsCycle : cur.extraResetsCycle,
    defaultLeadDays: clampInt(patch.defaultLeadDays, 1, 365) ?? cur.defaultLeadDays,
    consumptionDays: clampInt(patch.consumptionDays, 15, 365) ?? cur.consumptionDays,
  };
  const { error } = await db().from('hub_meta').upsert({ key: 'p3_config', value: next }, { onConflict: 'key' });
  if (error) throw error;
  return next;
}
function clampInt(v: unknown, lo: number, hi: number): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

/* ------------------------------------------------------------------ */
/* itens: ligar texto/tamanho ao item do estoque                       */
/* ------------------------------------------------------------------ */
const sizeKey = (s: string | null | undefined) => normalize(String(s ?? '')).replace(/^(tam|tamanho|n|numero|no)\s+/, '').trim();
const SHOE = /\b(bota|botas|sapato|sapatos|coturno|coturnos|tenis|calcado|calcados|botina|botinas)\b/;
const CLOTH = /\b(camisa|camisas|camiseta|camisetas|calca|calcas|jaqueta|jaquetas|bermuda|bermudas|blusa|blusas|agasalho|agasalhos|casaco|casacos|japona|colete)\b/;

/** Que tamanho do colaborador vale para este item (camisa, calça ou calçado)? */
export function sizeFieldFor(name: string): 'calcado' | 'calca' | 'camisa' | null {
  const n = normalize(name);
  if (SHOE.test(n)) return 'calcado';
  if (/\b(calca|calcas|bermuda|bermudas)\b/.test(n)) return 'calca';
  if (CLOTH.test(n)) return 'camisa';
  return null;
}

/**
 * Acha o item do estoque para "nome + tamanho". Devolve o item só quando há certeza
 * (nome bate e o tamanho existe); senão, null e a linha fica marcada para conferir.
 */
export function matchStock(name: string, size: string | null, items: StockItem[]): StockItem | null {
  const active = items.filter((i) => i.active !== false);
  const hits = bestMatches(name, active, (i) => i.name, 0.6, 30);
  if (!hits.length) return null;
  const best = hits[0].score;
  const names = [...new Set(hits.filter((h) => h.score >= best - 0.05).map((h) => normalize(h.item.name)))];
  if (names.length !== 1) return null; // mais de um produto possível: alguém confere
  const variants = active.filter((i) => normalize(i.name) === names[0]);
  const want = sizeKey(size);
  if (!want) return variants.length === 1 ? variants[0] : variants.find((v) => !sizeKey(v.size)) ?? null;
  return variants.find((v) => sizeKey(v.size) === want) ?? null;
}

/** Linha de pedido a partir de nome + tamanho + quantidade. */
export function lineFor(name: string, size: string | null, qty: number, items: StockItem[], note?: string | null): OrderItem {
  const hit = matchStock(name, size, items);
  return hit
    ? { item_id: hit.id, name: hit.name, size: hit.size, unit: hit.unit, qty, reserved: 0, delivered: 0, note: note ?? null }
    : { item_id: null, name, size: size || null, unit: 'Cada', qty, reserved: 0, delivered: 0, note: note ?? null, check: true };
}

/** Respostas do formulário do supervisor → linhas do pedido (campos "Itens", tamanhos e quantidade). */
export function formToLines(answers: { fieldId?: string; label?: string; type?: string; value?: unknown }[], items: StockItem[]): OrderItem[] {
  const by = (re: RegExp) => answers.find((a) => re.test(normalize(`${a.fieldId ?? ''} ${a.label ?? ''}`)));
  const itensA = answers.find((a) => a.fieldId === 'itens') ?? by(/\bitens?\b/);
  const roupa = by(/tamanho_roupa|tamanho do fardamento|\broupa\b|fardamento/)?.value;
  const calcado = by(/tamanho_calcado|calcado|numero do calcado/)?.value;
  const qtyA = answers.find((a) => a.fieldId === 'quantidade') ?? by(/\bquantidade\b/);
  const qty = Math.max(1, Math.min(1000, Math.round(Number(String(qtyA?.value ?? '1').replace(',', '.')) || 1)));
  const valid = (v: unknown) => {
    const s = String(v ?? '').trim();
    return s && !/nao se aplica/i.test(normalize(s)) ? s : null;
  };
  const names = Array.isArray(itensA?.value) ? (itensA!.value as unknown[]).map(String) : itensA?.value ? String(itensA.value).split(/[,;\n]/) : [];
  return names
    .map((n) => n.trim())
    .filter(Boolean)
    .slice(0, 40)
    .map((name) => {
      const f = sizeFieldFor(name);
      const size = f === 'calcado' ? valid(calcado) : f ? valid(roupa) : null;
      return lineFor(name, size, qty, items);
    });
}

/* ------------------------------------------------------------------ */
/* alertas de duplicidade (Projeto 3, 4.1)                             */
/* ------------------------------------------------------------------ */
export async function duplicityFlags(o: { id?: string; collaborator_id: string | null; collaborator_name: string | null; items: OrderItem[] }): Promise<string[]> {
  const flags: string[] = [];
  const who = o.collaborator_name?.trim();
  if (!o.collaborator_id && !who) return flags;
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  let q = db().from('deliveries').select('item_id, item_name, size, qty, delivered_at, order_number, collaborator_id, collaborator_name, returned_qty').gte('delivered_at', since);
  q = o.collaborator_id ? q.eq('collaborator_id', o.collaborator_id) : q.eq('collaborator_name', who!);
  const { data: del } = await q.limit(200);
  const ids = new Set(o.items.map((l) => l.item_id).filter(Boolean));
  const names = new Set(o.items.map((l) => normalize(lineLabel(l))));
  for (const d of del ?? []) {
    if (!(ids.has(d.item_id) || names.has(normalize(`${d.item_name}${d.size ? ' ' + d.size : ''}`)))) continue;
    const days = Math.max(0, Math.round((Date.now() - Date.parse(d.delivered_at as string)) / 86_400_000));
    flags.push(`${who ?? 'O colaborador'} recebeu ${d.qty} ${d.item_name}${d.size ? ' ' + d.size : ''} há ${days === 0 ? 'menos de 1 dia' : days === 1 ? '1 dia' : days + ' dias'}${d.order_number ? ` (pedido ${orderLabel(Number(d.order_number))})` : ''}: possível reposição antecipada.`);
  }
  let q2 = db().from('material_orders').select('id, number, items, stage, collaborator_id, collaborator_name').in('stage', ['solicitado', 'validacao', 'encaminhado']);
  q2 = o.collaborator_id ? q2.eq('collaborator_id', o.collaborator_id) : q2.eq('collaborator_name', who!);
  const { data: open } = await q2.limit(50);
  for (const x of open ?? []) {
    if (x.id === o.id) continue;
    const same = ((x.items as OrderItem[]) ?? []).filter((l) => (l.item_id && ids.has(l.item_id)) || names.has(normalize(lineLabel(l))));
    if (same.length) flags.push(`Já existe o pedido ${orderLabel(Number(x.number))} em aberto para ${who ?? 'o mesmo colaborador'} com ${same.map(lineLabel).join(', ')}.`);
  }
  return [...new Set(flags)].slice(0, 8);
}

/* ------------------------------------------------------------------ */
/* compras ligadas ao pedido                                           */
/* ------------------------------------------------------------------ */
/** Cria a solicitação de compra do que falta e liga cada linha do pedido a ela. */
export async function purchaseForOrder(
  o: MaterialOrder,
  lines: { i: number; qty: number }[],
  by: { id: string; name: string },
  stockById: Map<string, StockItem>,
): Promise<{ id: string; number: number }> {
  const items = lines.map(({ i, qty }) => {
    const l = o.items[i];
    const s = l.item_id ? stockById.get(l.item_id) : undefined;
    return {
      item_id: l.item_id,
      name: s?.name ?? l.name,
      size: s?.size ?? l.size,
      unit: s?.unit ?? l.unit ?? 'Cada',
      quantity: qty,
      note: `Pedido ${orderLabel(o.number)}${o.collaborator_name ? ' · ' + o.collaborator_name : ''}`,
      stock: s ? s.quantity : null,
      min: s ? s.min_quantity : null,
      orders: [{ id: o.id, number: o.number }],
    };
  });
  const now = new Date().toISOString();
  const { data, error } = await db()
    .from('purchase_requests')
    .insert({
      from_sector: 'almoxarifado',
      status: 'nova',
      priority: o.priority,
      reason: `Falta para o pedido de material ${orderLabel(o.number)}${o.collaborator_name ? ` (${o.collaborator_name}${o.posto_name ? ', ' + o.posto_name : ''})` : ''}${o.reason ? ' — ' + o.reason : ''}`.slice(0, 600),
      needed_by: o.needed_by ?? o.start_date,
      items,
      requested_by: by.name,
      requested_by_id: by.id,
      history: [{ at: now, by: by.name, status: 'nova', note: `Gerada pelo pedido ${orderLabel(o.number)}` }],
    })
    .select('id, number')
    .single();
  if (error) throw error;
  return { id: data.id as string, number: Number(data.number) };
}

/** Acrescenta um evento ao histórico do pedido (com controle de concorrência). */
export function event(by: string, what: string) {
  return { at: new Date().toISOString(), by, what };
}
