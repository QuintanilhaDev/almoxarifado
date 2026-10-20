import { isHoliday } from '../compras/prazo';
import { marksIn, parseDate } from '../pontos/parse';
import type { DiaLido, FuncLido, Lido } from '../pontos/types';

/**
 * O que a IA transcreveu (uma página/pedaço por vez) → Lido para o cálculo.
 * A IA só transcreve (quem, que dia, que batidas); todo cálculo é feito no sistema, em minutos.
 * O que ela marcar como ilegível vira aviso para conferir.
 *
 * Folha de papel costuma ter só o número do dia (1 a 31) e o ano: o mês é deduzido aqui pelos
 * domingos e sábados (dias em branco e meios expedientes), e a tela deixa trocar se precisar.
 */

// resposta compacta (a cota gratuita conta cada token): cada dia é ["dia ou data", batidas…, anotação]
export const SYSTEM = [
  'Você transcreve folhas e espelhos de ponto de funcionários (impressos, planilhas, fotos ou escritos à mão) para JSON.',
  'Extraia TODOS os funcionários e TODAS as linhas de dia, com as batidas na ordem das colunas (entrada, saída para o almoço/intervalo, retorno, saída).',
  'Horas no formato HH:MM de 24 horas ("7h30" = "07:30"; "19.00" = "19:00"; "12:0l" = "12:01"). Em manuscritos, 1 e 7, 0 e 6, 3 e 8 se parecem: use o contexto (entrada da manhã por volta de 06-09h, almoço 11-14h, saída 16-20h).',
  'Se a folha tiver data completa, use "dd/mm/aaaa". Se tiver só o número do dia (coluna DIAS de 1 a 31), use só o número, como "07". Nunca invente o mês: preencha "mes" e "ano" só se estiverem escritos na folha (cabeçalho, carimbo, título).',
  'Ignore colunas de assinatura, totais, saldos e horas extras. Linha com traço ou em branco: só o dia, sem batidas. Folga, falta, atestado, férias, feriado, DSR: o dia e a anotação em texto.',
  'Não invente: horário ilegível fica de fora e o dia entra em "duvidas".',
  'Responda somente com JSON compacto neste formato:',
  '{"mes":null,"ano":2026,"funcionarios":[{"nome":"NOME COMPLETO","matricula":null,"cargo":"AAOP","dias":[["01","07:00","12:01","13:01","18:01"],["06"],["12","08:02","12:02"],["16","FOLGA"]],"duvidas":["15"]}]}',
].join('\n');

type Linha = unknown[] | { data?: unknown; dia?: unknown; batidas?: unknown; obs?: unknown; duvida?: unknown };
interface IaFunc {
  nome?: unknown;
  matricula?: unknown;
  cargo?: unknown;
  posto?: unknown;
  dias?: unknown;
  duvidas?: unknown;
}
export interface IaDoc {
  mes?: unknown;
  ano?: unknown;
  periodo?: { de?: unknown; ate?: unknown } | null;
  funcionarios?: unknown;
}

const str = (v: unknown, n = 120) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
const hora = (v: unknown) => {
  const m = String(v ?? '')
    .trim()
    .replace(/[oO]/g, '0')
    .replace(/[lI|]/g, '1')
    .match(/^(\d{1,2})\s*[:hH.,]\s*(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h < 24 && mi < 60 ? `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}` : null;
};
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const diasNoMes = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const nomeMes = (ym: string) => `${MESES[Number(ym.slice(5, 7)) - 1]}/${ym.slice(0, 4)}`;
const SO_DIA = /^\d{1,2}$/;

/** uma linha da IA (formato compacto ou o antigo) → dia (número ou data), batidas, anotação */
function linha(x: Linha): { ref: string; punches: string[]; obs: string | null; duvida: boolean } | null {
  if (Array.isArray(x)) {
    const ref = String(x[0] ?? '').trim();
    if (!ref) return null;
    const resto = x
      .slice(1)
      .map((v) => String(v ?? '').trim())
      .filter(Boolean);
    const punches = resto.map(hora).filter((h): h is string => Boolean(h));
    const obs = resto.filter((v) => !hora(v) && !/^[-–—_.]+$/.test(v)).join(' ').slice(0, 60) || null;
    return { ref, punches, obs, duvida: false };
  }
  if (!x || typeof x !== 'object') return null;
  const ref = String(x.data ?? x.dia ?? '').trim();
  if (!ref) return null;
  return { ref, punches: (Array.isArray(x.batidas) ? x.batidas : []).map(hora).filter((h): h is string => Boolean(h)), obs: str(x.obs, 60), duvida: x.duvida === true };
}
const linhasDe = (f: IaFunc) => (Array.isArray(f.dias) ? (f.dias as Linha[]) : []).map(linha).filter((l): l is NonNullable<ReturnType<typeof linha>> => Boolean(l));

/**
 * mês de uma folha que só tem o número dos dias: o que melhor encaixa os domingos em branco,
 * os sábados de meio expediente e os dias úteis trabalhados. Só meses que já começaram.
 */
export function deduzirMes(dias: { dia: number; punches: string[] }[], ano: number | null, hoje = new Date()): { mes: string; certeza: number } | null {
  if (!dias.some((d) => d.punches.length)) return null;
  const maxDia = Math.max(...dias.filter((d) => d.punches.length).map((d) => d.dia));
  const cand: { y: number; m: number }[] = [];
  for (let k = 0; k < 24; k++) {
    const dt = new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth() - k, 1));
    const y = dt.getUTCFullYear();
    if (!ano && k >= 12) break;
    if (ano && y !== ano) continue;
    cand.push({ y, m: dt.getUTCMonth() + 1 });
  }
  const notas = cand
    .filter(({ y, m }) => maxDia <= diasNoMes(y, m))
    .map(({ y, m }) => {
      let s = 0;
      for (let d = 1; d <= diasNoMes(y, m); d++) {
        const n = dias.find((x) => x.dia === d)?.punches.length ?? 0;
        const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
        if (w === 0) s += n >= 2 ? -2 : 2;
        else if (w === 6) s += n === 2 ? 1.5 : n === 0 ? 0.5 : -0.5;
        else if (isHoliday(iso(y, m, d))) s += n ? 0 : 1;
        else s += n >= 4 ? 0.5 : n === 0 ? -0.5 : 0;
      }
      return { mes: `${y}-${String(m).padStart(2, '0')}`, s };
    })
    .sort((a, b) => b.s - a.s);
  if (!notas.length) return null;
  return { mes: notas[0].mes, certeza: notas[0].s - (notas[1]?.s ?? -99) };
}

export interface MesFolha {
  /** página/documento (na ordem em que foi lido) */
  doc: number;
  nomes: string[];
  mes: string;
  certeza: 'escrito' | 'deduzido' | 'duvidoso' | 'escolhido';
}

/**
 * junta o que a IA leu (várias páginas/pedaços) num Lido, com avisos do que ficou duvidoso.
 * `mesForcado` (AAAA-MM) vale para as folhas que não trazem o mês escrito.
 */
export function iaParaLido(docs: IaDoc[], today = new Date(), mesForcado?: string | null): Lido & { meses: MesFolha[] } {
  const avisos: string[] = [];
  let periodo: Lido['periodo'] = null;
  const hint: { from?: string; to?: string; year: number } = { year: today.getFullYear() };
  for (const d of docs) {
    const de = parseDate(String(d.periodo?.de ?? ''), hint);
    const ate = parseDate(String(d.periodo?.ate ?? ''), hint);
    if (de && ate && de <= ate) {
      periodo = { from: de, to: ate };
      Object.assign(hint, periodo);
      break;
    }
  }
  const byKey = new Map<string, FuncLido>();
  const duvidas: string[] = [];
  const meses: MesFolha[] = [];
  let semMes = 0;
  for (const [di, d] of docs.entries()) {
    const funcs = (Array.isArray(d.funcionarios) ? d.funcionarios : []) as IaFunc[];
    const mesN = Number(d.mes);
    const anoN = Number(d.ano);
    const ano = anoN >= 2000 && anoN <= 2100 ? anoN : null;
    // mês da folha (para as linhas que só têm o número do dia)
    let mesDoc: string | null = null;
    let cert: MesFolha['certeza'] = 'escrito';
    const soDia = funcs.flatMap(linhasDe).filter((l) => SO_DIA.test(l.ref));
    if (soDia.length) {
      if (mesN >= 1 && mesN <= 12) mesDoc = `${ano ?? hint.year}-${String(mesN).padStart(2, '0')}`;
      else if (mesForcado && /^\d{4}-\d{2}$/.test(mesForcado)) {
        mesDoc = mesForcado;
        cert = 'escolhido';
      } else if (periodo && periodo.from.slice(0, 7) === periodo.to.slice(0, 7)) mesDoc = periodo.from.slice(0, 7);
      else {
        const g = deduzirMes(
          soDia.map((l) => ({ dia: Number(l.ref), punches: l.punches })),
          ano,
          today,
        );
        if (g) {
          mesDoc = g.mes;
          cert = g.certeza >= 4 ? 'deduzido' : 'duvidoso';
        }
      }
      if (mesDoc) meses.push({ doc: di, nomes: funcs.map((f) => str(f.nome, 100)).filter((n): n is string => Boolean(n)), mes: mesDoc, certeza: cert });
      else semMes++;
    }
    for (const f of funcs) {
      const nome = str(f.nome, 100);
      if (!nome) continue;
      const mat = str(f.matricula, 30);
      const key = mat ? `m:${mat.replace(/\D/g, '') || mat}` : `n:${nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ')}`;
      let cur = byKey.get(key);
      if (!cur) {
        cur = { name: nome.toUpperCase(), matricula: mat, cargo: str(f.cargo, 60), posto: str(f.posto, 90), days: [] };
        byKey.set(key, cur);
      }
      const duvF = new Set((Array.isArray(f.duvidas) ? f.duvidas : []).map((x) => String(x).trim().replace(/^0(?=\d)/, '')));
      for (const l of linhasDe(f)) {
        let date: string | null;
        if (SO_DIA.test(l.ref)) {
          if (!mesDoc) continue;
          const dn = Number(l.ref);
          const [y, m] = mesDoc.split('-').map(Number);
          if (dn < 1 || dn > diasNoMes(y, m)) continue;
          date = iso(y, m, dn);
        } else date = parseDate(l.ref, ano ? { ...hint, year: ano } : hint);
        if (!date) continue;
        const day: DiaLido = { date, punches: l.punches.slice(0, 12), marks: l.obs ? marksIn(l.obs) : [], schedule: null };
        const same = cur.days.find((y) => y.date === date);
        // o mesmo dia em duas páginas (cabeçalho repetido, página sobreposta): não duplica as batidas
        if (same) same.punches.push(...day.punches.filter((h) => !same.punches.includes(h)));
        else cur.days.push(day);
        if (l.duvida || duvF.has(l.ref.replace(/^0(?=\d)/, ''))) duvidas.push(`${cur.name.split(' ')[0]} ${date.slice(8)}/${date.slice(5, 7)}`);
      }
    }
  }
  const funcionarios = [...byKey.values()].filter((f) => f.days.length);
  for (const f of funcionarios) f.days.sort((a, b) => a.date.localeCompare(b.date));
  if (duvidas.length) avisos.push(`A leitura ficou em dúvida em ${duvidas.length} dia(s): ${duvidas.slice(0, 12).join(', ')}${duvidas.length > 12 ? '…' : ''}. Confira esses dias no documento original.`);
  const ded = meses.filter((m) => m.certeza !== 'escrito');
  if (ded.length) {
    const grupos = new Map<string, MesFolha[]>();
    for (const m of ded) grupos.set(m.mes, [...(grupos.get(m.mes) ?? []), m]);
    const txt = [...grupos]
      .map(([mes, ms]) => {
        const nomes = [...new Set(ms.flatMap((x) => x.nomes).map((n) => n.split(' ')[0]))];
        return `${nomeMes(mes)}${grupos.size > 1 && nomes.length ? ` (${nomes.slice(0, 6).join(', ')})` : ''}`;
      })
      .join('; ');
    const duvidoso = ded.some((m) => m.certeza === 'duvidoso');
    avisos.push(
      ded.every((m) => m.certeza === 'escolhido')
        ? `Mês das folhas sem mês escrito: ${txt} (escolhido por você).`
        : `As folhas não têm o mês escrito. ${duvidoso ? 'Pelo calendário, o mais provável é' : 'Pelos domingos em branco e os sábados, o mês é'} ${txt}${duvidoso ? ', mas confira' : ''}. Se não for, troque em "Mês das folhas".`,
    );
  }
  if (semMes) avisos.push(`${semMes} folha(s) não têm o mês escrito e não deu para deduzir: escolha em "Mês das folhas".`);
  if (!periodo && funcionarios.length) {
    const all = funcionarios.flatMap((f) => f.days.map((x) => x.date)).sort();
    periodo = { from: all[0], to: all[all.length - 1] };
  }
  return { funcionarios, periodo, formato: 'ia', avisos, meses };
}
