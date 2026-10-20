import { JUSTIFICA } from './parse';
import { DEFAULT_PONTO, ORDEM, SITUACAO, hhmm, type Analise, type Filtros, type DiaAnalisado, type DiaLido, type FuncAnalisado, type FuncLido, type Lido, type Ocorrencia, type PontoConfig, type Situacao } from './types';

/**
 * Cálculos do espelho de ponto, todos em minutos inteiros (sem arredondamento acumulado):
 *  - batidas em pares (entrada→saída); saída menor que a entrada = virou o dia (+24h);
 *  - plantão noturno partido em duas linhas (19:00 num dia, 07:00 no outro) é juntado;
 *  - batida repetida (até 3 min) é descartada e apontada;
 *  - escala: 12x36 (plantões de 10h ou mais) ou diária, ou a escolhida na tela;
 *  - dias previstos: no 12x36, dia sim/dia não a partir dos plantões; na diária, os dias
 *    da semana em que a pessoa costuma trabalhar;
 *  - horário de referência: o do espelho (coluna Horário) ou o habitual da pessoa (mediana);
 *  - tolerância diária (CLT art. 58 §1º), intervalo (art. 71) e interjornada (art. 66).
 */

/** marcações de dia sem trabalho previsto */
const OFF = new Set(['FOLGA', 'FERIADO', 'FÉRIAS', 'DESLIGADO', 'ADMISSÃO', 'COMPENSAÇÃO']);
/** ausência justificada em dia de trabalho */
const AUSENCIA = new Set(['JUSTIFICADA', 'ATESTADO', 'ABONO', 'AFASTAMENTO', 'LICENÇA', 'SUSPENSÃO', 'TREINAMENTO']);
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const fmt = (m: number) => {
  const x = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
};
const addDays = (isoDate: string, n: number) => {
  const d = new Date(isoDate + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dayIndex = (from: string, d: string) => Math.round((Date.parse(d + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z')) / 86400000);
const weekday = (d: string) => new Date(d + 'T12:00:00Z').getUTCDay();
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
/** diferença com sinal no relógio (−720..720): 23:55 vs 00:05 = −10 */
const clockDiff = (a: number, b: number) => ((((a - b) % 1440) + 1440 + 720) % 1440) - 720;

interface Work {
  date: string;
  lido: DiaLido | null;
  mins: number[]; // batidas em minutos desde 00:00 do dia (pode passar de 1440)
  repetidas: number;
}

/** dia com batidas: pares, trabalhado e intervalos */
function measure(mins: number[]) {
  let worked = 0;
  const gaps: number[] = [];
  for (let i = 0; i + 1 < mins.length; i += 2) {
    worked += mins[i + 1] - mins[i];
    if (i + 2 < mins.length) gaps.push(mins[i + 2] - mins[i + 1]);
  }
  return { worked, gaps, start: mins.length ? mins[0] : null, end: mins.length ? mins[mins.length - 1] : null };
}

export function analisar(lido: Lido, cfgIn: Partial<PontoConfig> = {}, meta: { arquivo: string; por: string; agora?: Date } = { arquivo: '', por: '' }): Analise {
  const cfg: PontoConfig = { ...DEFAULT_PONTO, ...cfgIn };
  const periodo = lido.periodo ?? { from: '', to: '' };
  const funcionarios: FuncAnalisado[] = [];
  for (const f of lido.funcionarios) {
    const res = analisarFuncionario(f, periodo, cfg, lido.formato);
    if (res) funcionarios.push(res);
  }
  funcionarios.sort((a, b) => rank(b) - rank(a) || a.name.localeCompare(b.name, 'pt-BR'));
  const imp = importacao(funcionarios);
  return {
    periodo,
    config: cfg,
    formato: lido.formato,
    arquivo: meta.arquivo,
    avisos: [...lido.avisos, ...(imp ? [imp.texto] : [])],
    corte: imp?.inicio ?? null,
    funcionarios,
    resumo: resumir(funcionarios),
    geradoEm: (meta.agora ?? new Date()).toISOString(),
    geradoPor: meta.por,
  };
}

/**
 * Sinal de batidas que não chegaram ao sistema: a partir de um dia, quase todos os escalados
 * aparecem sem nenhuma batida (ex.: 00:00 em tudo). Avisa, para não virar "falta" de todo mundo.
 */
function importacao(fs: FuncAnalisado[]): { inicio: string; texto: string } | null {
  if (fs.length < 3) return null;
  const dates = [...new Set(fs.flatMap((f) => f.dias.map((d) => d.date)))].sort();
  const rate = (d: string) => {
    const esc = fs.map((f) => f.dias.find((x) => x.date === d)).filter((x) => x && (x.previsto || x.punches.length)) as DiaAnalisado[];
    return esc.length >= 3 ? esc.filter((x) => x.ocorrencias.some((o) => o.tipo === 'sem_registro')).length / esc.length : null;
  };
  let start: string | null = null;
  for (let i = dates.length - 1; i >= 0; i--) {
    const r = rate(dates[i]);
    if (r === null) continue;
    if (r >= 0.6) start = dates[i];
    else break;
  }
  if (!start) return null;
  const afetados = fs.filter((f) => f.dias.some((d) => d.date >= start! && d.ocorrencias.some((o) => o.tipo === 'sem_registro'))).length;
  const dias = dates.filter((d) => d >= start!).length;
  if (dias < 2) return null;
  return { inicio: start, texto: `A partir de ${start.split('-').reverse().join('/')}, ${afetados} de ${fs.length} funcionários aparecem nos dias de escala sem nenhuma batida (no GesOper, 00:00 em tudo e o dia descontado). Tanta gente junta costuma ser batida que ainda não foi importada: se for o caso, exporte o espelho de novo depois da importação. Se o espelho já está tratado, são dias sem registro de verdade.` };
}

export function resumir(funcionarios: FuncAnalisado[]): Analise['resumo'] {
  const porTipo: Partial<Record<Situacao, number>> = {};
  for (const f of funcionarios) for (const [k, v] of Object.entries(f.totais.porTipo)) porTipo[k as Situacao] = (porTipo[k as Situacao] ?? 0) + (v ?? 0);
  const avaliados = funcionarios.reduce((t, f) => t + f.dias.filter((d) => d.previsto || d.punches.length).length, 0);
  const limpos = funcionarios.reduce((t, f) => t + f.dias.filter((d) => (d.previsto || d.punches.length) && !d.ocorrencias.some((o) => SITUACAO[o.tipo].nivel !== 'baixa')).length, 0);
  // por posto: cada ocorrência conta no posto do dia
  const postos = new Map<string, { funcs: Set<string>; ocorrencias: number }>();
  for (const f of funcionarios) {
    for (const d of f.dias) {
      const k = d.local || f.posto || 'Sem posto informado';
      if (!d.local && !d.ocorrencias.length && !d.punches.length) continue;
      const p = postos.get(k) ?? { funcs: new Set<string>(), ocorrencias: 0 };
      p.funcs.add(f.name + (f.matricula ?? ''));
      p.ocorrencias += d.ocorrencias.filter((o) => SITUACAO[o.tipo].nivel !== 'baixa').length;
      postos.set(k, p);
    }
  }
  return {
    funcionarios: funcionarios.length,
    comOcorrencia: funcionarios.filter((f) => f.status !== 'ok').length,
    criticos: funcionarios.filter((f) => f.status === 'critico').length,
    dias: avaliados,
    ocorrencias: funcionarios.reduce((t, f) => t + f.totais.ocorrencias, 0),
    porTipo,
    conformidade: avaliados ? Math.round((limpos / avaliados) * 1000) / 10 : 100,
    horas: funcionarios.reduce((t, f) => t + f.totais.minutos, 0),
    extras: funcionarios.reduce((t, f) => t + f.totais.extras, 0),
    postos: [...postos].map(([posto, v]) => ({ posto, funcionarios: v.funcs.size, ocorrencias: v.ocorrencias })).sort((a, b) => b.ocorrencias - a.ocorrencias || a.posto.localeCompare(b.posto, 'pt-BR')),
  };
}

/** opções dos filtros (cliente/posto, filial, função) */
export function opcoes(a: Analise) {
  const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter(Boolean) as string[])].sort((x, y) => x.localeCompare(y, 'pt-BR'));
  return {
    postos: uniq(a.funcionarios.flatMap((f) => [...f.postos, f.posto])),
    filiais: uniq(a.funcionarios.map((f) => f.filial)),
    funcoes: uniq(a.funcionarios.map((f) => f.cargo)),
  };
}

/**
 * Recorte da análise: período (de/até), cliente/posto (só os dias naquele posto), filial e
 * função. Totais, situação e resumo são refeitos sobre o recorte.
 */
export function filtrar(a: Analise, fl: Filtros): Analise {
  const de = fl.de && fl.de > a.periodo.from ? fl.de : a.periodo.from;
  const ate = fl.ate && fl.ate < a.periodo.to ? fl.ate : a.periodo.to;
  const ativo = Boolean(fl.posto || fl.filial || fl.funcao || de !== a.periodo.from || ate !== a.periodo.to);
  if (!ativo) return { ...a, filtros: undefined };
  const funcs: FuncAnalisado[] = [];
  for (const f of a.funcionarios) {
    if (fl.filial && f.filial !== fl.filial) continue;
    if (fl.funcao && f.cargo !== fl.funcao) continue;
    let dias = f.dias.filter((d) => d.date >= de && d.date <= ate);
    if (fl.posto) {
      if (!f.postos.includes(fl.posto) && f.posto !== fl.posto) continue;
      // dias sem posto escrito (folga, falta) ficam com quem é do posto
      dias = dias.filter((d) => d.local === fl.posto || (!d.local && (f.posto === fl.posto)));
    }
    if (!dias.length) continue;
    funcs.push({ ...f, dias, ...totalizar(dias) });
  }
  funcs.sort((x, y) => rank(y) - rank(x) || x.name.localeCompare(y.name, 'pt-BR'));
  // cortou antes do dia em que as batidas pararam de chegar: o aviso não vale mais
  const avisos = a.corte && ate < a.corte ? a.avisos.filter((x) => !x.startsWith('A partir de')) : a.avisos;
  return { ...a, avisos, filtros: { ...fl, de, ate }, funcionarios: funcs, resumo: resumir(funcs) };
}

const rank = (f: FuncAnalisado) => (f.status === 'critico' ? 2e6 : f.status === 'atencao' ? 1e6 : 0) + peso(f.totais.porTipo);
const peso = (p: Partial<Record<Situacao, number>>) => Object.entries(p).reduce((t, [k, v]) => t + (v ?? 0) * (SITUACAO[k as Situacao].nivel === 'alta' ? 3 : SITUACAO[k as Situacao].nivel === 'media' ? 1 : 0), 0);

function analisarFuncionario(f: FuncLido, periodo: { from: string; to: string }, cfg: PontoConfig, formato: string): FuncAnalisado | null {
  if (!periodo.from) return null;
  const listed = f.days.filter((d) => d.date >= periodo.from && d.date <= periodo.to);
  if (!listed.length) return null;
  // espelho lista todos os dias da pessoa: avalia do primeiro ao último dia listado (admissão/
  // desligamento no meio do período); lista de batidas só tem os dias batidos: avalia o período
  const from = formato === 'lista' ? periodo.from : listed[0].date;
  const to = formato === 'lista' ? periodo.to : listed[listed.length - 1].date;
  const n = Math.min(62, dayIndex(from, to) + 1);
  const work: Work[] = [];
  for (let i = 0; i < n; i++) {
    const date = addDays(from, i);
    const lido = listed.find((d) => d.date === date) ?? null;
    // batidas em ordem do espelho; saída menor que a anterior = passou da meia-noite
    const mins: number[] = [];
    let repetidas = 0;
    for (const p of lido?.punches ?? []) {
      let m = toMin(p);
      while (mins.length && m < mins[mins.length - 1] - 30) m += 1440;
      if (mins.length && Math.abs(m - mins[mins.length - 1]) <= 3) {
        repetidas++;
        continue;
      }
      mins.push(m);
    }
    work.push({ date, lido, mins, repetidas });
  }
  // plantão noturno partido em duas linhas: entrada à noite num dia (batidas ímpares) e a
  // saída de manhã na linha do dia seguinte
  for (let i = 0; i + 1 < work.length; i++) {
    const a = work[i];
    const b = work[i + 1];
    if (a.mins.length % 2 === 1 && b.mins.length % 2 === 1 && a.mins[a.mins.length - 1] >= 12 * 60 && b.mins[0] < 12 * 60) {
      const moved = b.mins.shift()! + 1440;
      if (moved - a.mins[a.mins.length - 1] <= 16 * 60) a.mins.push(moved);
      else b.mins.unshift(moved - 1440);
    }
  }

  // escala: plantões de 10h ou mais → 12x36
  const spans = work.filter((w) => w.mins.length >= 2 && w.mins.length % 2 === 0).map((w) => w.mins[w.mins.length - 1] - w.mins[0]);
  // jornada que o próprio sistema de ponto espera (Hr. Dia − Dif.), quando o espelho traz
  const sysJ = listed.map((d) => (d.sisTrab != null && d.sisDif != null ? d.sisTrab - d.sisDif : null)).filter((x): x is number => x !== null && x >= 60 && x <= 1440);
  const jornadaTipica = median(sysJ) ?? (median(spans.map((x) => x - 60)) ?? null);
  const escala: '12x36' | 'diaria' = cfg.escala === 'auto' ? ((sysJ.length ? median(sysJ)! : median(spans) ?? 0) >= 600 ? '12x36' : 'diaria') : cfg.escala;
  const worked = work.filter((w) => w.mins.length);
  // dias previstos
  const previsto = new Array<boolean>(work.length).fill(false);
  if (escala === '12x36') {
    const par = worked.filter((w) => dayIndex(from, w.date) % 2 === 0).length;
    const impar = worked.length - par;
    const anchor = par >= impar ? 0 : 1;
    work.forEach((w, i) => (previsto[i] = i % 2 === anchor));
  } else {
    const occ = new Array(7).fill(0);
    const hit = new Array(7).fill(0);
    work.forEach((w) => {
      occ[weekday(w.date)]++;
      if (w.mins.length) hit[weekday(w.date)]++;
    });
    const days = worked.length >= 4 ? [0, 1, 2, 3, 4, 5, 6].filter((d) => occ[d] && hit[d] / occ[d] >= 0.5) : [1, 2, 3, 4, 5];
    work.forEach((w, i) => (previsto[i] = days.includes(weekday(w.date))));
  }
  // o espelho já traz a escala (dias de "Folga"): vale ela, qualquer que seja (12x36, 5x2, 6x1…)
  const temEscala = listed.filter((d) => d.marks.some((k) => OFF.has(k))).length >= 2;
  if (temEscala)
    work.forEach((w, i) => {
      const l = w.lido;
      // dia com batida que o próprio sistema não esperava (jornada prevista zero) = folga trabalhada
      const semPrevisao = l && l.sisTrab != null && l.sisDif != null && l.sisTrab - l.sisDif <= 0 && w.mins.length > 0;
      previsto[i] = Boolean(l) && !l!.marks.some((k) => OFF.has(k)) && !semPrevisao;
    });
  // horário de referência: o previsto do espelho; senão o habitual (mediana dos dias completos)
  const complete = work.filter((w) => w.mins.length >= 2 && w.mins.length % 2 === 0);
  const starts = complete.map((w) => w.mins[0] % 1440);
  const ends = complete.map((w) => w.mins[w.mins.length - 1] % 1440);
  const spread = (xs: number[]) => {
    const m = median(xs);
    if (m === null) return Infinity;
    return median(xs.map((x) => Math.abs(clockDiff(x, m)))) ?? Infinity;
  };
  // horário habitual só vale se a pessoa tem rotina (metade dos dias até 1h do habitual)
  const habInicio = complete.length >= 3 && spread(starts) <= 60 ? median(starts) : null;
  const habFim = complete.length >= 3 && spread(ends) <= 60 ? median(ends) : null;
  // horário de referência de cada dia: o habitual da vizinhança (7 dias antes e depois), para
  // acompanhar quem mudou de horário no meio do período; sem vizinhos suficientes, o do período
  const idx = new Map(work.map((w, i) => [w.date, i]));
  const local = (i: number, pick: (w: Work) => number, glob: number | null) => {
    const near = complete.filter((w) => w !== work[i] && Math.abs((idx.get(w.date) ?? 0) - i) <= 7).map(pick);
    if (near.length >= 3 && spread(near) <= 30) return median(near);
    return glob;
  };
  const jornadaPadrao = escala === '12x36' ? cfg.plantao : cfg.jornada;
  // o intervalo é cobrado quando o espelho tem o campo dele (00:00 no lugar) ou quando a pessoa
  // costuma bater o intervalo; quem nunca bate (intervalo pré-assinalado) não é cobrado todo dia
  const longos = complete.filter((w) => w.mins[w.mins.length - 1] - w.mins[0] > 360);
  const bateIntervalo = longos.length > 0 && longos.filter((w) => w.mins.length >= 4).length / longos.length >= 0.3;
  const limite = escala === '12x36' ? cfg.plantao : 600;

  const dias: DiaAnalisado[] = [];
  let lastEnd: number | null = null; // fim da jornada anterior, em minutos desde `from`
  work.forEach((w, i) => {
    const oc: Ocorrencia[] = [];
    const marks = w.lido?.marks ?? [];
    const m = measure(w.mins);
    const sched = w.lido?.schedule?.map(toMin) ?? null;
    const has = w.mins.length > 0;
    const justified = marks.some((k) => JUSTIFICA.has(k));
    if (w.repetidas) oc.push({ tipo: 'repetida', min: null, texto: `${w.repetidas} batida(s) repetida(s) desconsiderada(s)` });
    const ausJust = marks.some((k) => AUSENCIA.has(k));
    if (!has) {
      if (ausJust) oc.push({ tipo: 'justificada', min: null, texto: `Ausência justificada (${marks.filter((k) => AUSENCIA.has(k) || k === 'FALTA').join(', ').toLowerCase()})` });
      else if (marks.includes('FALTA')) oc.push({ tipo: 'falta', min: null, texto: 'Falta marcada no espelho' });
      else if (previsto[i] && !justified) oc.push({ tipo: 'sem_registro', min: null, texto: w.lido?.local ? `Escalado no posto, sem nenhuma batida${w.lido.sisDif !== null && w.lido.sisDif !== undefined && w.lido.sisDif < 0 ? ` (o sistema descontou ${hhmm(-w.lido.sisDif)})` : ''}` : 'Dia de trabalho sem nenhuma batida' });
    } else {
      if (w.mins.length % 2 === 1) oc.push({ tipo: 'incompleta', min: null, texto: `${w.mins.length} batida(s): falta ${w.mins.length === 1 ? 'a saída' : 'uma marcação'}` });
      if ((escala === '12x36' || temEscala) && !previsto[i]) oc.push({ tipo: 'dia_folga', min: null, texto: marks.includes('FOLGA') ? 'Batidas em dia marcado como folga (dobra ou troca de plantão)' : 'Batidas em dia de folga da escala (dobra ou troca de plantão)' });
      // horário de referência do dia
      let expStart: number | null = sched ? sched[0] : local(i, (x) => x.mins[0] % 1440, habInicio);
      let expEnd: number | null = sched && sched.length >= 2 ? sched[sched.length - 1] : local(i, (x) => x.mins[x.mins.length - 1] % 1440, habFim);
      // jornada prevista: a do sistema de ponto (Hr. Dia − Dif.), a do horário do espelho, senão a da escala
      let jornada = jornadaPadrao;
      const sys = w.lido && w.lido.sisTrab !== null && w.lido.sisTrab !== undefined && w.lido.sisDif !== null && w.lido.sisDif !== undefined ? w.lido.sisTrab - w.lido.sisDif : null;
      if (sys !== null && sys >= 60 && sys <= 1440) jornada = sys;
      if (sched && sched.length >= 2) {
        let j = 0;
        let prev = sched[0];
        const s = [sched[0]];
        for (const x of sched.slice(1)) {
          let y = x;
          while (y < prev) y += 1440;
          s.push(y);
          prev = y;
        }
        for (let k = 0; k + 1 < s.length; k += 2) j += s[k + 1] - s[k];
        if (j > 0) jornada = j;
        expEnd = s[s.length - 1] % 1440;
        expStart = s[0];
      }
      if (m.start !== null && expStart !== null) {
        const late = clockDiff(m.start, expStart);
        if (late > cfg.tolerancia && late < 6 * 60) oc.push({ tipo: 'atraso', min: late, texto: `Entrada às ${fmt(m.start)} (previsto ${fmt(expStart)}): ${hhmm(late)} de atraso` });
      }
      if (w.mins.length % 2 === 0) {
        if (m.end !== null && expEnd !== null) {
          const early = clockDiff(expEnd, m.end);
          if (early > cfg.tolerancia && early < 6 * 60) oc.push({ tipo: 'saida_antecipada', min: early, texto: `Saída às ${fmt(m.end)} (previsto ${fmt(expEnd)}): ${hhmm(early)} antes` });
        }
        const over = m.worked - jornada;
        if (m.worked > limite + cfg.tolerancia) oc.push({ tipo: 'excesso', min: m.worked - limite, texto: `Jornada de ${hhmm(m.worked)} (limite ${hhmm(limite)})` });
        else if (over > cfg.tolerancia) oc.push({ tipo: 'extra', min: over, texto: `${hhmm(over)} além da jornada de ${hhmm(jornada)}` });
        // intervalo: obrigatório acima de 6h (a tolerância das marcações vale: até 5 min)
        if (m.worked > 360) {
          if (m.gaps.length) {
            const g = Math.min(...m.gaps);
            if (g < cfg.intervalo - Math.min(5, cfg.tolerancia)) oc.push({ tipo: 'intervalo_curto', min: g, texto: `Intervalo de ${hhmm(g)} (mínimo ${hhmm(cfg.intervalo)})` });
          } else if ((w.lido?.vazias ?? 0) >= 2 || bateIntervalo) oc.push({ tipo: 'sem_intervalo', min: null, texto: `Intervalo não batido: ${fmt(m.start ?? 0)} às ${fmt(m.end ?? 0)} direto (${hhmm(m.worked)})` });
        }
      }
      // descanso desde a jornada anterior
      const startAbs = i * 1440 + (m.start ?? 0);
      if (lastEnd !== null && m.start !== null) {
        const rest = startAbs - lastEnd;
        if (rest >= 0 && rest < cfg.interjornada) oc.push({ tipo: 'interjornada', min: rest, texto: `Só ${hhmm(rest)} de descanso desde a jornada anterior (mínimo ${hhmm(cfg.interjornada)})` });
      }
      if (m.end !== null && w.mins.length >= 2) lastEnd = i * 1440 + m.end;
    }
    oc.sort((a, b) => ORDEM.indexOf(a.tipo) - ORDEM.indexOf(b.tipo));
    dias.push({
      date: w.date,
      weekday: weekday(w.date),
      punches: w.mins.map(fmt),
      marks,
      previsto: previsto[i],
      trabalhado: w.mins.length % 2 === 0 ? m.worked : measure(w.mins.slice(0, w.mins.length - 1)).worked,
      intervalo: m.gaps.length ? m.gaps.reduce((t, g) => t + g, 0) : null,
      inicio: m.start !== null ? fmt(m.start) : null,
      fim: m.end !== null && w.mins.length >= 2 ? fmt(m.end) : null,
      virada: m.end !== null && m.end >= 1440,
      local: w.lido?.local ?? null,
      jornada: has ? (() => {
        const sys = w.lido && w.lido.sisTrab != null && w.lido.sisDif != null ? w.lido.sisTrab - w.lido.sisDif : null;
        return sys !== null && sys >= 60 && sys <= 1440 ? sys : jornadaPadrao;
      })() : null,
      ocorrencias: oc,
    });
  });

  // cliente/posto: o dos dias (o mais frequente) ou o do cabeçalho
  const freq = new Map<string, number>();
  for (const d of dias) if (d.local) freq.set(d.local, (freq.get(d.local) ?? 0) + (d.punches.length ? 2 : 1));
  const postos = [...freq].sort((x, y) => y[1] - x[1]).map(([k]) => k);
  const base = {
    name: f.name,
    matricula: f.matricula,
    posto: postos[0] ?? f.posto,
    postos: postos.length ? postos : f.posto ? [f.posto] : [],
    cargo: f.cargo,
    filial: [f.empresa, f.cnpj ? `CNPJ ${f.cnpj}` : null].filter(Boolean).join(' · ') || null,
    escala,
    jornadaTipica: sysJ.length ? median(sysJ) : jornadaTipica !== null && jornadaTipica > 0 ? (escala === '12x36' ? cfg.plantao : cfg.jornada) : null,
    habitual: { inicio: habInicio !== null ? fmt(habInicio) : null, fim: habFim !== null ? fmt(habFim) : null },
    dias,
  };
  return { ...base, ...totalizar(dias) };
}

/** totais e situação de um funcionário a partir dos dias (refeito quando filtra o período/posto) */
export function totalizar(dias: DiaAnalisado[]): Pick<FuncAnalisado, 'totais' | 'status'> {
  const porTipo: Partial<Record<Situacao, number>> = {};
  for (const d of dias) for (const o of d.ocorrencias) porTipo[o.tipo] = (porTipo[o.tipo] ?? 0) + 1;
  const avaliados = dias.filter((d) => d.previsto || d.punches.length);
  const limpos = avaliados.filter((d) => !d.ocorrencias.some((o) => SITUACAO[o.tipo].nivel !== 'baixa'));
  const sum = (t: Situacao) => dias.reduce((s, d) => s + d.ocorrencias.filter((o) => o.tipo === t).reduce((x, o) => x + (o.min ?? 0), 0), 0);
  const ocorrencias = dias.reduce((t, d) => t + d.ocorrencias.length, 0);
  const alta = dias.reduce((t, d) => t + d.ocorrencias.filter((o) => SITUACAO[o.tipo].nivel === 'alta').length, 0);
  const media = dias.reduce((t, d) => t + d.ocorrencias.filter((o) => SITUACAO[o.tipo].nivel === 'media').length, 0);
  return {
    totais: {
      trabalhados: dias.filter((d) => d.punches.length).length,
      previstos: dias.filter((d) => d.previsto).length,
      minutos: dias.reduce((t, d) => t + d.trabalhado, 0),
      extras: sum('extra') + sum('excesso'),
      atrasos: sum('atraso'),
      justificados: dias.filter((d) => !d.punches.length && d.marks.some((k) => JUSTIFICA.has(k) && !OFF.has(k))).length,
      porTipo,
      ocorrencias,
      conformidade: avaliados.length ? Math.round((limpos.length / avaliados.length) * 1000) / 10 : 100,
    },
    status: alta * 3 + media >= 6 ? 'critico' : alta + media > 0 ? 'atencao' : 'ok',
  };
}
