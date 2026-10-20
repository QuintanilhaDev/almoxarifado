import { analisar } from '../pontos/analyze';
import { isHoliday } from '../compras/prazo';
import { fold } from '../pontos/parse';
import { DEFAULT_PONTO, type FuncLido, type Lido } from '../pontos/types';

/**
 * Apurador de horas extras (RH). Recebe o que foi lido dos documentos (espelho, cartão de
 * ponto, planilha, foto de cartão manuscrito) e calcula, em minutos inteiros:
 *
 *  - HE 50%: o que passou da jornada prevista do dia. Até a tolerância (10 min/dia, CLT art.
 *    58 §1º) não conta; passou dela, conta tudo (Súmula 366 do TST);
 *  - HE 100%: o dia inteiro trabalhado em folga da escala ou, na escala diária, em feriado
 *    (no 12x36 o feriado já está compensado: art. 59-A da CLT);
 *  - dias que não dá para apurar (batida faltando) ficam listados, sem chute.
 *
 * Jornada prevista de cada dia: a do sistema de ponto (Hr. Dia − Dif.) ou a anotada no
 * documento; senão a da escala (12x36 = 12h; diária = a configurada).
 * Competência: mês civil (1 a 31) ou período de apuração (21 a 20), separado por funcionário.
 */

export interface HeConfig {
  tolerancia: number;
  /** jornada diária quando o documento não diz (minutos) */
  jornada: number;
  /** 'civil' = 1 a 31; '21' = de 21 a 20 (competência do mês em que termina) */
  competencia: 'civil' | '21';
}
export const DEFAULT_HE: HeConfig = { tolerancia: 10, jornada: 480, competencia: 'civil' };

export interface HeDia {
  date: string;
  punches: string[];
  trabalhado: number;
  jornada: number | null;
  he50: number;
  he100: number;
  motivo: string | null;
  /** não deu para calcular (ex.: batida faltando) */
  pendente: string | null;
}
export interface HeMes {
  chave: string; // AAAA-MM da competência
  rotulo: string; // "set/2026" ou "21/08 a 20/09/2026"
  dias: number;
  trabalhado: number;
  he50: number;
  he100: number;
  total: number;
  pendentes: number;
}
export interface HeFunc {
  name: string;
  matricula: string | null;
  cargo: string | null;
  posto: string | null;
  filial: string | null;
  escala: string;
  meses: HeMes[];
  total: { trabalhado: number; he50: number; he100: number; total: number; pendentes: number; dias: number };
  dias: HeDia[];
}
export interface Apuracao {
  config: HeConfig;
  periodo: { from: string; to: string };
  meses: { chave: string; rotulo: string }[];
  funcionarios: HeFunc[];
  totais: { funcionarios: number; comExtra: number; he50: number; he100: number; total: number; pendentes: number; porMes: { chave: string; rotulo: string; he50: number; he100: number; total: number }[] };
  arquivos: { nome: string; tipo: string; ia: boolean; funcionarios: number }[];
  avisos: string[];
  geradoEm: string;
  geradoPor: string;
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const nextMonth = (y: number, m: number) => (m === 12 ? [y + 1, 1] : [y, m + 1]);
const prevMonth = (y: number, m: number) => (m === 1 ? [y - 1, 12] : [y, m - 1]);
const p2 = (n: number) => String(n).padStart(2, '0');

/** competência do dia: mês civil, ou de 21 a 20 (vale o mês em que o período termina) */
export function competencia(date: string, c: HeConfig['competencia']): { chave: string; rotulo: string } {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  if (c === 'civil') return { chave: `${y}-${p2(m)}`, rotulo: `${MESES[m - 1]}/${y}` };
  const [ey, em] = d >= 21 ? nextMonth(y, m) : [y, m];
  const [sy, sm] = prevMonth(ey, em);
  return { chave: `${ey}-${p2(em)}`, rotulo: `21/${p2(sm)} a 20/${p2(em)}/${ey}` };
}

/** junta o que veio de vários arquivos: mesma matrícula (ou mesmo nome) é a mesma pessoa */
export function juntar(lidos: Lido[]): Lido {
  const map = new Map<string, FuncLido>();
  const order: string[] = [];
  const keyOf = (f: FuncLido) => (f.matricula && f.matricula.replace(/\D/g, '') ? `m:${f.matricula.replace(/\D/g, '')}` : `n:${fold(f.name)}`);
  const byName = new Map<string, string>();
  for (const l of lidos) {
    for (const f of l.funcionarios) {
      let k = keyOf(f);
      // mesmo nome com e sem matrícula em arquivos diferentes: é a mesma pessoa
      const nk = fold(f.name);
      if (!map.has(k) && byName.has(nk)) k = byName.get(nk)!;
      const cur = map.get(k);
      if (!cur) {
        map.set(k, { ...f, days: [...f.days] });
        order.push(k);
        byName.set(nk, k);
        continue;
      }
      cur.matricula = cur.matricula ?? f.matricula;
      cur.cargo = cur.cargo ?? f.cargo;
      cur.posto = cur.posto ?? f.posto;
      cur.empresa = cur.empresa ?? f.empresa;
      cur.cnpj = cur.cnpj ?? f.cnpj;
      for (const d of f.days) {
        const same = cur.days.find((x) => x.date === d.date);
        if (!same) cur.days.push(d);
        else if (!same.punches.length && d.punches.length) Object.assign(same, d);
      }
    }
  }
  const funcionarios = order.map((k) => map.get(k)!);
  for (const f of funcionarios) f.days.sort((a, b) => a.date.localeCompare(b.date));
  const all = funcionarios.flatMap((f) => f.days.map((d) => d.date)).sort();
  const ps = lidos.map((l) => l.periodo).filter(Boolean) as { from: string; to: string }[];
  const from = [...ps.map((p) => p.from), all[0]].filter(Boolean).sort()[0] ?? '';
  const to = [...ps.map((p) => p.to), all[all.length - 1]].filter(Boolean).sort().reverse()[0] ?? '';
  return { funcionarios, periodo: from && to ? { from, to } : null, formato: lidos.some((l) => l.formato === 'lista') ? 'lista' : 'espelho', avisos: lidos.flatMap((l) => l.avisos) };
}

export function apurar(lido: Lido, cfgIn: Partial<HeConfig> = {}, meta: { arquivos: Apuracao['arquivos']; por: string; agora?: Date }): Apuracao {
  const cfg: HeConfig = { ...DEFAULT_HE, ...cfgIn };
  const a = analisar(lido, { ...DEFAULT_PONTO, tolerancia: cfg.tolerancia, jornada: cfg.jornada }, { arquivo: '', por: meta.por, agora: meta.agora });
  const funcionarios: HeFunc[] = [];
  const mesesMap = new Map<string, string>();
  for (const f of a.funcionarios) {
    const dias: HeDia[] = [];
    for (const d of f.dias) {
      if (!d.punches.length) continue;
      const out: HeDia = { date: d.date, punches: d.punches, trabalhado: d.trabalhado, jornada: d.jornada ?? f.jornadaTipica, he50: 0, he100: 0, motivo: null, pendente: null };
      if (d.punches.length % 2 === 1) {
        out.pendente = `${d.punches.length} batida(s): falta ${d.punches.length === 1 ? 'a saída' : 'uma marcação'}`;
        dias.push(out);
        continue;
      }
      const feriado = isHoliday(d.date) || d.marks.includes('FERIADO');
      if (!d.previsto) {
        out.he100 = d.trabalhado;
        out.motivo = d.marks.includes('FOLGA') ? 'trabalho em dia de folga' : 'trabalho fora da escala (folga)';
      } else if (feriado && f.escala === 'diaria') {
        out.he100 = d.trabalhado;
        out.motivo = 'trabalho em feriado';
      } else {
        const jor = out.jornada ?? (f.escala === '12x36' ? DEFAULT_PONTO.plantao : cfg.jornada);
        out.jornada = jor;
        const over = d.trabalhado - jor;
        if (over > cfg.tolerancia) {
          out.he50 = over;
          out.motivo = `${fmtH(d.trabalhado)} trabalhadas, jornada de ${fmtH(jor)}`;
        }
      }
      dias.push(out);
    }
    if (!dias.length) continue;
    const meses = new Map<string, HeMes>();
    for (const d of dias) {
      const c = competencia(d.date, cfg.competencia);
      mesesMap.set(c.chave, c.rotulo);
      const m = meses.get(c.chave) ?? { chave: c.chave, rotulo: c.rotulo, dias: 0, trabalhado: 0, he50: 0, he100: 0, total: 0, pendentes: 0 };
      m.dias++;
      m.trabalhado += d.trabalhado;
      m.he50 += d.he50;
      m.he100 += d.he100;
      m.total += d.he50 + d.he100;
      if (d.pendente) m.pendentes++;
      meses.set(c.chave, m);
    }
    const ms = [...meses.values()].sort((x, y) => x.chave.localeCompare(y.chave));
    const sum = (k: keyof HeMes) => ms.reduce((t, m) => t + (m[k] as number), 0);
    funcionarios.push({
      name: f.name,
      matricula: f.matricula,
      cargo: f.cargo,
      posto: f.posto,
      filial: f.filial,
      escala: f.escala === '12x36' ? '12x36' : `Diária${f.jornadaTipica ? ' ' + fmtH(f.jornadaTipica) : ''}`,
      meses: ms,
      total: { trabalhado: sum('trabalhado'), he50: sum('he50'), he100: sum('he100'), total: sum('total'), pendentes: sum('pendentes'), dias: sum('dias') },
      dias,
    });
  }
  funcionarios.sort((x, y) => y.total.total - x.total.total || x.name.localeCompare(y.name, 'pt-BR'));
  const meses = [...mesesMap].map(([chave, rotulo]) => ({ chave, rotulo })).sort((x, y) => x.chave.localeCompare(y.chave));
  const porMes = meses.map((m) => {
    const fs = funcionarios.map((f) => f.meses.find((x) => x.chave === m.chave)).filter(Boolean) as HeMes[];
    return { ...m, he50: fs.reduce((t, x) => t + x.he50, 0), he100: fs.reduce((t, x) => t + x.he100, 0), total: fs.reduce((t, x) => t + x.total, 0) };
  });
  return {
    config: cfg,
    periodo: a.periodo,
    meses,
    funcionarios,
    totais: {
      funcionarios: funcionarios.length,
      comExtra: funcionarios.filter((f) => f.total.total > 0).length,
      he50: funcionarios.reduce((t, f) => t + f.total.he50, 0),
      he100: funcionarios.reduce((t, f) => t + f.total.he100, 0),
      total: funcionarios.reduce((t, f) => t + f.total.total, 0),
      pendentes: funcionarios.reduce((t, f) => t + f.total.pendentes, 0),
      porMes,
    },
    arquivos: meta.arquivos,
    avisos: lido.avisos,
    geradoEm: (meta.agora ?? new Date()).toISOString(),
    geradoPor: meta.por,
  };
}

/** 125 → "2h05"; em relatório de horas extras o costume é hh:mm */
export const fmtH = (min: number) => `${Math.floor(Math.abs(min) / 60)}h${String(Math.abs(Math.round(min)) % 60).padStart(2, '0')}`;
export const hhmmClock = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(Math.round(min) % 60).padStart(2, '0')}`;
/** horas decimais (para a folha): 125 min → 2,08 */
export const decimal = (min: number) => (Math.round((min / 60) * 100) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
