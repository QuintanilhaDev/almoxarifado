/**
 * Aba Pontos: análise do espelho de ponto exportado do GesOper.
 * Tipos compartilhados entre o servidor (leitura, cálculo, PDF) e a tela.
 */

/** quem vê a aba Pontos (pedido do Mateus: só a Evelyn) */
export const PONTOS_USERS = ['evelyn'];
export const canPontos = (user: { username?: string | null } | null | undefined) => Boolean(user?.username && PONTOS_USERS.includes(user.username.toLowerCase()));

export type Escala = 'auto' | '12x36' | 'diaria';

export interface PontoConfig {
  /** escala dos postos: automática (pela duração dos plantões), 12x36 ou diária */
  escala: Escala;
  /** tolerância por dia, em minutos (CLT art. 58 §1º: até 5 min por marcação, 10 por dia) */
  tolerancia: number;
  /** jornada diária da escala diária, em minutos (44h semanais em 5 dias = 8h48) */
  jornada: number;
  /** jornada do plantão 12x36, em minutos */
  plantao: number;
  /** intervalo mínimo para jornada acima de 6h, em minutos */
  intervalo: number;
  /** descanso mínimo entre duas jornadas, em minutos (CLT art. 66: 11h) */
  interjornada: number;
  /** dia em que começa o período de apuração (21 → de 21 a 20 do mês seguinte) */
  inicio: number;
}

export const DEFAULT_PONTO: PontoConfig = { escala: 'auto', tolerancia: 10, jornada: 528, plantao: 720, intervalo: 60, interjornada: 660, inicio: 21 };

/** dia do espelho como veio do arquivo */
export interface DiaLido {
  date: string; // AAAA-MM-DD
  punches: string[]; // HH:MM, na ordem do espelho
  marks: string[]; // FOLGA, FÉRIAS, ATESTADO, FALTA…
  /** horário previsto, quando o espelho traz (ex.: 07:00 às 19:00) */
  schedule: string[] | null;
  /** cliente/posto do dia (o GesOper escreve na linha: "CODEBAARATU PORTARIA01 - PIER LIQUIDO") */
  local?: string | null;
  /** horas do dia e diferença calculadas pelo próprio sistema de ponto, em minutos (Hr. Dia / Horas Dif.) */
  sisTrab?: number | null;
  sisDif?: number | null;
  /** campos de batida vazios no espelho ("00:00"): mostram que o intervalo era para ser batido */
  vazias?: number;
}

export interface FuncLido {
  name: string;
  matricula: string | null;
  posto: string | null;
  cargo: string | null;
  /** empresa/filial (nome e CNPJ do cabeçalho do espelho) */
  empresa?: string | null;
  cnpj?: string | null;
  days: DiaLido[];
}

export interface Lido {
  funcionarios: FuncLido[];
  periodo: { from: string; to: string } | null;
  formato: string;
  avisos: string[];
}

export type Situacao =
  | 'incompleta'
  | 'sem_registro'
  | 'falta'
  | 'atraso'
  | 'saida_antecipada'
  | 'extra'
  | 'excesso'
  | 'intervalo_curto'
  | 'sem_intervalo'
  | 'interjornada'
  | 'dia_folga'
  | 'justificada'
  | 'repetida';

export const SITUACAO: Record<Situacao, { label: string; short: string; nivel: 'alta' | 'media' | 'baixa'; desc: string }> = {
  incompleta: { label: 'Parcialmente sem registro', short: 'Parcial', nivel: 'alta', desc: 'O dia tem batidas, mas faltou registrar a entrada, a saída ou um retorno.' },
  sem_registro: { label: 'Sem registro', short: 'Sem registro', nivel: 'alta', desc: 'Dia de trabalho pela escala do funcionário (não é folga), sem nenhuma batida e sem justificativa.' },
  falta: { label: 'Falta', short: 'Falta', nivel: 'alta', desc: 'O espelho marca falta no dia.' },
  interjornada: { label: 'Descanso entre jornadas abaixo de 11h', short: 'Interjornada', nivel: 'alta', desc: 'Menos de 11 horas entre o fim de uma jornada e o início da seguinte (CLT art. 66).' },
  excesso: { label: 'Jornada acima do limite', short: 'Acima do limite', nivel: 'alta', desc: 'Jornada maior que o limite legal da escala (10h na diária; 12h no plantão 12x36).' },
  atraso: { label: 'Atraso', short: 'Atraso', nivel: 'media', desc: 'Entrada depois do horário, além da tolerância.' },
  saida_antecipada: { label: 'Saída antecipada', short: 'Saída cedo', nivel: 'media', desc: 'Saída antes do horário, além da tolerância.' },
  intervalo_curto: { label: 'Intervalo menor que 1h', short: 'Intervalo curto', nivel: 'media', desc: 'Jornada acima de 6h com intervalo menor que o mínimo (CLT art. 71).' },
  sem_intervalo: { label: 'Intervalo sem registro', short: 'Sem intervalo', nivel: 'media', desc: 'Jornada acima de 6h sem a batida do intervalo (o espelho mostra só entrada e saída, ou 00:00 no intervalo).' },
  dia_folga: { label: 'Trabalhou na folga', short: 'Na folga', nivel: 'media', desc: 'Batidas em dia de folga pela escala 12x36 (dobra ou troca de plantão).' },
  justificada: { label: 'Ausência justificada', short: 'Justificada', nivel: 'baixa', desc: 'Dia de trabalho sem batida, com falta justificada, atestado, abono ou afastamento no espelho.' },
  extra: { label: 'Hora extra', short: 'Extra', nivel: 'baixa', desc: 'Trabalhou além da jornada prevista, acima da tolerância.' },
  repetida: { label: 'Batida repetida', short: 'Repetida', nivel: 'baixa', desc: 'Duas batidas iguais (diferença de até 3 minutos); a repetida foi desconsiderada.' },
};

export const ORDEM: Situacao[] = ['incompleta', 'sem_registro', 'falta', 'interjornada', 'excesso', 'atraso', 'saida_antecipada', 'intervalo_curto', 'sem_intervalo', 'dia_folga', 'extra', 'justificada', 'repetida'];

export interface Ocorrencia {
  tipo: Situacao;
  /** minutos (atraso, extra, interjornada…), quando faz sentido */
  min: number | null;
  texto: string;
}

export interface DiaAnalisado {
  date: string;
  weekday: number; // 0 = domingo
  punches: string[];
  marks: string[];
  /** dia de trabalho pela escala */
  previsto: boolean;
  /** minutos trabalhados (pares de batidas) */
  trabalhado: number;
  intervalo: number | null;
  inicio: string | null;
  fim: string | null;
  /** o plantão termina no dia seguinte */
  virada: boolean;
  /** cliente/posto do dia */
  local: string | null;
  /** jornada prevista do dia, em minutos (a do sistema de ponto, quando o espelho traz) */
  jornada: number | null;
  ocorrencias: Ocorrencia[];
}

export interface FuncAnalisado {
  name: string;
  matricula: string | null;
  /** cliente/posto principal (o dos dias trabalhados, ou o do cabeçalho) */
  posto: string | null;
  /** todos os clientes/postos em que trabalhou no período */
  postos: string[];
  cargo: string | null;
  filial: string | null;
  escala: '12x36' | 'diaria';
  /** jornada diária típica (a do sistema de ponto, quando o espelho traz), em minutos */
  jornadaTipica: number | null;
  habitual: { inicio: string | null; fim: string | null };
  dias: DiaAnalisado[];
  totais: {
    trabalhados: number;
    previstos: number;
    minutos: number;
    extras: number;
    atrasos: number;
    justificados: number;
    porTipo: Partial<Record<Situacao, number>>;
    ocorrencias: number;
    /** dias de trabalho sem nenhuma ocorrência ÷ dias avaliados */
    conformidade: number;
  };
  status: 'ok' | 'atencao' | 'critico';
}

export interface Filtros {
  de?: string;
  ate?: string;
  posto?: string;
  filial?: string;
  funcao?: string;
}

export interface Analise {
  periodo: { from: string; to: string };
  /** filtros aplicados (o período do arquivo continua em `periodo`) */
  filtros?: Filtros;
  config: PontoConfig;
  formato: string;
  arquivo: string;
  avisos: string[];
  /** dia a partir do qual as batidas parecem não ter sido importadas (para sugerir o corte) */
  corte?: string | null;
  funcionarios: FuncAnalisado[];
  resumo: {
    funcionarios: number;
    comOcorrencia: number;
    criticos: number;
    dias: number;
    ocorrencias: number;
    porTipo: Partial<Record<Situacao, number>>;
    conformidade: number;
    horas: number;
    extras: number;
    postos: { posto: string; funcionarios: number; ocorrencias: number }[];
  };
  geradoEm: string;
  geradoPor: string;
}

export const hhmm = (min: number | null | undefined) => {
  if (min === null || min === undefined || !Number.isFinite(min)) return '—';
  const neg = min < 0;
  const m = Math.abs(Math.round(min));
  return `${neg ? '-' : ''}${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
};
export const dataBR = (iso: string) => iso.split('-').reverse().join('/');
export const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** o que a Evelyn procura primeiro: dias sem registro e parcialmente sem registro, por funcionário */
export const REGISTRO: Situacao[] = ['sem_registro', 'incompleta', 'sem_intervalo'];
export function semRegistro(f: FuncAnalisado) {
  const dias = (t: Situacao) => f.dias.filter((d) => d.ocorrencias.some((o) => o.tipo === t)).map((d) => d.date);
  const sem = dias('sem_registro');
  const parcial = [...new Set([...dias('incompleta'), ...dias('sem_intervalo')])].sort();
  return { sem, parcial, total: sem.length + parcial.length };
}
