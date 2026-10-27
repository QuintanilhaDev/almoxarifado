/**
 * Controle de fardamento (planilha do RH/DP com cada entrega de farda feita a um funcionário).
 * A planilha é importada na Gestão e guardada já organizada; a análise roda na tela (filtros na hora).
 */

/** uma peça entregue: peça (ex.: "Camisa ML", "Botina", "Boné"), tamanho e quantidade */
export type Peca = [peca: string, tamanho: string | null, qtd: number];

export interface Entrega {
  /** empresa: Max Forte, Max Serviços, Max Confiável */
  e: string;
  /** data da solicitação (AAAA-MM-DD) */
  s: string | null;
  /** solicitante */
  q: string;
  /** funcionário */
  f: string;
  /** função */
  fn: string;
  /** posto / cliente */
  p: string;
  /** data da entrega (AAAA-MM-DD) */
  d: string | null;
  /** mês de referência (AAAA-MM): o da entrega; sem data, o da coluna mês/ano */
  m: string;
  i: Peca[];
}

export interface ControleFarda {
  arquivo: string;
  aba: string;
  importadoEm: string;
  por: string;
  avisos: string[];
  entregas: Entrega[];
}

export type Grupo = 'Camisas' | 'Calças' | 'Calçados' | 'Acessórios';
export const GRUPOS: Grupo[] = ['Camisas', 'Calças', 'Calçados', 'Acessórios'];

const CALCADO = /^(botina|bota|sapato|t[eê]nis|antiderrapante|coturno|chinelo|sand[aá]lia|tamanco|galocha)/i;
export function grupoDe(peca: string): Grupo {
  if (/^camisa|^camiseta|^blusa|^polo/i.test(peca)) return 'Camisas';
  if (/^cal[cç]a|^bermuda|^saia/i.test(peca)) return 'Calças';
  if (CALCADO.test(peca)) return 'Calçados';
  return 'Acessórios';
}

const ORDEM_LETRAS = ['PP', 'P', 'M', 'G', 'GG', 'XG', 'XGG', 'EXG', 'EXGG', 'G1', 'G2', 'G3', 'ESP', 'ESP1', 'ESP 1', 'ESP2', 'ESP 2', 'ÚNICO', 'UNICO'];
/** ordem natural dos tamanhos: números em ordem; letras de PP a EXGG; o resto no fim */
export function ordemTamanho(a: string | null, b: string | null): number {
  const k = (t: string | null): [number, number, string] => {
    if (!t) return [3, 0, ''];
    const n = Number(t.replace(',', '.'));
    if (Number.isFinite(n)) return [0, n, ''];
    const i = ORDEM_LETRAS.indexOf(t.toUpperCase());
    return i >= 0 ? [1, i, ''] : [2, 0, t];
  };
  const x = k(a);
  const y = k(b);
  return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2], 'pt-BR');
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MESES_LONGOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const mesCurto = (ym: string) => `${MESES[Number(ym.slice(5, 7)) - 1]}/${ym.slice(2, 4)}`;
export const mesLongo = (ym: string) => `${MESES_LONGOS[Number(ym.slice(5, 7)) - 1]} de ${ym.slice(0, 4)}`;
export const MESES_ABREV = MESES;
