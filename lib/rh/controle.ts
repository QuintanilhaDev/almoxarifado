/**
 * Controle do RH (fardamento por peça, ASO, cursos e documentos) — cálculo puro, sem banco.
 *
 *  - Cada peça entregue tem a própria data de entrega e a própria previsão de troca
 *    (prazo do item no kit da função; sem prazo no item, vale o do kit).
 *  - ASO, reciclagem, cursos e documentos são exigências cadastradas (a quem se aplicam,
 *    validade e antecedência do alerta). Vale o registro mais recente de cada pessoa.
 *  - O que falta informar (tamanho, admissão, kit da função, data de entrega, registro da
 *    exigência) fica separado: ausência de data não é situação regular.
 */

export type SizeField = 'camisa' | 'calca' | 'calcado';
export interface KitItemC {
  name: string;
  size_from: SizeField | null;
  qty: number;
  item_id?: string | null;
  period_months?: number | null;
}
export interface KitC {
  role: string;
  items: KitItemC[];
  period_months: number;
}
export interface ColabC {
  id: string;
  name: string;
  matricula: string | null;
  role: string | null;
  posto_id: string | null;
  posto_name: string | null;
  company: string | null;
  client?: string | null;
  admitted_at: string | null;
  sizes: Partial<Record<SizeField, string>>;
}
/** uma entrega (já sem o que voltou): do sistema (por id) ou da planilha de controle (pelo nome) */
export interface EntregaC {
  collaborator_id: string | null;
  nome?: string | null;
  item_id?: string | null;
  item_name: string;
  size: string | null;
  qty: number;
  date: string | null;
  source: 'sistema' | 'planilha';
}
export type TipoExig = 'aso' | 'curso' | 'documento';
export interface Exigencia {
  id: string;
  kind: TipoExig;
  name: string;
  roles: string[];
  clients: string[];
  companies: string[];
  validity_months: number;
  alert_days: number;
  notes?: string | null;
  active: boolean;
}
export interface RegistroC {
  id: string;
  collaborator_id: string;
  requirement_id: string;
  done_at: string;
  expires_at: string | null;
  notes?: string | null;
  created_by?: string | null;
  created_at?: string;
}

export const TIPO_EXIG: Record<TipoExig, string> = { aso: 'ASO', curso: 'Curso / reciclagem', documento: 'Documento' };
export const JANELA = 60;

export type StatusPeca = 'pendente' | 'vencida' | 'prevista' | 'em_dia' | 'sem_data';
export const STATUS_PECA: Record<StatusPeca, string> = { pendente: 'Pendente de entrega', vencida: 'Troca vencida', prevista: 'Troca prevista', em_dia: 'Em dia', sem_data: 'Sem data de entrega' };
export interface Peca {
  item: string;
  size: string | null;
  qty: number;
  entregue_em: string | null;
  troca_em: string | null;
  dias: number | null;
  status: StatusPeca;
  origem: 'sistema' | 'planilha' | null;
  periodo: number;
  /** a peça precisa de tamanho e o cadastro não tem */
  semTamanho?: boolean;
}
export type StatusExig = 'vencido' | 'a_vencer' | 'em_dia' | 'sem_registro';
export const STATUS_EXIG: Record<StatusExig, string> = { vencido: 'Vencido', a_vencer: 'A vencer', em_dia: 'Em dia', sem_registro: 'Sem registro' };
export interface ExigColab {
  id: string;
  kind: TipoExig;
  name: string;
  feito_em: string | null;
  vence_em: string | null;
  dias: number | null;
  status: StatusExig;
  alert_days: number;
}
export interface ColabControle {
  id: string;
  name: string;
  matricula: string | null;
  role: string | null;
  client: string | null;
  posto_name: string | null;
  company: string | null;
  contrato: string;
  kit: string | null;
  pecas: Peca[];
  exigencias: ExigColab[];
  /** o que falta informar no cadastro */
  faltas: string[];
}

/* ------------------------------------------------------------------ utilidades */
export const fold = (s: unknown) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'com', 'c', 'e', 'para', 'p', 'tam', 'tamanho', 'un', 'und', 'unid', 'kit', 'par']);
const toks = (s: string) => fold(s).split(' ').filter((t) => t && !STOP.has(t));
const SHOE = /\b(bota|botas|sapato|sapatos|coturno|coturnos|tenis|calcado|calcados|botina|botinas)\b/;
const CLOTH = /\b(camisa|camisas|camiseta|camisetas|calca|calcas|jaqueta|jaquetas|bermuda|bermudas|blusa|blusas|agasalho|agasalhos|casaco|casacos|japona|colete)\b/;
export function campoTamanho(name: string): SizeField | null {
  const n = fold(name);
  if (SHOE.test(n)) return 'calcado';
  if (/\b(calca|calcas|bermuda|bermudas)\b/.test(n)) return 'calca';
  if (CLOTH.test(n)) return 'camisa';
  return null;
}
export const CAMPO_TAMANHO: Record<SizeField, string> = { camisa: 'camisa', calca: 'calça', calcado: 'calçado' };

export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}
export const diasEntre = (a: string, b: string) => Math.round((Date.parse(a + 'T12:00:00Z') - Date.parse(b + 'T12:00:00Z')) / 86_400_000);
export const contratoDe = (c: { client?: string | null; posto_name?: string | null }) => (c.client?.trim() || c.posto_name?.trim() || 'Sem cliente ou posto').toUpperCase();

/** a peça entregue corresponde a este item do kit? (todas as palavras do item do kit aparecem no nome entregue) */
export function pontuaPeca(kitName: string, entregue: string): number {
  const k = toks(kitName);
  const e = toks(entregue);
  if (!k.length || !e.length) return 0;
  const ok = k.every((t) => e.some((u) => u === t || (t.length >= 3 && u.length >= 3 && (u.startsWith(t) || t.startsWith(u)))));
  return ok ? k.length : 0;
}

export function seAplica(r: Exigencia, c: Pick<ColabC, 'role' | 'company'> & { client?: string | null }): boolean {
  if (!r.active) return false;
  const has = (lista: string[], v: string | null | undefined) => !lista.length || lista.some((x) => fold(x) === fold(v));
  return has(r.roles, c.role) && has(r.clients, c.client) && has(r.companies, c.company);
}

/* ------------------------------------------------------------------ um colaborador */
export function apurarColab(c: ColabC, kit: KitC | null, entregas: EntregaC[], exigs: Exigencia[], registros: RegistroC[], hoje: string, janela = JANELA): ColabControle {
  const faltas: string[] = [];
  if (!c.role) faltas.push('Sem função no cadastro');
  else if (!kit) faltas.push(`Função ${c.role} sem kit cadastrado`);
  if (!c.admitted_at) faltas.push('Sem data de admissão');
  const pecas: Peca[] = [];
  if (kit) {
    // cada entrega vai para o item do kit mais específico que ela corresponde
    const porItem = new Map<number, EntregaC[]>();
    for (const e of entregas) {
      if (e.qty <= 0) continue;
      let best = -1;
      let score = 0;
      kit.items.forEach((k, i) => {
        const s = k.item_id && e.item_id && k.item_id === e.item_id ? 100 : pontuaPeca(k.name, e.item_name);
        if (s > score) {
          score = s;
          best = i;
        }
      });
      if (best >= 0) porItem.set(best, [...(porItem.get(best) ?? []), e]);
    }
    const semTam = new Set<SizeField>();
    kit.items.forEach((k, i) => {
      const periodo = k.period_months || kit.period_months || 12;
      const campo = k.size_from ?? campoTamanho(k.name);
      const tamanho = campo ? c.sizes?.[campo]?.trim() || null : null;
      if (campo && !tamanho) semTam.add(campo);
      // as mais recentes primeiro; cada unidade é uma peça com a própria data
      const lista = (porItem.get(i) ?? []).slice().sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));
      let restam = k.qty;
      for (const e of lista) {
        if (restam <= 0) break;
        const q = Math.min(restam, e.qty);
        restam -= q;
        const troca = e.date ? addMonths(e.date, periodo) : null;
        const dias = troca ? diasEntre(troca, hoje) : null;
        pecas.push({ item: k.name, size: e.size ?? tamanho, qty: q, entregue_em: e.date, troca_em: troca, dias, status: dias === null ? 'sem_data' : dias < 0 ? 'vencida' : dias <= janela ? 'prevista' : 'em_dia', origem: e.source, periodo });
      }
      if (restam > 0) pecas.push({ item: k.name, size: tamanho, qty: restam, entregue_em: null, troca_em: null, dias: null, status: 'pendente', origem: null, periodo, ...(campo && !tamanho ? { semTamanho: true } : {}) });
    });
    for (const f of semTam) faltas.push(`Sem tamanho de ${CAMPO_TAMANHO[f]}`);
    if (pecas.some((p) => p.status === 'sem_data')) faltas.push('Peça entregue sem data');
  }
  const exigencias: ExigColab[] = [];
  for (const r of exigs) {
    if (!seAplica(r, c)) continue;
    const ult = registros.filter((x) => x.collaborator_id === c.id && x.requirement_id === r.id).sort((a, b) => b.done_at.localeCompare(a.done_at) || String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))[0];
    if (!ult) {
      exigencias.push({ id: r.id, kind: r.kind, name: r.name, feito_em: null, vence_em: null, dias: null, status: 'sem_registro', alert_days: r.alert_days });
      continue;
    }
    const vence = ult.expires_at || addMonths(ult.done_at, r.validity_months);
    const dias = diasEntre(vence, hoje);
    exigencias.push({ id: r.id, kind: r.kind, name: r.name, feito_em: ult.done_at, vence_em: vence, dias, status: dias < 0 ? 'vencido' : dias <= r.alert_days ? 'a_vencer' : 'em_dia', alert_days: r.alert_days });
  }
  if (exigencias.some((x) => x.status === 'sem_registro')) faltas.push(`Sem registro de ${exigencias.filter((x) => x.status === 'sem_registro').map((x) => x.name).join(', ')}`);
  return { id: c.id, name: c.name, matricula: c.matricula, role: c.role, client: c.client ?? null, posto_name: c.posto_name, company: c.company, contrato: contratoDe(c), kit: kit?.role ?? null, pecas, exigencias, faltas };
}

/* ------------------------------------------------------------------ os seis números */
export type Indicador = 'kit_incompleto' | 'pendentes' | 'vencidas' | 'reposicoes' | 'aso' | 'cursos';
export const INDICADORES: { id: Indicador; titulo: string; sub: string; semInfo: string }[] = [
  { id: 'kit_incompleto', titulo: 'Colaboradores com kit incompleto', sub: 'falta ao menos uma peça do kit', semInfo: 'sem função ou sem kit da função' },
  { id: 'pendentes', titulo: 'Peças pendentes de entrega', sub: 'peças do kit ainda não entregues', semInfo: 'sem função ou sem kit da função' },
  { id: 'vencidas', titulo: 'Peças com troca vencida', sub: 'prazo de troca ultrapassado', semInfo: 'peças entregues sem data' },
  { id: 'reposicoes', titulo: `Reposições nos próximos ${JANELA} dias`, sub: 'peças com troca prevista', semInfo: 'peças entregues sem data' },
  { id: 'aso', titulo: `ASOs vencidos ou a vencer em ${JANELA} dias`, sub: 'pelo registro mais recente', semInfo: 'sem ASO registrado' },
  { id: 'cursos', titulo: `Cursos vencidos ou a vencer em ${JANELA} dias`, sub: 'cursos, reciclagens e documentos', semInfo: 'sem registro do curso' },
];

export interface Linha {
  colab: string;
  id: string;
  name: string;
  matricula: string | null;
  role: string | null;
  contrato: string;
  posto_name: string | null;
  company: string | null;
  item: string;
  size: string | null;
  qty: number;
  data: string | null;
  prazo: string | null;
  dias: number | null;
  situacao: string;
  obs: string;
  semInfo: boolean;
}

const sitExig = (x: ExigColab) => (x.status === 'vencido' ? `Vencido há ${-(x.dias ?? 0)} dia(s)` : x.status === 'sem_registro' ? 'Sem registro' : `Vence em ${x.dias} dia(s)`);
const sitPeca = (p: Peca) => (p.status === 'vencida' ? `Vencida há ${-(p.dias ?? 0)} dia(s)` : p.status === 'prevista' ? `Troca em ${p.dias} dia(s)` : STATUS_PECA[p.status]);
const ehCurso = (k: TipoExig) => k !== 'aso';
const semKit = (c: ColabControle) => !c.kit;

/** as linhas de um indicador (pendências e, separadas, as sem informação) */
export function linhasDe(ind: Indicador, cs: ColabControle[], janela = JANELA): Linha[] {
  const out: Linha[] = [];
  const base = (c: ColabControle) => ({ colab: c.id, id: c.id, name: c.name, matricula: c.matricula, role: c.role, contrato: c.contrato, posto_name: c.posto_name, company: c.company });
  for (const c of cs) {
    if (ind === 'kit_incompleto' || ind === 'pendentes') {
      if (semKit(c)) {
        out.push({ ...base(c), item: c.role ? `Função ${c.role} sem kit` : 'Sem função', size: null, qty: 0, data: null, prazo: null, dias: null, situacao: 'Sem informação', obs: 'Cadastre o kit da função para saber o que falta', semInfo: true });
        continue;
      }
      const pend = c.pecas.filter((p) => p.status === 'pendente');
      if (!pend.length) continue;
      if (ind === 'kit_incompleto') {
        out.push({ ...base(c), item: pend.map((p) => `${p.item}${p.size ? ' ' + p.size : ''} (${p.qty})`).join(', '), size: null, qty: pend.reduce((t, p) => t + p.qty, 0), data: null, prazo: null, dias: null, situacao: 'Kit incompleto', obs: pend.some((p) => p.semTamanho) ? 'Falta tamanho no cadastro' : '', semInfo: false });
      } else {
        for (const p of pend) out.push({ ...base(c), item: p.item, size: p.size, qty: p.qty, data: null, prazo: null, dias: null, situacao: 'Pendente de entrega', obs: p.semTamanho ? 'Falta tamanho no cadastro' : '', semInfo: false });
      }
    } else if (ind === 'vencidas' || ind === 'reposicoes') {
      for (const p of c.pecas) {
        if (p.status === 'sem_data') out.push({ ...base(c), item: p.item, size: p.size, qty: p.qty, data: null, prazo: null, dias: null, situacao: 'Sem data de entrega', obs: 'Não dá para prever a troca', semInfo: true });
        else if (ind === 'vencidas' ? p.status === 'vencida' : p.dias !== null && p.dias >= 0 && p.dias <= janela)
          out.push({ ...base(c), item: p.item, size: p.size, qty: p.qty, data: p.entregue_em, prazo: p.troca_em, dias: p.dias, situacao: sitPeca(p), obs: p.origem === 'planilha' ? 'Entrega da planilha de controle' : '', semInfo: false });
      }
    } else {
      for (const x of c.exigencias) {
        if (ind === 'aso' ? x.kind !== 'aso' : !ehCurso(x.kind)) continue;
        if (x.status === 'sem_registro') out.push({ ...base(c), item: x.name, size: null, qty: 1, data: null, prazo: null, dias: null, situacao: 'Sem registro', obs: 'Registre a data de realização', semInfo: true });
        else if (x.status === 'vencido' || (x.dias !== null && x.dias <= janela)) out.push({ ...base(c), item: x.name, size: null, qty: 1, data: x.feito_em, prazo: x.vence_em, dias: x.dias, situacao: sitExig(x), obs: '', semInfo: false });
      }
    }
  }
  return out.sort((a, b) => a.contrato.localeCompare(b.contrato, 'pt-BR') || (a.dias ?? 1e9) - (b.dias ?? 1e9) || a.name.localeCompare(b.name, 'pt-BR'));
}

export interface NumeroInd {
  id: Indicador;
  valor: number;
  pessoas: number;
  semInfo: number;
}
/** os seis números da tela inicial */
export function resumir(cs: ColabControle[], janela = JANELA): NumeroInd[] {
  return INDICADORES.map(({ id }) => {
    const ls = linhasDe(id, cs, janela);
    const reg = ls.filter((l) => !l.semInfo);
    const valor = id === 'kit_incompleto' ? reg.length : id === 'aso' || id === 'cursos' ? reg.length : reg.reduce((t, l) => t + l.qty, 0);
    return { id, valor, pessoas: new Set(reg.map((l) => l.id)).size, semInfo: new Set(ls.filter((l) => l.semInfo).map((l) => l.id)).size };
  });
}

/* ------------------------------------------------------------------ estoque por contrato */
export interface PedidoAberto {
  collaborator_id: string | null;
  posto_id: string | null;
  posto_name: string | null;
  reservado: number;
}
export interface Contrato {
  contrato: string;
  colaboradores: number;
  semKit: number;
  pecasKit: number;
  emUso: number;
  pendentes: number;
  vencidas: number;
  /** reservado no estoque central para pedidos deste contrato (ainda não entregue) */
  reservado: number;
  /** peças de fardamento já enviadas aos postos do contrato e ainda sem colaborador */
  noPosto: number;
  /** pendentes + trocas vencidas */
  precisa: number;
  /** o que ainda falta mandar: precisa − reservado − no posto */
  falta: number;
}
export function porContrato(cs: ColabControle[], colabs: ColabC[], pedidos: PedidoAberto[], postoStock: { posto_id: string; qty: number }[]): Contrato[] {
  const m = new Map<string, Contrato>();
  const get = (k: string) => {
    let x = m.get(k);
    if (!x) m.set(k, (x = { contrato: k, colaboradores: 0, semKit: 0, pecasKit: 0, emUso: 0, pendentes: 0, vencidas: 0, reservado: 0, noPosto: 0, precisa: 0, falta: 0 }));
    return x;
  };
  const contratoDoColab = new Map(cs.map((c) => [c.id, c.contrato]));
  const contratoDoPosto = new Map<string, string>();
  for (const c of colabs) {
    const k = contratoDoColab.get(c.id);
    if (!k) continue;
    if (c.posto_id && !contratoDoPosto.has(c.posto_id)) contratoDoPosto.set(c.posto_id, k);
    if (c.posto_name && !contratoDoPosto.has('n:' + fold(c.posto_name))) contratoDoPosto.set('n:' + fold(c.posto_name), k);
  }
  for (const c of cs) {
    const x = get(c.contrato);
    x.colaboradores++;
    if (!c.kit) x.semKit++;
    for (const p of c.pecas) {
      x.pecasKit += p.qty;
      if (p.status === 'pendente') x.pendentes += p.qty;
      else if (p.status === 'vencida') x.vencidas += p.qty;
      else x.emUso += p.qty;
    }
  }
  for (const o of pedidos) {
    if (o.reservado <= 0) continue;
    const k = (o.collaborator_id && contratoDoColab.get(o.collaborator_id)) || (o.posto_id && contratoDoPosto.get(o.posto_id)) || (o.posto_name && contratoDoPosto.get('n:' + fold(o.posto_name))) || (o.posto_name ? o.posto_name.toUpperCase() : null);
    if (k) get(k).reservado += o.reservado;
  }
  for (const s of postoStock) {
    const k = contratoDoPosto.get(s.posto_id);
    if (k) get(k).noPosto += s.qty;
  }
  for (const x of m.values()) {
    x.precisa = x.pendentes + x.vencidas;
    x.falta = Math.max(0, x.precisa - x.reservado - x.noPosto);
  }
  return [...m.values()].sort((a, b) => b.falta - a.falta || b.precisa - a.precisa || a.contrato.localeCompare(b.contrato, 'pt-BR'));
}
