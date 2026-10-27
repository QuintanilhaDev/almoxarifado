import { grupoDe, ordemTamanho, type Entrega, type Grupo } from './types';

/**
 * Análise do controle de fardamento (roda na tela, os filtros respondem na hora).
 * Tudo é contado a partir das entregas: nada vem das tabelas de resumo da planilha.
 */

export interface FiltrosFarda {
  de: string; // AAAA-MM
  ate: string; // AAAA-MM
  empresa: string;
  funcao: string;
  posto: string;
  solicitante: string;
  peca: string;
}
export const SEM_FILTRO = {
  empresa: '',
  funcao: '',
  posto: '',
  solicitante: '',
  peca: '',
};

export interface Fatia {
  nome: string;
  entregas: number;
  pecas: number;
  funcionarios: number;
}
export interface MesFarda {
  mes: string;
  entregas: number;
  pecas: number;
  funcionarios: number;
}
export interface PecaTotal {
  peca: string;
  grupo: Grupo;
  qtd: number;
  entregas: number;
}
export interface Tamanho {
  tam: string;
  qtd: number;
  pct: number;
  porMes: number;
}
export interface Recorrente {
  nome: string;
  funcao: string;
  posto: string;
  entregas: number;
  pecas: number;
  datas: string[];
}

export interface ResumoFarda {
  meses: number;
  total: {
    entregas: number;
    pecas: number;
    funcionarios: number;
    postos: number;
    porEntrega: number;
    pecasMes: number;
    entregasMes: number;
  };
  /** o último mês do período ainda não terminou na planilha (ex.: entregas só até o dia 19) */
  parcial: { mes: string; ate: string } | null;
  /** últimos 3 meses completos do período × os 3 anteriores (peças) */
  tendencia: { atual: number; anterior: number; pct: number | null } | null;
  /** mesmo intervalo do ano anterior (peças), quando a planilha cobre */
  anoAnterior: { pecas: number; entregas: number; pct: number | null } | null;
  porMes: MesFarda[];
  porGrupo: { grupo: Grupo; qtd: number }[];
  pecas: PecaTotal[];
  empresas: Fatia[];
  funcoes: Fatia[];
  postos: Fatia[];
  solicitantes: Fatia[];
  recorrentes: Recorrente[];
  pico: MesFarda | null;
}

const chave = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

export function mesesEntre(de: string, ate: string): string[] {
  const out: string[] = [];
  let [y, m] = de.split('-').map(Number);
  const [y2, m2] = ate.split('-').map(Number);
  while (y < y2 || (y === y2 && m <= m2)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    if (++m > 12) {
      m = 1;
      y++;
    }
    if (out.length > 240) break;
  }
  return out;
}
const menosMeses = (ym: string, n: number) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 - n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const pct = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 1000) / 10 : null);

/** só os filtros de cadastro (empresa, função, posto, solicitante); o período e a peça ficam de fora */
function passa(e: Entrega, f: Partial<FiltrosFarda>) {
  return (!f.empresa || e.e === f.empresa) && (!f.funcao || e.fn === f.funcao) && (!f.posto || e.p === f.posto) && (!f.solicitante || e.q === f.solicitante);
}
const pecasDe = (e: Entrega, peca: string) => (peca ? e.i.filter((i) => i[0] === peca) : e.i);
const somaPecas = (e: Entrega, peca: string) => pecasDe(e, peca).reduce((t, i) => t + i[2], 0);

export function filtrar(es: Entrega[], f: FiltrosFarda): Entrega[] {
  return es.filter((e) => e.m >= f.de && e.m <= f.ate && passa(e, f) && (!f.peca || e.i.some((i) => i[0] === f.peca)));
}

function fatias(es: Entrega[], peca: string, campo: (e: Entrega) => string): Fatia[] {
  const m = new Map<string, { entregas: number; pecas: number; f: Set<string> }>();
  for (const e of es) {
    const k = campo(e);
    const x = m.get(k) ?? { entregas: 0, pecas: 0, f: new Set<string>() };
    x.entregas++;
    x.pecas += somaPecas(e, peca);
    x.f.add(chave(e.f));
    m.set(k, x);
  }
  return [...m]
    .map(([nome, x]) => ({
      nome,
      entregas: x.entregas,
      pecas: x.pecas,
      funcionarios: x.f.size,
    }))
    .sort((a, b) => b.pecas - a.pecas || b.entregas - a.entregas);
}

export function resumir(todas: Entrega[], f: FiltrosFarda): ResumoFarda {
  const es = filtrar(todas, f);
  const meses = mesesEntre(f.de, f.ate);
  const n = Math.max(1, meses.length);
  const funcs = new Set(es.map((e) => chave(e.f)));
  const pecasTot = es.reduce((t, e) => t + somaPecas(e, f.peca), 0);

  const porMesMap = new Map(meses.map((m) => [m, { mes: m, entregas: 0, pecas: 0, f: new Set<string>() }]));
  for (const e of es) {
    const x = porMesMap.get(e.m);
    if (!x) continue;
    x.entregas++;
    x.pecas += somaPecas(e, f.peca);
    x.f.add(chave(e.f));
  }
  const porMes = [...porMesMap.values()].map((x) => ({
    mes: x.mes,
    entregas: x.entregas,
    pecas: x.pecas,
    funcionarios: x.f.size,
  }));

  const pm = new Map<string, PecaTotal>();
  for (const e of es)
    for (const [peca, , q] of pecasDe(e, f.peca)) {
      const x = pm.get(peca) ?? {
        peca,
        grupo: grupoDe(peca),
        qtd: 0,
        entregas: 0,
      };
      x.qtd += q;
      x.entregas++;
      pm.set(peca, x);
    }
  const pecas = [...pm.values()].sort((a, b) => b.qtd - a.qtd);
  const gm = new Map<Grupo, number>();
  for (const p of pecas) gm.set(p.grupo, (gm.get(p.grupo) ?? 0) + p.qtd);

  // a planilha ainda está sendo preenchida no último mês? (a última entrega é antes do dia 25)
  const ultimaData = todas.reduce((m, e) => (e.d && e.d > m ? e.d : m), '');
  const parcial = ultimaData.slice(0, 7) === f.ate && Number(ultimaData.slice(8)) < 25 ? { mes: f.ate, ate: ultimaData } : null;
  // tendência: os 3 últimos meses completos do período contra os 3 anteriores
  let tendencia: ResumoFarda['tendencia'] = null;
  const completos = parcial ? porMes.slice(0, -1) : porMes;
  if (completos.length >= 6) {
    const a = completos.slice(-3).reduce((t, m) => t + m.pecas, 0);
    const b = completos.slice(-6, -3).reduce((t, m) => t + m.pecas, 0);
    tendencia = { atual: a, anterior: b, pct: pct(a, b) };
  }
  // mesmo período um ano antes (quando a planilha tem esses meses); com o mês em andamento,
  // o do ano anterior é cortado no mesmo dia, para comparar igual com igual
  let anoAnterior: ResumoFarda['anoAnterior'] = null;
  const de0 = menosMeses(f.de, 12);
  const ate0 = menosMeses(f.ate, 12);
  const primeiro = todas.reduce((m, e) => (e.m < m ? e.m : m), '9999-99');
  if (de0 >= primeiro && meses.length <= 12) {
    const dia = parcial ? parcial.ate.slice(8) : '31';
    const antes = filtrar(todas, { ...f, de: de0, ate: ate0 }).filter((e) => e.m !== ate0 || !e.d || e.d.slice(8) <= dia);
    const p0 = antes.reduce((t, e) => t + somaPecas(e, f.peca), 0);
    anoAnterior = { pecas: p0, entregas: antes.length, pct: pct(pecasTot, p0) };
  }

  // quem recebeu mais vezes no período (3 ou mais entregas)
  const rm = new Map<string, Recorrente>();
  for (const e of es) {
    const k = chave(e.f);
    const x = rm.get(k) ?? {
      nome: e.f,
      funcao: e.fn,
      posto: e.p,
      entregas: 0,
      pecas: 0,
      datas: [],
    };
    x.entregas++;
    x.pecas += somaPecas(e, f.peca);
    x.datas.push(e.d ?? e.m);
    x.funcao = e.fn;
    x.posto = e.p;
    rm.set(k, x);
  }
  const recorrentes = [...rm.values()]
    .filter((r) => r.entregas >= 3)
    .map((r) => ({ ...r, datas: r.datas.sort() }))
    .sort((a, b) => b.entregas - a.entregas || b.pecas - a.pecas);

  const pico = porMes.reduce<MesFarda | null>((p, m) => (!p || m.entregas > p.entregas ? m : p), null);
  return {
    meses: meses.length,
    total: {
      entregas: es.length,
      pecas: pecasTot,
      funcionarios: funcs.size,
      postos: new Set(es.map((e) => e.p)).size,
      porEntrega: es.length ? Math.round((pecasTot / es.length) * 10) / 10 : 0,
      pecasMes: Math.round(pecasTot / n),
      entregasMes: Math.round(es.length / n),
    },
    parcial,
    tendencia,
    anoAnterior,
    porMes,
    porGrupo: [...gm].map(([grupo, qtd]) => ({ grupo, qtd })).sort((a, b) => b.qtd - a.qtd),
    pecas,
    empresas: fatias(es, f.peca, (e) => e.e),
    funcoes: fatias(es, f.peca, (e) => e.fn),
    postos: fatias(es, f.peca, (e) => e.p),
    solicitantes: fatias(es, f.peca, (e) => e.q),
    recorrentes,
    pico: pico && pico.entregas ? pico : null,
  };
}

/** grade de tamanhos de uma peça no período: quantidade, % e média por mês (base para compra) */
export function grade(todas: Entrega[], f: FiltrosFarda, peca: string): Tamanho[] {
  const es = filtrar(todas, { ...f, peca: '' });
  const n = Math.max(1, mesesEntre(f.de, f.ate).length);
  const m = new Map<string, number>();
  let total = 0;
  for (const e of es)
    for (const [p, t, q] of e.i)
      if (p === peca) {
        const k = t ?? 'Sem tamanho';
        m.set(k, (m.get(k) ?? 0) + q);
        total += q;
      }
  return [...m]
    .map(([tam, qtd]) => ({
      tam,
      qtd,
      pct: total ? (qtd / total) * 100 : 0,
      porMes: qtd / n,
    }))
    .sort((a, b) => ordemTamanho(a.tam === 'Sem tamanho' ? null : a.tam, b.tam === 'Sem tamanho' ? null : b.tam));
}

/** listas para os filtros (com a contagem de entregas de cada opção) */
export function opcoesFarda(es: Entrega[]) {
  const conta = (campo: (e: Entrega) => string[]) => {
    const m = new Map<string, number>();
    for (const e of es) for (const k of campo(e)) m.set(k, (m.get(k) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR')).map(([nome, n]) => ({ nome, n }));
  };
  const ms = es.map((e) => e.m).sort();
  return {
    empresas: conta((e) => [e.e]),
    funcoes: conta((e) => [e.fn]),
    postos: conta((e) => [e.p]),
    solicitantes: conta((e) => [e.q]),
    pecas: conta((e) => [...new Set(e.i.map((i) => i[0]))]),
    primeiro: ms[0] ?? '',
    ultimo: ms[ms.length - 1] ?? '',
  };
}
