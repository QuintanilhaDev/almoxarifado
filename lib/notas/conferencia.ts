/**
 * Recebimento pelo pedido (especificação Estoque/Recebimento/NF/Pagamentos):
 * divergências, chave de acesso do DANFE e parcelas. Usado pelo servidor e pelas telas.
 */
import { addDays, todayBahia } from '../compras/prazo';

export type DivKind = 'preco' | 'quantidade_pedido' | 'item_fora' | 'fornecedor' | 'pagamento' | 'frete' | 'falta' | 'recusa';
export interface Divergence {
  id: string;
  kind: DivKind;
  /** linha da nota (null = nota inteira) */
  line: number | null;
  text: string;
  expected: string | null;
  found: string | null;
  /** comercial: precisa ser tratada (Compras/gestão) antes de dar entrada */
  blocking: boolean;
  status: 'aberta' | 'resolvida';
  decision?: 'autorizada' | 'tratada' | null;
  resolution?: string | null;
  by?: string | null;
  at?: string | null;
  created_at: string;
}

export const DIV_LABEL: Record<DivKind, string> = {
  preco: 'Preço diferente do pedido',
  quantidade_pedido: 'Faturado acima do pedido',
  item_fora: 'Item fora do pedido',
  fornecedor: 'Fornecedor diferente do pedido',
  pagamento: 'Pagamento diferente do pedido',
  frete: 'Frete não previsto no pedido',
  falta: 'Entregue menos que o faturado',
  recusa: 'Itens recusados na conferência',
};
/** as comerciais travam a entrada até alguém de Compras/gestão tratar */
export const BLOCKING: DivKind[] = ['preco', 'quantidade_pedido', 'item_fora', 'fornecedor', 'pagamento', 'frete'];

export const openBlocking = (d: Divergence[] | null | undefined) => (d ?? []).filter((x) => x.status !== 'resolvida' && x.blocking);
export const openAny = (d: Divergence[] | null | undefined) => (d ?? []).filter((x) => x.status !== 'resolvida');

/* ------------------------------------------------------------------ */
/* chave de acesso (44 dígitos): o DANFE traz em código de barras       */
/* ------------------------------------------------------------------ */
export interface KeyInfo {
  uf: string;
  year: string;
  month: string;
  cnpj: string;
  model: string;
  series: string;
  number: string;
}
/** Tira da chave: CNPJ do emitente, modelo, série, número e mês/ano da emissão. */
export function keyInfo(raw: string): KeyInfo | null {
  const k = raw.replace(/\D/g, '');
  if (k.length !== 44) return null;
  return {
    uf: k.slice(0, 2),
    year: '20' + k.slice(2, 4),
    month: k.slice(4, 6),
    cnpj: k.slice(6, 20),
    model: k.slice(20, 22),
    series: String(Number(k.slice(22, 25))),
    number: String(Number(k.slice(25, 34))),
  };
}
export function validKey(raw: string): boolean {
  const k = raw.replace(/\D/g, '');
  if (!/^\d{44}$/.test(k)) return false;
  let w = 2;
  let s = 0;
  for (let i = 42; i >= 0; i--) {
    s += Number(k[i]) * w;
    w = w === 9 ? 2 : w + 1;
  }
  const dv = s % 11 < 2 ? 0 : 11 - (s % 11);
  return dv === Number(k[43]);
}
/** acha uma chave de 44 dígitos num texto (o PDF do DANFE costuma trazer em blocos de 4) */
export function findKey(text: string): string | null {
  const flat = text.replace(/[^\d\s.]/g, ' ');
  const m = flat.match(/(?:\d[\s.]*){44}/g) ?? [];
  for (const c of m) {
    const k = c.replace(/\D/g, '').slice(0, 44);
    if (validKey(k)) return k;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* parcelas                                                            */
/* ------------------------------------------------------------------ */
export interface Installment {
  n: string;
  due: string | null;
  value: number;
  obs?: string | null;
  method?: string | null;
  ref?: string | null;
}
const cents = (v: number) => Math.round(v * 100);
/** diferença (em reais) entre a soma das parcelas e o total da nota */
export const installmentsGap = (list: Pick<Installment, 'value'>[], total: number) => (list.reduce((t, p) => t + cents(Number(p.value) || 0), 0) - cents(total)) / 100;

/**
 * Sugere as parcelas pela condição do pedido ("30/60/90", "28 dias", 3x…): valores iguais,
 * centavos de diferença na última. É só sugestão: a pessoa confere antes de validar.
 */
export function suggestInstallments(total: number, payment: { mode?: string; installments?: number; days?: string | null } | null | undefined, from = todayBahia()): Installment[] {
  const n = payment?.mode === 'parcelado' ? Math.max(1, Math.min(48, payment.installments || 1)) : 1;
  const nums = (payment?.days ?? '').match(/\d+/g)?.map(Number).filter((d) => d > 0 && d <= 720) ?? [];
  const days = Array.from({ length: n }, (_, i) => nums[i] ?? (nums.length ? nums[nums.length - 1] + 30 * (i - nums.length + 1) : payment?.mode === 'parcelado' ? 30 * (i + 1) : 0));
  const each = Math.floor(cents(total) / n);
  return days.map((d, i) => ({
    n: `${i + 1}/${n}`,
    due: addDays(from, d, false),
    value: (i === n - 1 ? cents(total) - each * (n - 1) : each) / 100,
    obs: null,
    method: null,
    ref: null,
  }));
}

export const moneyBR = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
