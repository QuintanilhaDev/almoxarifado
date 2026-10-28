import 'server-only';
import { db } from '../supabaseAdmin';
import { normalize } from '../max/text';
import type { StockItem } from '../almoxarifado/types';
import { lineFor, sizeFieldFor } from './server';
import { UUID_RE, str } from '../almoxarifado/stockData';
import type { OrderItem } from './types';
import { todayBahia } from './types';

export type SizeField = 'camisa' | 'calca' | 'calcado';
export interface KitItem {
  name: string;
  /** de qual tamanho do colaborador sai o tamanho (null = sem tamanho / item fixo) */
  size_from: SizeField | null;
  qty: number;
  item_id?: string | null;
}
export interface RoleKit {
  role: string;
  items: KitItem[];
  period_months: number;
  updated_by: string | null;
  updated_at: string;
}
export interface Collaborator {
  id: string;
  name: string;
  matricula: string | null;
  role: string | null;
  posto_id: string | null;
  posto_name: string | null;
  company: string | null;
  admitted_at: string | null;
  active: boolean;
  sizes: Partial<Record<SizeField, string>>;
  phone: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}
export const COLLAB_COLS = 'id, name, matricula, role, posto_id, posto_name, company, admitted_at, active, sizes, phone, notes, created_at, updated_at';

export const roleKey = (r: string | null | undefined) => normalize(String(r ?? '')).trim();

export async function loadKits(): Promise<RoleKit[]> {
  const { data, error } = await db().from('role_kits').select('role, items, period_months, updated_by, updated_at').order('role');
  if (error) throw error;
  return (data ?? []).map((k) => ({ ...(k as RoleKit), items: Array.isArray(k.items) ? (k.items as KitItem[]) : [], period_months: Number(k.period_months) || 12 }));
}
export const kitFor = (kits: RoleKit[], role: string | null | undefined) => kits.find((k) => roleKey(k.role) === roleKey(role)) ?? null;

/** Kit da função → linhas do pedido, com os tamanhos do colaborador. */
export function kitLines(kit: RoleKit, sizes: Partial<Record<SizeField, string>>, stock: StockItem[]): OrderItem[] {
  return kit.items.map((k) => {
    const fixed = k.item_id ? stock.find((s) => s.id === k.item_id) : null;
    if (fixed && !k.size_from) return { item_id: fixed.id, name: fixed.name, size: fixed.size, unit: fixed.unit, qty: k.qty, reserved: 0, delivered: 0, note: null };
    const field = k.size_from ?? sizeFieldFor(k.name);
    const size = field ? sizes[field]?.trim() || null : null;
    const line = lineFor(fixed?.name ?? k.name, size, k.qty, stock);
    if (field && !size) return { ...line, item_id: null, check: true, note: `Falta o tamanho de ${field === 'calcado' ? 'calçado' : field} no cadastro` };
    return line;
  });
}

export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}

export interface TradeRow {
  collaborator: Pick<Collaborator, 'id' | 'name' | 'matricula' | 'role' | 'posto_name' | 'company' | 'sizes'>;
  period_months: number;
  /** data-base: última troca regular (ou admissão) */
  base: string | null;
  base_kind: 'troca' | 'admissao' | 'sem_registro';
  due: string | null;
  status: 'vencida' | 'proxima' | 'em_dia' | 'sem_data';
  days: number | null;
  open_order: number | null;
}

/** Quem está para trocar (Projeto 3, seção 5). */
export async function tradeRows(opts: { alertDays: number; extraResets: boolean }): Promise<{ rows: TradeRow[]; kits: RoleKit[]; noKit: string[] }> {
  const kits = await loadKits();
  const { data: cs, error } = await db().from('collaborators').select(COLLAB_COLS).eq('active', true).order('name').limit(5000);
  if (error) throw error;
  const ids = (cs ?? []).map((c) => c.id as string);
  // últimas entregas de fardamento (categorias 01/02, ou qualquer item com tamanho de roupa/calçado)
  const lastBy = new Map<string, string>();
  if (ids.length) {
    const kinds = opts.extraResets ? ['regular', 'extra'] : ['regular'];
    const { data: del } = await db().from('deliveries').select('collaborator_id, item_name, cat_code, delivered_at, kind').in('kind', kinds).order('delivered_at', { ascending: false }).limit(20000);
    for (const d of del ?? []) {
      const cid = d.collaborator_id as string | null;
      if (!cid || lastBy.has(cid)) continue;
      const personal = d.cat_code === '01' || d.cat_code === '02' || Boolean(sizeFieldFor(String(d.item_name)));
      // dia em Salvador (UTC-3): entrega às 21h30 não pode cair no dia seguinte
      const t = Date.parse(String(d.delivered_at));
      if (personal) lastBy.set(cid, Number.isFinite(t) ? new Date(t - 3 * 3_600_000).toISOString().slice(0, 10) : String(d.delivered_at).slice(0, 10));
    }
  }
  const { data: open } = await db().from('material_orders').select('number, collaborator_id').eq('origin', 'rh_troca').in('stage', ['validacao', 'encaminhado', 'solicitado']).limit(5000);
  const openBy = new Map((open ?? []).map((o) => [o.collaborator_id as string, Number(o.number)]));
  const today = todayBahia();
  const dayDiff = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000);
  const rows: TradeRow[] = [];
  const noKit = new Set<string>();
  for (const c of (cs ?? []) as Collaborator[]) {
    const kit = kitFor(kits, c.role);
    if (!kit) {
      if (c.role) noKit.add(c.role);
      continue;
    }
    const last = lastBy.get(c.id) ?? null;
    const base = last ?? c.admitted_at ?? null;
    const due = base ? addMonths(base, kit.period_months) : null;
    const days = due ? dayDiff(due, today) : null;
    rows.push({
      collaborator: { id: c.id, name: c.name, matricula: c.matricula, role: c.role, posto_name: c.posto_name, company: c.company, sizes: c.sizes ?? {} },
      period_months: kit.period_months,
      base,
      base_kind: last ? 'troca' : c.admitted_at ? 'admissao' : 'sem_registro',
      due,
      status: days === null ? 'sem_data' : days < 0 ? 'vencida' : days <= opts.alertDays ? 'proxima' : 'em_dia',
      days,
      open_order: openBy.get(c.id) ?? null,
    });
  }
  const rank = { vencida: 0, proxima: 1, sem_data: 2, em_dia: 3 } as const;
  rows.sort((a, b) => rank[a.status] - rank[b.status] || (a.days ?? 0) - (b.days ?? 0) || a.collaborator.name.localeCompare(b.collaborator.name, 'pt-BR'));
  return { rows, kits, noKit: [...noKit].sort() };
}

export function cleanSizes(v: unknown): Partial<Record<SizeField, string>> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const o = v as Record<string, unknown>;
  const out: Partial<Record<SizeField, string>> = {};
  for (const k of ['camisa', 'calca', 'calcado'] as SizeField[]) {
    const s = String(o[k] ?? '').trim().toUpperCase().slice(0, 10);
    if (s) out[k] = s;
  }
  return out;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** data que existe no calendário (Date.parse aceita 2024-02-31) */
const dataReal = (iso: string) => {
  if (!DATE_RE.test(iso)) return false;
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};
type Row = Record<string, unknown>;

/** um colaborador a partir do corpo (ou da linha da planilha) */
export function collabFields(x: Row, postos: { id: string; name: string }[]): { error: string } | { row: Row } {
  const name = str(x.name ?? x.nome, 120);
  if (!name) return { error: 'Informe o nome.' };
  const row: Row = { name };
  row.matricula = str(x.matricula, 40);
  row.role = str(x.role ?? x.funcao ?? x['função'], 80);
  row.company = str(x.company ?? x.empresa, 80);
  row.client = str(x.client ?? x.cliente, 120);
  row.phone = str(x.phone ?? x.telefone, 30);
  row.notes = str(x.notes ?? x.observacoes, 300);
  const adm = String(x.admitted_at ?? x.admissao ?? '').trim();
  if (adm) {
    const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(adm);
    const iso = br ? `${br[3]}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}` : adm.slice(0, 10);
    if (!dataReal(iso)) return { error: `Data de admissão inválida: ${adm}` };
    row.admitted_at = iso;
  } else row.admitted_at = null;
  const pid = typeof x.posto_id === 'string' && UUID_RE.test(x.posto_id) ? x.posto_id : null;
  const pname = str(x.posto_name ?? x.posto, 120);
  const hit = pid ? postos.find((p) => p.id === pid) : pname ? postos.find((p) => normalize(p.name) === normalize(pname)) : undefined;
  row.posto_id = hit?.id ?? null;
  row.posto_name = hit?.name ?? pname;
  row.sizes = cleanSizes(x.sizes ?? { camisa: x.camisa, calca: x.calca ?? x['calça'], calcado: x.calcado ?? x['calçado'] });
  return { row };
}

