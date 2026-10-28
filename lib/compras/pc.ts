/**
 * Cotações e pedidos de compra (especificação do Módulo de Compras).
 * Tipos e contas usados pelo servidor e pelas telas.
 */
import { addDays, todayBahia } from './prazo';

export interface Attachment {
  path: string;
  name: string;
  size: number;
  type: string;
  at?: string;
  by?: string;
}

/* ------------------------------------------------------------------ */
/* cotação                                                             */
/* ------------------------------------------------------------------ */
export interface QuoteItem {
  key: string;
  item_id: string | null;
  name: string;
  size: string | null;
  unit: string;
  qty: number;
  /** requisições de compra de onde veio (uma cotação pode juntar várias) */
  requests: { id: string; number: number; qty: number }[];
}

export type Adherence = 'total' | 'parcial' | 'nao';
export interface ProposalLine {
  key: string;
  /** preço unitário final (depois da negociação) */
  unit_price: number | null;
  /** primeiro preço oferecido (para medir a economia negociada) */
  first_price: number | null;
  qty: number | null;
  brand: string | null;
  model: string | null;
  ext_code: string | null;
  warranty: string | null;
  adherence: Adherence;
  available: boolean;
  note: string | null;
}
export type ProposalStatus = 'aguardando' | 'recebida' | 'recusada';
export interface Payment {
  mode: 'avista' | 'parcelado';
  installments: number;
  days: string | null;
  note: string | null;
}
export interface Delivery {
  days: number | null;
  business: boolean;
  mode: 'pronta' | 'producao';
  date: string | null;
  location: string | null;
}
export interface Proposal {
  id: string;
  supplier_id: string;
  supplier_name: string;
  cnpj: string | null;
  homologation: 'pendente' | 'homologado' | 'bloqueado';
  status: ProposalStatus;
  sent_at: string | null;
  sent_via: string | null;
  returned_at: string | null;
  valid_until: string | null;
  payment: Payment;
  delivery: Delivery;
  freight: number;
  other_costs: number;
  discount: number;
  lines: ProposalLine[];
  attachments: Attachment[];
  note: string | null;
  updated_at: string;
  updated_by: string | null;
}
export interface QuoteDecision {
  lines: Record<string, string>;
  justification: string | null;
  by: string;
  at: string;
}
export type QuoteStatus = 'aberta' | 'decidida' | 'cancelada';
export interface Quote {
  id: string;
  number: number;
  status: QuoteStatus;
  request_ids: string[];
  items: QuoteItem[];
  proposals: Proposal[];
  decision: QuoteDecision | null;
  reply_by: string | null;
  note: string | null;
  created_by: string | null;
  history: { at: string; by: string; what: string }[];
  created_at: string;
  updated_at: string;
}

export const QUOTE_STATUS: Record<QuoteStatus, { label: string; tone: string }> = {
  aberta: { label: 'Aberta', tone: 'amber' },
  decidida: { label: 'Decidida', tone: 'green' },
  cancelada: { label: 'Cancelada', tone: 'gray' },
};
export const PROPOSAL_STATUS: Record<ProposalStatus, string> = { aguardando: 'Aguardando resposta', recebida: 'Recebida', recusada: 'Não cotou' };
export const quoteLabel = (n: number) => 'COT ' + String(n).padStart(4, '0');

const r2 = (n: number) => Math.round(n * 100) / 100;

/** a proposta passou da validade? */
export const proposalExpired = (p: Pick<Proposal, 'valid_until' | 'status'>, today = todayBahia()) => p.status === 'recebida' && Boolean(p.valid_until && p.valid_until < today);

/** valor dos itens de uma proposta (só os preenchidos) */
export function proposalGoods(p: Proposal, items: QuoteItem[], only?: Set<string>): number {
  let t = 0;
  for (const l of p.lines) {
    if (only && !only.has(l.key)) continue;
    const it = items.find((i) => i.key === l.key);
    if (!it || l.unit_price === null || !l.available) continue;
    t += l.unit_price * (l.qty ?? it.qty);
  }
  return r2(t);
}
/** custo total da proposta: itens + frete + outros − desconto */
export const proposalTotal = (p: Proposal, items: QuoteItem[]) => r2(proposalGoods(p, items) + (p.freight || 0) + (p.other_costs || 0) - (p.discount || 0));

/**
 * Custo efetivo por unidade de uma linha: preço + a parte do frete/outros/desconto da
 * proposta, rateada pelo valor dos itens. É o que o mapa compara (não só o preço).
 */
export function effectiveUnit(p: Proposal, items: QuoteItem[], key: string): number | null {
  const l = p.lines.find((x) => x.key === key);
  const it = items.find((i) => i.key === key);
  if (!l || !it || l.unit_price === null || !l.available) return null;
  const goods = proposalGoods(p, items);
  const extra = (p.freight || 0) + (p.other_costs || 0) - (p.discount || 0);
  const share = goods > 0 ? (l.unit_price * (l.qty ?? it.qty)) / goods : 0;
  const q = l.qty ?? it.qty;
  return q > 0 ? Math.round(((l.unit_price * q + extra * share) / q) * 10000) / 10000 : null;
}

/** prazo prometido da proposta, como data (para comparar com o "precisa até") */
export function proposalDate(p: Proposal, from = todayBahia()): string | null {
  if (p.delivery.date) return p.delivery.date;
  if (p.delivery.days === null || p.delivery.days === undefined) return null;
  return addDays(from, p.delivery.days, p.delivery.business);
}

/**
 * Recomendação por item (não escolhe sozinha): menor custo efetivo entre as propostas
 * recebidas, válidas, de fornecedor homologado, com o item disponível e aderente.
 */
export function recommend(q: Quote, today = todayBahia()): Record<string, { proposal_id: string; unit: number } | null> {
  const out: Record<string, { proposal_id: string; unit: number } | null> = {};
  for (const it of q.items) {
    let best: { proposal_id: string; unit: number } | null = null;
    for (const p of q.proposals) {
      // só fornecedor homologado pode ser contratado (o mesmo critério da decisão)
      if (p.status !== 'recebida' || proposalExpired(p, today) || p.homologation !== 'homologado') continue;
      const l = p.lines.find((x) => x.key === it.key);
      if (!l || l.adherence === 'nao') continue;
      const u = effectiveUnit(p, q.items, it.key);
      if (u === null) continue;
      if (!best || u < best.unit) best = { proposal_id: p.id, unit: u };
    }
    out[it.key] = best;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* pedido de compra                                                    */
/* ------------------------------------------------------------------ */
export type POStatus = 'rascunho' | 'aguardando_aprovacao' | 'aprovado' | 'enviado' | 'confirmado' | 'parcial' | 'concluido' | 'cancelado';
export interface POItem {
  key: string;
  item_id: string | null;
  name: string;
  size: string | null;
  unit: string;
  qty: number;
  unit_price: number;
  /** primeiro preço da proposta (economia negociada) */
  first_price?: number | null;
  ext_code: string | null;
  brand: string | null;
  spec: string | null;
  /** já aceito no estoque (vem das notas) */
  received: number;
  requests: { id: string; number: number; qty: number }[];
}
export interface PurchaseOrder {
  id: string;
  number: number;
  status: POStatus;
  quote_id: string | null;
  request_ids: string[];
  supplier_id: string | null;
  supplier_name: string;
  cnpj: string | null;
  items: POItem[];
  freight: number;
  other_costs: number;
  discount: number;
  total: number;
  payment: Payment;
  delivery: Delivery;
  expected_date: string | null;
  promised_date: string | null;
  notes: string | null;
  attachments: Attachment[];
  approval: {
    by: string;
    at: string;
    note: string | null;
    total: number;
    auto?: boolean;
    /** o que foi aprovado (uma alteração recusada volta para cá) */
    snapshot?: Pick<PurchaseOrder, 'items' | 'freight' | 'other_costs' | 'discount' | 'payment' | 'delivery'>;
  } | null;
  approved_hash: string | null;
  sent_at: string | null;
  sent_by: string | null;
  sent_via: string | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
  cancel_reason: string | null;
  created_by: string | null;
  history: { at: string; by: string; what: string }[];
  created_at: string;
  updated_at: string;
}

export const PO_STATUS: Record<POStatus, { label: string; tone: string }> = {
  rascunho: { label: 'Rascunho', tone: 'gray' },
  aguardando_aprovacao: { label: 'Aguardando aprovação', tone: 'amber' },
  aprovado: { label: 'Aprovado', tone: 'lilac' },
  enviado: { label: 'Enviado ao fornecedor', tone: 'blue' },
  confirmado: { label: 'Confirmado', tone: 'blue' },
  parcial: { label: 'Entrega parcial', tone: 'amber' },
  concluido: { label: 'Concluído', tone: 'green' },
  cancelado: { label: 'Cancelado', tone: 'gray' },
};
/** pedidos que contam como "em compra / a receber" */
export const PO_OPEN: POStatus[] = ['aprovado', 'enviado', 'confirmado', 'parcial'];
export const poLabel = (n: number) => 'PC ' + String(n).padStart(4, '0');

export const poGoods = (items: Pick<POItem, 'qty' | 'unit_price'>[]) => r2(items.reduce((t, i) => t + i.qty * i.unit_price, 0));
export const poTotal = (o: Pick<PurchaseOrder, 'items' | 'freight' | 'other_costs' | 'discount'>) => r2(poGoods(o.items) + (o.freight || 0) + (o.other_costs || 0) - (o.discount || 0));

/** data que vale para a chegada: a confirmada pelo fornecedor, senão a prevista */
export const poDue = (o: Pick<PurchaseOrder, 'promised_date' | 'expected_date'>) => o.promised_date ?? o.expected_date;
/** atrasado: ainda a receber e a data já passou */
export const poLate = (o: Pick<PurchaseOrder, 'status' | 'promised_date' | 'expected_date'>, today = todayBahia()) => {
  const d = poDue(o);
  return PO_OPEN.includes(o.status) && Boolean(d && d < today);
};
/** quanto ainda falta receber de cada linha */
export const poLeft = (i: Pick<POItem, 'qty' | 'received'>) => Math.max(0, i.qty - (i.received || 0));

/**
 * "Assinatura" do que é aprovado: itens, quantidades, preços, fornecedor, custos e
 * pagamento. Se mudar depois da aprovação, o pedido volta para aprovação.
 */
export function approvalHash(o: Pick<PurchaseOrder, 'items' | 'freight' | 'other_costs' | 'discount' | 'supplier_id' | 'supplier_name' | 'payment'>): string {
  const basis = JSON.stringify({
    s: o.supplier_id ?? o.supplier_name,
    i: o.items.map((i) => [i.item_id ?? i.name, i.size, i.qty, i.unit_price]),
    f: [o.freight, o.other_costs, o.discount],
    p: [o.payment?.mode, o.payment?.installments, o.payment?.days],
  });
  let h = 5381;
  for (let k = 0; k < basis.length; k++) h = ((h << 5) + h + basis.charCodeAt(k)) | 0;
  return (h >>> 0).toString(36);
}

/* ------------------------------------------------------------------ */
/* regras configuráveis                                                */
/* ------------------------------------------------------------------ */
export interface ComprasConfig {
  /** pedidos com total ABAIXO deste valor são aprovados sozinhos (0 = todos passam por aprovação) */
  approval_min: number;
  /** local de entrega padrão */
  delivery_location: string;
  /** dados da empresa no cabeçalho do pedido e da solicitação de orçamento */
  company: { name: string; cnpj: string; address: string; phone: string; email: string };
  /** validade padrão pedida nas propostas (dias) */
  quote_valid_days: number;
  /** tolerância de preço entre nota e pedido (R$ por unidade) */
  price_tolerance: number;
}
export const DEFAULT_CONFIG: ComprasConfig = {
  approval_min: 0,
  delivery_location: 'Almoxarifado — Salvador/BA',
  company: { name: 'Grupo Max Forte', cnpj: '', address: 'Salvador/BA', phone: '', email: '' },
  quote_valid_days: 7,
  price_tolerance: 0.01,
};

/**
 * Valor digitado em reais: "1.500,50" e "1500,50" → 1500.5; "1.500" (ponto + 3 dígitos,
 * sem vírgula) → 1500 (milhar); "2000.50" → 2000.5. Inválido → NaN.
 */
export function parseBRL(raw: string): number {
  const t = raw.trim().replace(/^R\$\s*/i, '').replace(/\s/g, '');
  if (!t) return NaN;
  if (t.includes(',')) return /^-?[\d.]*,\d*$/.test(t) ? Number(t.replace(/\./g, '').replace(',', '.')) : NaN;
  if (/^-?[1-9]\d{0,2}(\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, ''));
  return Number(t);
}

export const brl = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
export const paymentText = (p: Partial<Payment> | null | undefined) =>
  !p || !p.mode ? '—' : p.mode === 'avista' ? 'À vista' + (p.days ? ` (${p.days})` : '') : `${p.installments || 1}x${p.days ? ` (${p.days})` : ''}`;
