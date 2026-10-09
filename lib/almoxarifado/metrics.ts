/**
 * Métricas do almoxarifado: agrupa movimentações e solicitações por período.
 * Código puro (sem banco, sem React): a tela, o PNG e a planilha usam estes mesmos números.
 *
 * Regras de contagem (valem para o gráfico e para a planilha):
 *  - ENTRADAS = unidades que entraram no almoxarifado: "entrada" + "devolução" (posto → almoxarifado).
 *  - SAÍDAS   = unidades que saíram do almoxarifado: "saída" + "transferência" (almoxarifado → posto).
 *  - Ajuste de inventário, consumo no posto, criação e exclusão de item NÃO entram em entradas/saídas
 *    (aparecem só nas tabelas de detalhe), para uma importação de planilha não parecer "milhares de entradas".
 *  - MOVIMENTAÇÕES = quantidade de registros, exceto criação/exclusão de item.
 */
import { TZ } from '../format';

export type Period = 'ultimo-dia' | 'hoje' | 'ultima-semana' | 'ultimo-mes';

export const PERIOD_LIST: { id: Period; label: string }[] = [
  { id: 'ultimo-dia', label: 'Último dia' },
  { id: 'hoje', label: 'Hoje' },
  { id: 'ultima-semana', label: 'Última semana' },
  { id: 'ultimo-mes', label: 'Último mês' },
];

export const isPeriod = (v: unknown): v is Period => PERIOD_LIST.some((p) => p.id === v);

export interface MoveInput {
  created_at: string;
  kind: string;
  quantity: number;
  item_id: string | null;
  item_name: string;
  posto_name: string | null;
  before_qty: number | null;
  after_qty: number | null;
  note: string | null;
  by_name: string | null;
}

export interface ReqInput {
  created_at: string;
  status: string;
  protocol: number;
  collaborator: string | null;
  posto: string | null;
  handled_by: string | null;
}

export interface StockSnapshot {
  items: number;
  units: number;
  low: number;
  zero: number;
  /** saldo atual por id de item (usado só para a coluna "Estoque atual" da planilha) */
  qtyById?: Record<string, number>;
}

export interface Bucket {
  /** início do intervalo (ISO) */
  start: string;
  end: string;
  /** rótulo curto do eixo: "14h" ou "05/10" */
  label: string;
  /** rótulo completo para dica/planilha: "ter., 06/10 · 14h–15h" */
  title: string;
  in: number;
  out: number;
  moves: number;
  requests: number;
  /** ainda não aconteceu (só em "Hoje") */
  future: boolean;
}

export interface KindRow {
  kind: string;
  count: number;
  units: number;
}
export interface ItemRow {
  key: string;
  name: string;
  in: number;
  out: number;
  moves: number;
  current: number | null;
}
export interface PostoRow {
  name: string;
  received: number;
  returned: number;
  consumed: number;
  moves: number;
}

export interface MetricsData {
  period: Period;
  periodLabel: string;
  rangeLabel: string;
  from: string;
  to: string;
  generatedAt: string;
  tz: string;
  granularity: 'hour' | 'day';
  buckets: Bucket[];
  totals: {
    in: number;
    out: number;
    net: number;
    moves: number;
    transfers: number;
    returns: number;
    adjustments: number;
    consumed: number;
    itemsMoved: number;
    requests: number;
    requestsOpen: number;
  };
  byKind: KindRow[];
  items: ItemRow[];
  postos: PostoRow[];
  stock: { items: number; units: number; low: number; zero: number };
  /** true quando havia mais registros do que o limite lido */
  truncated: boolean;
}

export const IN_KINDS = ['entrada', 'devolucao'];
export const OUT_KINDS = ['saida', 'transferencia'];
const NOT_MOVES = ['criacao', 'exclusao'];

export const KIND_ORDER = ['entrada', 'devolucao', 'saida', 'transferencia', 'ajuste', 'baixa_posto', 'criacao', 'exclusao'];
export const KIND_LABEL: Record<string, string> = {
  entrada: 'Entrada',
  devolucao: 'Devolução de posto',
  saida: 'Saída',
  transferencia: 'Transferência a posto',
  ajuste: 'Ajuste de inventário',
  baixa_posto: 'Consumo no posto',
  criacao: 'Item criado',
  exclusao: 'Item excluído',
};

const HOUR = 3600_000;
const WEEKDAY = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/* ------------------------------ fuso horário ------------------------------ */

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export interface LocalParts {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
}
export function localParts(ts: number, tz = TZ): LocalParts {
  const o: Record<string, number> = {};
  for (const p of dtf(tz).formatToParts(new Date(ts))) if (p.type !== 'literal') o[p.type] = Number(p.value);
  return { y: o.year, m: o.month, d: o.day, h: o.hour === 24 ? 0 : o.hour, mi: o.minute };
}

/** diferença (local − UTC) em ms naquele instante */
export function tzOffsetMs(ts: number, tz = TZ): number {
  const p = localParts(ts, tz);
  const s = Math.floor(ts / 1000) * 1000;
  const sec = new Date(s).getUTCSeconds();
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, sec) - s;
}

const pad = (n: number) => String(n).padStart(2, '0');
const dayKey = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
export const dayKeyOf = (ts: number, tz = TZ) => {
  const p = localParts(ts, tz);
  return dayKey(p.y, p.m, p.d);
};

/** instante UTC da meia-noite local de um dia */
function localMidnight(y: number, m: number, d: number, tz = TZ): number {
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - tzOffsetMs(guess, tz);
  t = guess - tzOffsetMs(t, tz);
  return t;
}

/** data local (y,m,d) deslocada em n dias */
function shiftDay(y: number, m: number, d: number, n: number) {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

const ddmm = (y: number, m: number, d: number) => `${pad(d)}/${pad(m)}`;
const ddmmyyyy = (y: number, m: number, d: number) => `${pad(d)}/${pad(m)}/${y}`;
const weekdayOf = (y: number, m: number, d: number) => WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];

/* --------------------------------- janela --------------------------------- */

export interface Window {
  period: Period;
  granularity: 'hour' | 'day';
  startMs: number;
  /** fim exclusivo do último intervalo */
  endMs: number;
  slots: { startMs: number; endMs: number; label: string; title: string; key: string }[];
  periodLabel: string;
  rangeLabel: string;
}

export function buildWindow(period: Period, now: number, tz = TZ): Window {
  const periodLabel = PERIOD_LIST.find((p) => p.id === period)!.label;
  const today = localParts(now, tz);

  if (period === 'hoje' || period === 'ultimo-dia') {
    let startMs: number;
    if (period === 'hoje') startMs = localMidnight(today.y, today.m, today.d, tz);
    else startMs = Math.floor(now / HOUR) * HOUR + HOUR - 24 * HOUR;
    const slots: Window['slots'] = [];
    for (let i = 0; i < 24; i++) {
      const s = startMs + i * HOUR;
      const p = localParts(s, tz);
      const e = localParts(s + HOUR, tz);
      slots.push({
        startMs: s,
        endMs: s + HOUR,
        label: `${pad(p.h)}h`,
        title: `${weekdayOf(p.y, p.m, p.d)}., ${ddmm(p.y, p.m, p.d)} · ${pad(p.h)}h–${pad(e.h)}h`,
        key: String(i),
      });
    }
    const first = localParts(startMs, tz);
    const last = localParts(now, tz);
    const rangeLabel =
      period === 'hoje'
        ? `Hoje, ${ddmmyyyy(today.y, today.m, today.d)}`
        : `Últimas 24 horas · ${ddmm(first.y, first.m, first.d)} ${pad(first.h)}h a ${ddmm(last.y, last.m, last.d)} ${pad(last.h)}h`;
    return { period, granularity: 'hour', startMs, endMs: startMs + 24 * HOUR, slots, periodLabel, rangeLabel };
  }

  const n = period === 'ultima-semana' ? 7 : 30;
  const slots: Window['slots'] = [];
  for (let i = n - 1; i >= 0; i--) {
    const s = shiftDay(today.y, today.m, today.d, -i);
    const startMs = localMidnight(s.y, s.m, s.d, tz);
    const next = shiftDay(s.y, s.m, s.d, 1);
    const endMs = localMidnight(next.y, next.m, next.d, tz);
    const wd = weekdayOf(s.y, s.m, s.d);
    slots.push({
      startMs,
      endMs,
      label: period === 'ultima-semana' ? `${wd} ${pad(s.d)}` : ddmm(s.y, s.m, s.d),
      title: `${wd}., ${ddmmyyyy(s.y, s.m, s.d)}`,
      key: dayKey(s.y, s.m, s.d),
    });
  }
  const a = shiftDay(today.y, today.m, today.d, -(n - 1));
  const rangeLabel = `${ddmm(a.y, a.m, a.d)} a ${ddmmyyyy(today.y, today.m, today.d)}`;
  return {
    period,
    granularity: 'day',
    startMs: slots[0].startMs,
    endMs: slots[slots.length - 1].endMs,
    slots,
    periodLabel,
    rangeLabel: `${periodLabel === 'Última semana' ? 'Últimos 7 dias' : 'Últimos 30 dias'} · ${rangeLabel}`,
  };
}

/* -------------------------------- cálculo --------------------------------- */

export interface ComputeOptions {
  tz?: string;
  truncated?: boolean;
}

export function computeMetrics(
  moves: MoveInput[],
  reqs: ReqInput[],
  period: Period,
  now: number,
  stock: StockSnapshot,
  opts: ComputeOptions = {},
): MetricsData {
  const tz = opts.tz ?? TZ;
  const win = buildWindow(period, now, tz);
  const idxByKey = new Map<string, number>();
  win.slots.forEach((s, i) => idxByKey.set(s.key, i));

  const slotOf = (ts: number): number => {
    if (!Number.isFinite(ts) || ts < win.startMs || ts >= win.endMs || ts > now) return -1;
    if (win.granularity === 'hour') return Math.floor((ts - win.startMs) / HOUR);
    return idxByKey.get(dayKeyOf(ts, tz)) ?? -1;
  };

  const buckets: Bucket[] = win.slots.map((s) => ({
    start: new Date(s.startMs).toISOString(),
    end: new Date(s.endMs).toISOString(),
    label: s.label,
    title: s.title,
    in: 0,
    out: 0,
    moves: 0,
    requests: 0,
    future: s.startMs > now,
  }));

  const kinds = new Map<string, KindRow>();
  const items = new Map<string, ItemRow>();
  const postos = new Map<string, PostoRow>();
  const t = { in: 0, out: 0, moves: 0, transfers: 0, returns: 0, adjustments: 0, consumed: 0 };
  const moved = new Set<string>();

  for (const m of moves) {
    const ts = Date.parse(m.created_at);
    const i = slotOf(ts);
    if (i < 0) continue;
    const q = Number.isFinite(Number(m.quantity)) ? Math.max(0, Math.trunc(Number(m.quantity))) : 0;
    const k = m.kind;

    const kr = kinds.get(k) ?? { kind: k, count: 0, units: 0 };
    kr.count++;
    kr.units += q;
    kinds.set(k, kr);

    if (NOT_MOVES.includes(k)) continue;
    t.moves++;
    buckets[i].moves++;

    const isIn = IN_KINDS.includes(k);
    const isOut = OUT_KINDS.includes(k);
    if (isIn) {
      t.in += q;
      buckets[i].in += q;
    }
    if (isOut) {
      t.out += q;
      buckets[i].out += q;
    }
    if (k === 'transferencia') t.transfers += q;
    if (k === 'devolucao') t.returns += q;
    if (k === 'ajuste') t.adjustments++;
    if (k === 'baixa_posto') t.consumed += q;

    if (isIn || isOut) {
      const key = m.item_id ?? `n:${m.item_name}`;
      moved.add(key);
      const ir = items.get(key) ?? { key, name: m.item_name, in: 0, out: 0, moves: 0, current: null };
      if (isIn) ir.in += q;
      if (isOut) ir.out += q;
      ir.moves++;
      if (m.item_id && stock.qtyById && m.item_id in stock.qtyById) ir.current = stock.qtyById[m.item_id];
      items.set(key, ir);
    }

    if (m.posto_name && (k === 'transferencia' || k === 'devolucao' || k === 'baixa_posto')) {
      const pr = postos.get(m.posto_name) ?? { name: m.posto_name, received: 0, returned: 0, consumed: 0, moves: 0 };
      if (k === 'transferencia') pr.received += q;
      if (k === 'devolucao') pr.returned += q;
      if (k === 'baixa_posto') pr.consumed += q;
      pr.moves++;
      postos.set(m.posto_name, pr);
    }
  }

  let reqTotal = 0;
  let reqOpen = 0;
  for (const r of reqs) {
    const i = slotOf(Date.parse(r.created_at));
    if (i < 0) continue;
    buckets[i].requests++;
    reqTotal++;
    if (r.status === 'nova' || r.status === 'pendente') reqOpen++;
  }

  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'pt-BR');
  return {
    period,
    periodLabel: win.periodLabel,
    rangeLabel: win.rangeLabel,
    from: new Date(win.startMs).toISOString(),
    to: new Date(Math.min(now, win.endMs)).toISOString(),
    generatedAt: new Date(now).toISOString(),
    tz,
    granularity: win.granularity,
    buckets,
    totals: {
      ...t,
      net: t.in - t.out,
      itemsMoved: moved.size,
      requests: reqTotal,
      requestsOpen: reqOpen,
    },
    byKind: [...kinds.values()].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)),
    items: [...items.values()].sort((a, b) => b.out - a.out || b.in - a.in || byName(a, b)),
    postos: [...postos.values()].sort((a, b) => b.received - a.received || b.returned - a.returned || byName(a, b)),
    stock: { items: stock.items, units: stock.units, low: stock.low, zero: stock.zero },
    truncated: Boolean(opts.truncated),
  };
}

/** nome de arquivo seguro: Metricas-Almoxarifado_ultima-semana_2026-10-07 */
export function exportBaseName(data: Pick<MetricsData, 'period' | 'generatedAt' | 'tz'>): string {
  return `Metricas-Almoxarifado_${data.period}_${dayKeyOf(Date.parse(data.generatedAt), data.tz)}`;
}
