import { isHoliday } from '../compras/prazo';
import type { DiaLido, Lido } from '../pontos/types';

/**
 * Apurador de horas extras (RH). Regra combinada com a empresa:
 *  - jornada de 44h semanais e até 9h por dia;
 *  - o que passa de 9h num dia é hora extra (acima da tolerância diária);
 *  - semana de segunda a domingo. As horas normais de segunda a sábado vão somando até 44h:
 *    o que passar de 44h é hora extra. Assim, sábado trabalhado depois de cumpridas as 44h
 *    nos dias úteis é todo extra; se faltou hora na semana, o sábado completa as 44h primeiro;
 *  - domingo e feriado trabalhados: todas as horas são extras (100%), fora das 44h;
 *  - feriado em dia útil reduz a meta da semana em 9h (o dia já é pago).
 * Tudo em minutos inteiros. Cada hora extra fica no dia em que aconteceu (e no mês dele).
 */

export interface HorasConfig {
  /** horas semanais, em minutos (44h) */
  semanal: number;
  /** limite diário, em minutos (9h) */
  diaria: number;
  /** tolerância diária, em minutos (CLT art. 58 §1º): excesso até aqui não vira extra */
  tolerancia: number;
  /** dia em que começa o mês de apuração (1 = mês do calendário; 21 = de 21 a 20) */
  inicioMes: number;
}
export const DEFAULT_HORAS: HorasConfig = { semanal: 44 * 60, diaria: 9 * 60, tolerancia: 10, inicioMes: 1 };

export interface DiaHoras {
  date: string;
  weekday: number;
  punches: string[];
  trabalhado: number;
  normal: number;
  /** extra em dia útil/sábado (50%) e em domingo/feriado (100%) */
  extra50: number;
  extra100: number;
  /** de onde veio o extra (para quem confere) */
  motivo: string | null;
  feriado: boolean;
  incompleto: boolean;
}

export interface MesHoras {
  chave: string; // AAAA-MM do mês de apuração
  rotulo: string;
  de: string;
  ate: string;
  dias: number;
  trabalhado: number;
  normal: number;
  extra50: number;
  extra100: number;
  extras: number;
  incompletos: number;
}

export interface FuncHoras {
  name: string;
  matricula: string | null;
  cargo: string | null;
  posto: string | null;
  meses: MesHoras[];
  dias: DiaHoras[];
  total: { trabalhado: number; normal: number; extra50: number; extra100: number; extras: number; dias: number; incompletos: number };
}

export interface ApuracaoHoras {
  config: HorasConfig;
  arquivo: string;
  leitura: string;
  avisos: string[];
  periodo: { from: string; to: string };
  funcionarios: FuncHoras[];
  meses: { chave: string; rotulo: string; extras: number; extra50: number; extra100: number; funcionarios: number }[];
  total: { funcionarios: number; extras: number; extra50: number; extra100: number; trabalhado: number };
  geradoEm: string;
  geradoPor: string;
}

const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const wd = (d: string) => new Date(d + 'T12:00:00Z').getUTCDay();
const addDays = (d: string, n: number) => {
  const x = new Date(d + 'T12:00:00Z');
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
/** segunda-feira da semana do dia */
const monday = (d: string) => addDays(d, -((wd(d) + 6) % 7));
export const hm = (min: number) => {
  const m = Math.round(Math.abs(min));
  return `${min < 0 ? '-' : ''}${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
};
/** "8:30" para a planilha (horas:minutos, sem limite de 24h) */
export const hhmm = (min: number) => {
  const m = Math.round(Math.abs(min));
  return `${min < 0 ? '-' : ''}${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
};

/** mês de apuração do dia (com início no dia `inicio`) */
export function mesDe(d: string, inicio: number) {
  let y = Number(d.slice(0, 4));
  let m = Number(d.slice(5, 7));
  const day = Number(d.slice(8, 10));
  if (inicio > 1 && day >= inicio) {
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  const chave = `${y}-${String(m).padStart(2, '0')}`;
  if (inicio <= 1) {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { chave, rotulo: `${MES[m - 1]}/${y}`, de: `${chave}-01`, ate: `${chave}-${String(last).padStart(2, '0')}` };
  }
  const pm = m === 1 ? 12 : m - 1;
  const py = m === 1 ? y - 1 : y;
  const de = `${py}-${String(pm).padStart(2, '0')}-${String(inicio).padStart(2, '0')}`;
  const ate = addDays(`${chave}-${String(inicio).padStart(2, '0')}`, -1);
  return { chave, rotulo: `${MES[m - 1]}/${y} (${de.slice(8)}/${de.slice(5, 7)} a ${ate.slice(8)}/${ate.slice(5, 7)})`, de, ate };
}

/** batidas do dia em minutos (saída menor que a anterior = passou da meia-noite) */
function minutos(punches: string[]) {
  const out: number[] = [];
  for (const p of punches) {
    let m = toMin(p);
    while (out.length && m < out[out.length - 1] - 30) m += 1440;
    if (out.length && Math.abs(m - out[out.length - 1]) <= 3) continue; // repetida
    out.push(m);
  }
  return out;
}

function dias(lidos: DiaLido[]) {
  const sorted = [...lidos].sort((a, b) => a.date.localeCompare(b.date));
  const w = sorted.map((d) => ({ date: d.date, mins: minutos(d.punches) }));
  // plantão partido em duas linhas (entrada à noite, saída na linha do dia seguinte)
  for (let i = 0; i + 1 < w.length; i++) {
    const a = w[i];
    const b = w[i + 1];
    if (addDays(a.date, 1) === b.date && a.mins.length % 2 === 1 && b.mins.length % 2 === 1 && a.mins[a.mins.length - 1] >= 720 && b.mins[0] < 720) {
      const moved = b.mins.shift()! + 1440;
      if (moved - a.mins[a.mins.length - 1] <= 16 * 60) a.mins.push(moved);
      else b.mins.unshift(moved - 1440);
    }
  }
  return w.map((x) => {
    let t = 0;
    for (let k = 0; k + 1 < x.mins.length; k += 2) t += x.mins[k + 1] - x.mins[k];
    return { date: x.date, trabalhado: Math.max(0, t), incompleto: x.mins.length % 2 === 1, punches: x.mins.map((m) => `${String(Math.floor((m % 1440) / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`) };
  });
}

export function apurar(lido: Lido, cfgIn: Partial<HorasConfig> = {}, meta: { arquivo: string; leitura: string; por: string; agora?: Date }): ApuracaoHoras {
  const cfg: HorasConfig = { ...DEFAULT_HORAS, ...cfgIn };
  const funcionarios: FuncHoras[] = [];
  for (const f of lido.funcionarios) {
    const ds = dias(f.days).filter((d) => d.trabalhado > 0 || d.incompleto);
    if (!ds.length) continue;
    const out: DiaHoras[] = [];
    // semana a semana (segunda a domingo)
    const semanas = new Map<string, typeof ds>();
    for (const d of ds) semanas.set(monday(d.date), [...(semanas.get(monday(d.date)) ?? []), d]);
    for (const [seg, lista] of [...semanas].sort((a, b) => a[0].localeCompare(b[0]))) {
      // feriado em dia útil: a meta da semana cai 9h (o dia já é pago)
      let meta = cfg.semanal;
      for (let k = 0; k < 5; k++) if (isHoliday(addDays(seg, k))) meta = Math.max(0, meta - cfg.diaria);
      let acumulado = 0;
      for (const d of lista.sort((a, b) => a.date.localeCompare(b.date))) {
        const w = wd(d.date);
        const feriado = isHoliday(d.date);
        const base: DiaHoras = { date: d.date, weekday: w, punches: d.punches, trabalhado: d.trabalhado, normal: 0, extra50: 0, extra100: 0, motivo: null, feriado, incompleto: d.incompleto };
        if (w === 0 || feriado) {
          base.extra100 = d.trabalhado;
          base.motivo = d.trabalhado ? (feriado ? 'feriado trabalhado: todas as horas são extras' : 'domingo trabalhado: todas as horas são extras') : null;
          out.push(base);
          continue;
        }
        // excesso diário (acima de 9h, além da tolerância)
        const exDia = d.trabalhado - cfg.diaria > cfg.tolerancia ? d.trabalhado - cfg.diaria : 0;
        const normalDia = d.trabalhado - exDia;
        // as horas normais vão completando a meta da semana; o que passar dela é extra
        const cabe = Math.max(0, meta - acumulado);
        const normal = Math.min(normalDia, cabe);
        const exSemana = normalDia - normal;
        acumulado += normal;
        base.normal = normal;
        base.extra50 = exDia + exSemana;
        const motivos: string[] = [];
        if (exDia) motivos.push(`${hm(exDia)} acima de ${hm(cfg.diaria)} no dia`);
        if (exSemana) motivos.push(w === 6 ? `sábado com as ${hm(meta)} da semana já cumpridas: ${hm(exSemana)}` : `${hm(exSemana)} além das ${hm(meta)} da semana`);
        base.motivo = motivos.join('; ') || null;
        out.push(base);
      }
    }
    out.sort((a, b) => a.date.localeCompare(b.date));
    // por mês de apuração
    const meses = new Map<string, MesHoras>();
    for (const d of out) {
      const m = mesDe(d.date, cfg.inicioMes);
      const cur = meses.get(m.chave) ?? { ...m, dias: 0, trabalhado: 0, normal: 0, extra50: 0, extra100: 0, extras: 0, incompletos: 0 };
      cur.dias += d.trabalhado > 0 ? 1 : 0;
      cur.trabalhado += d.trabalhado;
      cur.normal += d.normal;
      cur.extra50 += d.extra50;
      cur.extra100 += d.extra100;
      cur.extras += d.extra50 + d.extra100;
      cur.incompletos += d.incompleto ? 1 : 0;
      meses.set(m.chave, cur);
    }
    const ms = [...meses.values()].sort((a, b) => a.chave.localeCompare(b.chave));
    const sum = (k: keyof MesHoras) => ms.reduce((t, m) => t + Number(m[k]), 0);
    funcionarios.push({
      name: f.name,
      matricula: f.matricula,
      cargo: f.cargo,
      posto: f.posto,
      meses: ms,
      dias: out,
      total: { trabalhado: sum('trabalhado'), normal: sum('normal'), extra50: sum('extra50'), extra100: sum('extra100'), extras: sum('extras'), dias: sum('dias'), incompletos: sum('incompletos') },
    });
  }
  funcionarios.sort((a, b) => b.total.extras - a.total.extras || a.name.localeCompare(b.name, 'pt-BR'));
  const mm = new Map<string, ApuracaoHoras['meses'][number]>();
  for (const f of funcionarios)
    for (const m of f.meses) {
      const cur = mm.get(m.chave) ?? { chave: m.chave, rotulo: m.rotulo, extras: 0, extra50: 0, extra100: 0, funcionarios: 0 };
      cur.extras += m.extras;
      cur.extra50 += m.extra50;
      cur.extra100 += m.extra100;
      if (m.extras > 0) cur.funcionarios++;
      mm.set(m.chave, cur);
    }
  const all = funcionarios.flatMap((f) => f.dias.map((d) => d.date)).sort();
  const avisos = [...lido.avisos];
  const inc = funcionarios.reduce((t, f) => t + f.total.incompletos, 0);
  if (inc) avisos.push(`${inc} dia(s) com batida faltando (entrada ou saída): só os pares completos foram somados. Confira esses dias.`);
  return {
    config: cfg,
    arquivo: meta.arquivo,
    leitura: meta.leitura,
    avisos,
    periodo: lido.periodo ?? { from: all[0] ?? '', to: all[all.length - 1] ?? '' },
    funcionarios,
    meses: [...mm.values()].sort((a, b) => a.chave.localeCompare(b.chave)),
    total: {
      funcionarios: funcionarios.length,
      extras: funcionarios.reduce((t, f) => t + f.total.extras, 0),
      extra50: funcionarios.reduce((t, f) => t + f.total.extra50, 0),
      extra100: funcionarios.reduce((t, f) => t + f.total.extra100, 0),
      trabalhado: funcionarios.reduce((t, f) => t + f.total.trabalhado, 0),
    },
    geradoEm: (meta.agora ?? new Date()).toISOString(),
    geradoPor: meta.por,
  };
}
