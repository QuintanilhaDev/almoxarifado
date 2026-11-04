import 'server-only';
import { db } from '../supabaseAdmin';
import { fail } from '../http';
import { fetchAll } from '../almoxarifado/stockData';
import { loadKits } from '../pedidos/rh';
import { kitDoColab, mapaContratos } from './contratosServer';
import { carregarAvulsos } from './avulsos';
import { todayBahia } from '../pedidos/types';
import { collabCols } from './desligamento';
import type { ControleFarda } from '../fardamento/types';
import { apurarColab, campoTamanho, fold, porContrato, resumir, type ColabC, type ColabControle, type Contrato, type EntregaC, type Exigencia, type NumeroInd, type PedidoAberto, type RegistroC } from './controle';

/**
 * Carrega tudo o que o controle precisa e calcula: colaboradores ativos, kits, entregas do
 * sistema (menos o que voltou) e da planilha de controle da Gestão, exigências e registros,
 * pedidos com reserva e o que está nos postos.
 */
export const CTRL_SETUP = 'O controle de ASO, cursos e documentos ainda não foi ativado no banco. Rode o arquivo supabase/controle_rh.sql no SQL Editor do Supabase.';
export const ctrlFail = () => fail(CTRL_SETUP, 409, { setup: true });

let cache: { ok: boolean; at: number } | null = null;
export async function temControle(): Promise<boolean> {
  if (cache && (cache.ok || Date.now() - cache.at < 60_000)) return cache.ok;
  const a = await db().from('requirements').select('id').limit(1);
  const b = a.error ? a : await db().from('collaborator_records').select('id').limit(1);
  cache = { ok: !a.error && !b.error, at: Date.now() };
  return cache.ok;
}

export const REQ_COLS = 'id, kind, name, roles, clients, companies, validity_months, alert_days, notes, active';
export const REC_COLS = 'id, collaborator_id, requirement_id, done_at, expires_at, notes, created_by, created_at';

export async function carregarExigencias(): Promise<Exigencia[]> {
  if (!(await temControle())) return [];
  const rs = await fetchAll<Exigencia>('requirements', REQ_COLS, { column: 'name', tiebreak: 'id' });
  return rs.map((r) => ({ ...r, roles: r.roles ?? [], clients: r.clients ?? [], companies: r.companies ?? [] }));
}

/** dia em Salvador (UTC-3) de um horário do banco */
const dataBahia = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t - 3 * 3_600_000).toISOString().slice(0, 10) : null;
};
const OPEN = ['solicitado', 'validacao', 'encaminhado'];

export interface Controle {
  hoje: string;
  colabs: ColabControle[];
  resumo: NumeroInd[];
  contratos: Contrato[];
  estoque: { fisico: number; reservado: number; disponivel: number; noPosto: number; emUso: number };
  exigencias: Exigencia[];
  temExigencias: boolean;
  semPlanilha: boolean;
}

export async function carregarControle(): Promise<Controle> {
  const hoje = todayBahia();
  const cols = await collabCols();
  const [colabs, kits, entregasRaw, meta, exigencias, temEx] = await Promise.all([
    fetchAll<ColabC & { active: boolean }>('collaborators', cols, { column: 'name', tiebreak: 'id' }, (q) => q.eq('active', true)),
    loadKits(),
    fetchAll<{ collaborator_id: string | null; item_id: string | null; item_name: string; size: string | null; qty: number; returned_qty: number | null; delivered_at: string }>('deliveries', 'collaborator_id, item_id, item_name, size, qty, returned_qty, delivered_at', { column: 'delivered_at', tiebreak: 'id' }),
    db().from('hub_meta').select('value').eq('key', 'fardamento_controle').maybeSingle(),
    carregarExigencias(),
    temControle(),
  ]);
  const registros = temEx ? await fetchAll<RegistroC>('collaborator_records', REC_COLS, { column: 'done_at', tiebreak: 'id' }) : [];

  // entregas por colaborador: do sistema pelo id; da planilha da Gestão pelo nome
  const porId = new Map<string, EntregaC[]>();
  for (const d of entregasRaw) {
    if (!d.collaborator_id) continue;
    const q = Number(d.qty) - Number(d.returned_qty ?? 0);
    if (q <= 0) continue;
    const e: EntregaC = { collaborator_id: d.collaborator_id, item_id: d.item_id, item_name: d.item_name, size: d.size, qty: q, date: dataBahia(d.delivered_at), source: 'sistema' };
    porId.set(d.collaborator_id, [...(porId.get(d.collaborator_id) ?? []), e]);
  }
  const ctrl = meta.data?.value as ControleFarda | undefined;
  const porNome = new Map<string, EntregaC[]>();
  for (const e of ctrl?.entregas ?? []) {
    const k = fold(e.f);
    const dt = e.d ?? (e.m ? `${e.m}-01` : null);
    for (const [peca, tam, q] of e.i) porNome.set(k, [...(porNome.get(k) ?? []), { collaborator_id: null, nome: e.f, item_name: peca, size: tam, qty: q, date: dt, source: 'planilha' }]);
  }
  const regPor = new Map<string, RegistroC[]>();
  for (const r of registros) regPor.set(r.collaborator_id, [...(regPor.get(r.collaborator_id) ?? []), r]);

  const { doColab } = await mapaContratos();
  const avulsos = await carregarAvulsos();
  const cs = colabs.map((c) => {
    const ct = doColab(c);
    return apurarColab({ ...c, contrato: ct?.name ?? null, sizes: c.sizes ?? {} }, kitDoColab(kits, c.role, ct), [...(porId.get(c.id) ?? []), ...(porNome.get(fold(c.name)) ?? [])], exigencias, regPor.get(c.id) ?? [], hoje, undefined, avulsos);
  });

  // reservas dos pedidos em aberto e o que está nos postos (só fardamento)
  const [orders, postoStock, items] = await Promise.all([
    fetchAll<{ collaborator_id: string | null; posto_id: string | null; posto_name: string | null; items: { reserved?: number }[] }>('material_orders', 'collaborator_id, posto_id, posto_name, items', { column: 'number' }, (q) => q.in('stage', OPEN)).catch(() => []),
    fetchAll<{ posto_id: string; item_id: string; quantity: number }>('posto_stock', 'posto_id, item_id, quantity', { column: 'posto_id', tiebreak: 'item_id' }).catch(() => []),
    fetchAll<{ id: string; name: string; quantity: number; reserved: number | null; cat_code: string | null; active: boolean | null }>('stock_items', 'id, name, quantity, reserved, cat_code, active', { column: 'id' }).catch(() => []),
  ]);
  const farda = new Set(items.filter((i) => i.cat_code === '01' || i.cat_code === '02' || campoTamanho(i.name)).map((i) => i.id));
  const pedidos: PedidoAberto[] = orders.map((o) => ({ collaborator_id: o.collaborator_id, posto_id: o.posto_id, posto_name: o.posto_name, reservado: (Array.isArray(o.items) ? o.items : []).reduce((t, l) => t + Math.max(0, Number(l.reserved ?? 0)), 0) }));
  const ps = postoStock.filter((s) => farda.has(s.item_id)).map((s) => ({ posto_id: s.posto_id, qty: Number(s.quantity) || 0 }));
  const contratos = porContrato(cs, colabs, pedidos, ps);
  const fi = items.filter((i) => farda.has(i.id) && i.active !== false);
  const fisico = fi.reduce((t, i) => t + (Number(i.quantity) || 0), 0);
  const reservado = fi.reduce((t, i) => t + (Number(i.reserved) || 0), 0);
  const estoque = { fisico, reservado, disponivel: Math.max(0, fisico - reservado), noPosto: ps.reduce((t, s) => t + s.qty, 0), emUso: contratos.reduce((t, c) => t + c.emUso, 0) };
  return { hoje, colabs: cs, resumo: resumir(cs), contratos, estoque, exigencias, temExigencias: temEx, semPlanilha: !ctrl?.entregas?.length };
}

/** o controle de um colaborador só (ficha): peças, exigências e o histórico de registros */
export async function controleDoColab(id: string): Promise<{ colab: ColabControle; registros: (RegistroC & { requirement: string })[]; aplicaveis: Exigencia[] } | null> {
  const cols = await collabCols();
  const { data: c, error } = await db().from('collaborators').select(cols).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!c) return null;
  const col = c as unknown as ColabC;
  const [kits, del, meta, exigencias, temEx] = await Promise.all([
    loadKits(),
    fetchAll<{ item_id: string | null; item_name: string; size: string | null; qty: number; returned_qty: number | null; delivered_at: string }>('deliveries', 'item_id, item_name, size, qty, returned_qty, delivered_at', { column: 'delivered_at', tiebreak: 'id' }, (q) => q.eq('collaborator_id', id)),
    db().from('hub_meta').select('value').eq('key', 'fardamento_controle').maybeSingle(),
    carregarExigencias(),
    temControle(),
  ]);
  const ent: EntregaC[] = del.map((d) => ({ collaborator_id: id, item_id: d.item_id, item_name: d.item_name, size: d.size, qty: Number(d.qty) - Number(d.returned_qty ?? 0), date: dataBahia(d.delivered_at), source: 'sistema' as const })).filter((e) => e.qty > 0);
  const alvo = fold(col.name);
  for (const e of (meta.data?.value as ControleFarda | undefined)?.entregas ?? []) {
    if (fold(e.f) !== alvo) continue;
    for (const [peca, tam, q] of e.i) ent.push({ collaborator_id: null, nome: e.f, item_name: peca, size: tam, qty: q, date: e.d ?? (e.m ? `${e.m}-01` : null), source: 'planilha' });
  }
  const regs = temEx ? await fetchAll<RegistroC>('collaborator_records', REC_COLS, { column: 'done_at', ascending: false, tiebreak: 'id' }, (q) => q.eq('collaborator_id', id)) : [];
  const ct = (await mapaContratos()).doColab(col);
  const colab = apurarColab({ ...col, contrato: ct?.name ?? null, sizes: col.sizes ?? {} }, kitDoColab(kits, col.role, ct), ent, exigencias, regs, todayBahia(), undefined, await carregarAvulsos());
  const nome = new Map(exigencias.map((r) => [r.id, r.name]));
  return { colab, registros: regs.map((r) => ({ ...r, requirement: nome.get(r.requirement_id) ?? 'Exigência removida' })), aplicaveis: exigencias.filter((r) => colab.exigencias.some((x) => x.id === r.id)) };
}
