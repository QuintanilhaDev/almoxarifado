/**
 * Leitor do texto da resposta do almoxarifado.
 *
 * Recebe o texto que o colaborador escreveu ("Enviamos 2 camisas M/C Max Serviços
 * tamanho 7 e 1 par de botina 42, mas não temos o coturno 40...") e o catálogo do
 * estoque, e devolve a lista de itens que realmente SAÍRAM, com quantidade,
 * tamanho e um nível de confiança.
 *
 * Regra de ouro: na dúvida, NÃO marca. Tudo que não for certo vira uma linha
 * para a pessoa conferir antes de dar baixa.
 *
 * Código puro (sem React, sem servidor) para poder rodar no navegador e nos testes.
 */

export interface CatalogRow {
  id: string;
  name: string;
  size: string | null;
  quantity: number;
}

export type Polarity = 'sent' | 'negated' | 'future' | 'info' | 'return';
export type Confidence = 'high' | 'medium' | 'low' | 'none';

export interface ParsedLine {
  key: string;
  /** trecho do texto de onde a linha saiu */
  source: string;
  qty: number;
  qtyAssumed: boolean;
  itemId: string | null;
  /** alternativas (ids de itens) para a pessoa escolher quando há dúvida */
  candidates: string[];
  confidence: Confidence;
  polarity: Polarity;
  /** sugestão: já vem marcada para dar baixa? */
  selected: boolean;
  warnings: string[];
}

export interface ParseOptions {
  /** textos do pedido original (ajudam a desempatar itens parecidos) */
  hints?: string[];
  /** nomes que NÃO são itens (posto, colaborador, supervisor...) */
  exclude?: string[];
}

export interface ParseResult {
  lines: ParsedLine[];
  notes: string[];
}

/* ------------------------------------------------------------------ */
/*  Normalização                                                       */
/* ------------------------------------------------------------------ */

export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

const NUMBER_WORDS: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9,
  dez: 10, onze: 11, doze: 12, treze: 13, catorze: 14, quatorze: 14, quinze: 15, dezesseis: 16,
  dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50,
  cem: 100,
};
const LETTER_SIZES = new Set(['p', 'pp', 'm', 'g', 'gg', 'xg', 'xgg', 'eg', 'egg', 'exg']);
const STOP = new Set([
  'de', 'da', 'do', 'das', 'dos', 'a', 'o', 'as', 'os', 'e', 'com', 'c', 'para', 'pra', 'pro', 'por', 'em',
  'no', 'na', 'nos', 'nas', 'ao', 'aos', 'ou', 'que', 'se', 'ja', 'tipo', 'modelo', 'cor', 'ate', 'uns', 'umas',
  'ser', 'sao', 'foi', 'foram', 'estao', 'esta', 'to', 'tb',
]);
const UNITS = new Set(['un', 'und', 'unid', 'unids', 'unidade', 'unidades', 'pc', 'pcs', 'pca', 'peca', 'pecas', 'par', 'pares', 'pr']);
const SIZE_MARKERS = new Set(['tam', 'tamanho', 'tamanhos', 'tm', 'numeracao', 'numero', 'num', 'nr']);
const QTY_MARKERS = new Set(['qtd', 'qtde', 'qt', 'quantidade', 'qtdade']);
const SYNONYM: Record<string, string> = {
  camiseta: 'camisa', camisete: 'camisa', conj: 'conjunto', aux: 'auxiliar', calcado: 'calcado',
  oculo: 'oculos', bone: 'bone', jaleco: 'jaleco', luvas: 'luva', botons: 'botton', button: 'botton',
  smartphone: 'smatphone', smatphone: 'smatphone', celular: 'celular',
};
const BRAND = new Set(['max', 'servico', 'forte', 'confiavel']);

/** Plural simples, igual dos dois lados (catálogo e texto). */
export function stem(w: string): string {
  if (w.length <= 3) return w;
  if (/[a-z]/.test(w) === false) return w;
  if (/\d/.test(w)) return w;
  let s = w;
  if (s.endsWith('oes') || s.endsWith('aes')) s = s.slice(0, -3) + 'ao';
  else if (s.endsWith('res') || s.endsWith('zes')) s = s.slice(0, -2);
  else if (s.endsWith('ns')) s = s.slice(0, -2) + 'm';
  else if (s.length >= 5 && /(ais|eis|uis)$/.test(s)) s = s.slice(0, -2) + 'l';
  else if (s.endsWith('ss')) s = s;
  else if (s.endsWith('s')) s = s.slice(0, -1);
  return SYNONYM[s] ?? s;
}

/** Texto já "dobrado": minúsculo, sem acento, com as abreviações do almoxarifado resolvidas. */
function prep(raw: string): string {
  let t = fold(raw).replace(/×/g, 'x');
  // datas, horários, valores, telefones, protocolos: números que NÃO são quantidade
  t = t.replace(/\b\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\b/g, ' ');
  t = t.replace(/\b(?:dia|em|ate|desde|data|prazo|previsao|prevista|partir de)\s+(?:o\s+dia\s+)?\d{1,2}\s*[\/-]\s*\d{1,2}\b/g, ' ');
  t = t.replace(/\bdia\s+\d{1,2}\b/g, ' ');
  t = t.replace(/\b\d{1,2}h\d{0,2}\b/g, ' ').replace(/\b\d{1,2}:\d{2}\b/g, ' ');
  t = t.replace(/\b\d+\s*(?:dias?|horas?|semanas?|meses|mes|minutos?|min)\b/g, ' ');
  t = t.replace(/r\$\s*[\d.,]+/g, ' ');
  t = t.replace(/\(?\b\d{2}\)?\s*9?\d{4}[- ]?\d{4}\b/g, ' ');
  t = t.replace(/\b\d{5,}\b/g, ' ');
  t = t.replace(/(?:solicitacao|solicitacoes|protocolo|chamado|ticket|requisicao)\s*(?:n\s*[º°o.]*\s*)?#?\s*\d+/g, ' ');
  t = t.replace(/#\s*\d+/g, ' ');
  // "2 dos 5 solicitados"
  t = t.replace(/\b(?:de|das|dos|do|da)\s+(?:um\s+total\s+de\s+)?\d+\s+(?:solicitad\w*|pedid\w*|requisitad\w*|combinad\w*)/g, ' ');
  t = t.replace(/\b\d+\s+(?:solicitad\w*|pedid\w*|requisitad\w*)/g, ' ');
  t = t.replace(/\b(?:malote|nf|nfe|nota fiscal|rastreio|rastreamento|lacre|volume|remessa|lote|ordem|doc|documento|codigo|cod|referencia|ref|sedex|envelope)\s*(?:n\s*[º°o.]*\s*)?#?\s*[a-z0-9-]*\d[a-z0-9-]*/g, ' ');
  // número do calçado: "nº 42", "n° 42"
  t = t.replace(/\bn\s*[º°]\s*(?=\d)/g, ' tam ').replace(/\bn[º°]\s*/g, ' tam ');
  // "c/" e "p/" (com / ou \) viram nada; "m/c" e "m/l" viram manga curta/longa
  t = t.replace(/\b([cp])\s*[\/\\]/g, ' ');
  t = t.replace(/\bm\s*[\/\\.]\s*c\b\.?/g, ' mc ').replace(/\bm\s*[\/\\.]\s*l\b\.?/g, ' ml ');
  t = t.replace(/\bmangas?\s+curtas?\b/g, ' mc ').replace(/\bmangas?\s+longas?\b/g, ' ml ');
  t = t.replace(/\bmeia\s+duzia\b/g, ' 6 ').replace(/\b(\d+)\s+duzias?\b/g, (_m, n: string) => ` ${Number(n) * 12} `);
  t = t.replace(/\b(?:uma\s+)?duzia\b/g, ' 12 ');
  // medidas coladas: 500 ml, 5 L, 200 mm
  t = t.replace(/(\d)\s*(?:ml|mililitros?)\b/g, '$1ml');
  t = t.replace(/(\d)\s*mm\b/g, '$1mm');
  t = t.replace(/(\d)\s*(?:l|lt|lts|litros?)\b/g, '$1l');
  t = t.replace(/(\d)\s*(?:cm)\b/g, '$1cm');
  t = t.replace(/(\d+)[.,](\d{1,2})\s*(?:mts?|metros?|m)?(?![a-z0-9])/g, (_m, a: string, b: string) => ` ${a}.${b.padEnd(2, '0')} `);
  t = t.replace(/(\d+)\s*(?:mts?|metros?)(?![a-z0-9])/g, (_m, a: string) => ` ${a}.00 `);
  // frações: 3/4, 1\4
  t = t.replace(/(\d)\s*[\/\\]\s*(\d)/g, '$1f$2');
  // 2x / x2
  t = t.replace(/(\d)\s*x(?![a-z0-9])/g, '$1 x ').replace(/(^|[^a-z])x\s*(\d)/g, '$1 x $2');
  // ESP 1 / especial
  t = t.replace(/\besp(?:ecial)?\s*(\d)/g, ' esp$1 ').replace(/\bespecial\b/g, ' esp ');
  t = t.replace(/\bextra\s+grande\b/g, ' xg ').replace(/\bextra\s+extra\s+grande\b/g, ' xgg ');
  t = t.replace(/\btamanho\s+(pequeno|medio|grande)\b/g, (_m, w: string) => ` tam ${w === 'pequeno' ? 'p' : w === 'medio' ? 'm' : 'g'} `);
  t = t.replace(/(?<!\d)\.|\.(?!\d)/g, ' ');
  t = t.replace(/[^a-z0-9.]+/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  // "2 de 3 apitos" / "2 dos 3 que pediu": o segundo número é o total pedido
  t = t.replace(/\b(\d+) (?:de|do|dos|da|das) (\d+) (?!e\b|ou\b|para\b|pra\b|no\b|na\b|tam\b|x\b)(?=[a-z])/g, '$1 ');
  return t;
}

type Kind = 'num' | 'numw' | 'size' | 'word' | 'unit' | 'tam' | 'x' | 'qtdw';
interface Tok {
  s: string; // texto final (stem para palavras)
  raw: string;
  kind: Kind;
  val?: number;
}

function classify(raw: string): Tok | null {
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return { s: raw, raw, kind: 'num', val: Number(raw) };
  if (raw in NUMBER_WORDS) return { s: raw, raw, kind: 'numw', val: NUMBER_WORDS[raw] };
  if (STOP.has(raw)) return null;
  if (raw === 'x') return { s: 'x', raw, kind: 'x' };
  if (SIZE_MARKERS.has(raw)) return { s: 'tam', raw, kind: 'tam' };
  if (QTY_MARKERS.has(raw)) return { s: 'qtd', raw, kind: 'qtdw' };
  if (UNITS.has(raw)) return { s: 'un', raw, kind: 'unit' };
  if (LETTER_SIZES.has(raw) || /^esp\d*$/.test(raw)) return { s: raw, raw, kind: 'size' };
  if (raw === 'unico' || raw === 'unica') return { s: 'unico', raw, kind: 'size' };
  const st = stem(raw);
  if (UNITS.has(st)) return { s: 'un', raw, kind: 'unit' };
  return { s: st, raw, kind: 'word' };
}

function tokenize(raw: string): Tok[] {
  const out: Tok[] = [];
  for (const piece of prep(raw).split(' ')) {
    const t = classify(piece);
    if (t) out.push(t);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Índice do catálogo                                                 */
/* ------------------------------------------------------------------ */

interface Group {
  key: string;
  name: string;
  rows: CatalogRow[];
  tokens: Set<string>; // tokens do nome (palavras + números)
}

export interface CatalogIndex {
  groups: Group[];
  byId: Map<string, CatalogRow>;
  groupOf: Map<string, Group>;
  df: Map<string, number>;
  vocab: string[];
  vocabSet: Set<string>;
  rowSize: Map<string, string>;
  w(t: string): number;
}

function nameTokens(name: string): Set<string> {
  const set = new Set<string>();
  for (const t of tokenize(name)) {
    if (t.kind === 'tam' || t.kind === 'x' || t.kind === 'unit' || t.kind === 'qtdw') continue;
    set.add(t.s);
  }
  return set;
}

export function normSize(s: string | null | undefined): string {
  const v = fold(s ?? '').replace(/\s+/g, '');
  if (v === '-' || v === '') return '';
  if (v === 'unico' || v === 'u' || v === 'unica') return 'unico';
  return v;
}

export function buildIndex(catalog: CatalogRow[]): CatalogIndex {
  const groups = new Map<string, Group>();
  const byId = new Map<string, CatalogRow>();
  const groupOf = new Map<string, Group>();
  const rowSize = new Map<string, string>();
  for (const r of catalog) {
    byId.set(r.id, r);
    rowSize.set(r.id, normSize(r.size));
    const key = fold(r.name).replace(/\s+/g, ' ').trim();
    let g = groups.get(key);
    if (!g) {
      g = { key, name: r.name, rows: [], tokens: nameTokens(r.name) };
      groups.set(key, g);
    }
    g.rows.push(r);
    groupOf.set(r.id, g);
  }
  const list = [...groups.values()];
  let df = new Map<string, number>();
  for (const g of list) for (const t of g.tokens) df.set(t, (df.get(t) ?? 0) + 1);
  // erros de digitação no próprio cadastro ("Ferminino", "Marron"): usa a grafia mais comum
  const alias = new Map<string, string>();
  for (const [t, n] of df) {
    if (n !== 1 || t.length < 6 || /\d/.test(t) || isAmb(t)) continue;
    let best: string | null = null;
    let bestN = 1;
    for (const [u, m] of df) {
      if (u === t || m < 2 || u.length < 6 || /\d/.test(u) || t.slice(0, 2) !== u.slice(0, 2)) continue;
      if (editDistance(t, u, 1) <= 1 && m > bestN) {
        best = u;
        bestN = m;
      }
    }
    if (best) alias.set(t, best);
  }
  if (alias.size) {
    for (const g of list) {
      const next = new Set<string>();
      for (const t of g.tokens) next.add(alias.get(t) ?? t);
      g.tokens = next;
    }
    df = new Map();
    for (const g of list) for (const t of g.tokens) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const N = Math.max(1, list.length);
  const vocabSet = new Set<string>();
  for (const [t] of df) {
    if (/^\d+$/.test(t) || t in NUMBER_WORDS || LETTER_SIZES.has(t) || /^esp\d*$/.test(t)) continue;
    vocabSet.add(t);
  }
  return {
    groups: list,
    byId,
    groupOf,
    df,
    vocab: [...vocabSet],
    vocabSet,
    rowSize,
    w: (t: string) => Math.log(1 + N / (df.get(t) ?? 1)),
  };
}

function isAmb(t: string): boolean {
  return /^\d+$/.test(t) || t in NUMBER_WORDS || LETTER_SIZES.has(t) || /^esp\d*$/.test(t);
}

/** Distância de edição (inserção, remoção, troca e troca de letras vizinhas). */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const dp: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    dp[i] = [i];
  }
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
      }
    }
  }
  return dp[a.length][b.length];
}

/** Corrige erros de digitação trocando a palavra pela única palavra parecida do catálogo. */
function fixTypos(toks: Tok[], idx: CatalogIndex): Tok[] {
  return toks.map((t) => {
    if (t.kind !== 'word' || idx.vocabSet.has(t.s) || t.s.length < 5 || /\d/.test(t.s)) return t;
    const max = t.s.length >= 9 ? 2 : 1;
    let best: string | null = null;
    let bestD = max + 1;
    let tie = false;
    for (const v of idx.vocab) {
      if (v.length < 4) continue;
      const d = editDistance(t.s, v, max);
      if (d < bestD) {
        bestD = d;
        best = v;
        tie = false;
      } else if (d === bestD && d <= max) tie = true;
    }
    if (best && !tie && bestD <= max) return { ...t, s: best };
    return t;
  });
}

/* ------------------------------------------------------------------ */
/*  Verbos e sinais (enviado / não enviado / futuro ...)               */
/* ------------------------------------------------------------------ */

const RE_NEG = /\b(nao|sem|exceto|menos|salvo|tirando|excecao|cancel\w*|desconsider\w*|ignor\w*|dispens\w*|nenhum[a]?|falt\w*|indisponiv\w*|esgotad\w*|acab(?:ou|aram|ando)|zerad\w*|nunca|impossivel|negad\w*|cancelad\w*|dispensad\w*|pendente|pendentes|pendencia)\b/;
const RE_FUT = /\b(enviarei|enviaremos|enviara|enviarao|vamos enviar|vou enviar|iremos enviar|irei enviar|separaremos|separarei|entregaremos|entregarei|providenciar\w*|providenciaremos|serao|sera|amanha|depois|futuramente|em breve|proxim\w*|previs\w*|assim que|quando chegar|chegara|chegarao|chegando|a caminho|a enviar|a ser|aguard\w*|reposicao|repor|solicitar|solicitaremos|pediremos|comprar|compra|encomend\w*|ficara|ficarao|disponibilizaremos)\b/;
const RE_INFO = /\b(total|ao todo|somando|temos|possuimos|dispomos|tenho|ha|restam|restou|resta|sobram|sobraram|sobrou|ficaram|ficou|saldo|em estoque|no estoque|disponivel|disponiveis|solicitou|solicitad\w*|pediu|pedid\w*|requisit\w*)\b/;
const RE_RET = /\b(de volta|recebemos|recebi|recebid\w*|recebeu|devolv\w*|devolucao|retornad\w*|retornou|retornamos|retornaram|estorn\w*)\b/;
const RE_COND = /(\bcaso\b|^\s*se\b|\b(seria|seriam|poderia|poderiam|deveria|pode|podem|podemos|posso|gostaria|gostariam|precisa|precisam|precisar|precise|precisaria|queira|quiser|quer|quero|deseja|desejar|desejam|talvez|possivel|possivelmente)\b)/;
const RE_SPLITWORDS = /\b(cada|sendo|respectivamente|divid\w+|distribu\w+|entre)\b/;
const RE_EXCH = /\b(troc\w*|substitu\w*)\b/;
const RE_SENT = /\b(enviamos|enviei|enviou|enviaram|enviado|enviada|enviados|enviadas|enviando|envio|separamos|separei|separou|separaram|separado|separada|separados|separadas|despach\w+|entregamos|entreguei|entregou|entregaram|entregue|entregues|entregues|remet\w+|mandamos|mandei|mandou|mandaram|mandado|mandados|segue|seguem|seguindo|saiu|sairam|transferi\w+|liberamos|liberei|liberou|liberado|liberados|liberada|liberadas|retiramos|retirei|retirad\w+|incluimos|incluso\w*|encaminh\w+|disponibilizamos|disponibilizei|atendemos|atendi|atendid\w+)\b/;
const RE_CONJ = /^(mas|porem|contudo|entretanto|todavia|no entanto|apenas|somente|so)\b/;
const RE_CUE_WORD = /^(envi|separ|despach|entreg|remet|mand|transfer|liber|segu|sair|saiu|retir|inclu|encaminh|disponibiliz|atend|foram|foi|sera|serao|nao|sem|falt)/;

const CUE_WORDS = [
  // falta / negação
  'falta', 'faltou', 'faltam', 'faltaram', 'faltando', 'faltante', 'indisponivel', 'indisponiveis', 'esgotado', 'esgotada', 'esgotados',
  'acabou', 'acabaram', 'zerado', 'zerados', 'impossivel', 'negado', 'cancelado', 'cancelamos', 'cancelar', 'desconsiderar', 'desconsidere',
  'ignorar', 'dispensado', 'pendente', 'pendentes', 'pendencia', 'exceto', 'salvo', 'tirando', 'excecao', 'nenhum', 'nenhuma',
  // futuro
  'enviarei', 'enviaremos', 'enviara', 'enviarao', 'separaremos', 'separarei', 'entregaremos', 'entregarei', 'providenciar', 'providenciaremos',
  'amanha', 'futuramente', 'proxima', 'proximo', 'proximos', 'previsao', 'prevista', 'chegara', 'chegarao', 'chegando', 'aguardando',
  'aguardamos', 'aguarde', 'reposicao', 'solicitar', 'solicitaremos', 'pediremos', 'comprar', 'encomenda', 'encomendado', 'ficara', 'ficarao',
  'disponibilizaremos',
  // informação
  'restam', 'restou', 'resta', 'sobram', 'sobraram', 'sobrou', 'ficaram', 'ficou', 'saldo', 'estoque', 'disponivel', 'disponiveis', 'solicitou',
  'solicitado', 'solicitados', 'pediu', 'pedido', 'pedidos', 'requisitado', 'total', 'somando', 'temos', 'possuimos', 'dispomos',
  // devolução / troca
  'devolvemos', 'devolveram', 'devolucao', 'devolvido', 'retornado', 'retornou', 'retornamos', 'retornaram', 'estornamos', 'estorno', 'estornado',
  'recebemos', 'recebido', 'recebeu', 'trocamos', 'troca', 'trocado', 'substituimos', 'substituicao',
  // condicional
  'seria', 'seriam', 'poderia', 'poderiam', 'deveria', 'podemos', 'gostaria', 'gostariam', 'precisa', 'precisam', 'precisar', 'precise',
  'precisaria', 'queira', 'quiser', 'deseja', 'desejar', 'desejam', 'talvez', 'possivel', 'possivelmente',
];
const CUE_SET = new Set(CUE_WORDS);

/** Corrige erros de digitação nas palavras que mudam o sentido ("Faltou", "Previsão", "Restam"...). */
function cueFix(t: string, idx: CatalogIndex): string {
  return t
    .split(' ')
    .map((w) => {
      if (w.length < 5 || CUE_SET.has(w) || idx.vocabSet.has(w) || /\d/.test(w) || RE_SENT.test(` ${w} `)) return w;
      const max = 1;
      let best: string | null = null;
      let bestD = max + 1;
      let tie = false;
      for (const c of CUE_WORDS) {
        const d = editDistance(w, c, max);
        if (d < bestD) {
          bestD = d;
          best = c;
          tie = false;
        } else if (d === bestD && d <= max && c !== best) tie = true;
      }
      return best && bestD <= max && !tie ? best : w;
    })
    .join(' ');
}

const FILLER = new Set([
  'ola', 'oi', 'bom', 'boa', 'dia', 'tarde', 'noite', 'tudo', 'bem', 'hoje', 'ontem', 'agora', 'abaixo', 'acima', 'seguem', 'segue', 'seguinte',
  'seguintes', 'anexo', 'conforme', 'favor', 'obrigado', 'obrigada', 'abraco', 'abracos', 'att', 'atenciosamente', 'equipe', 'almoxarifado',
  'posto', 'colaborador', 'colaboradora', 'funcionario', 'funcionaria', 'itens', 'item', 'produto', 'produtos', 'material', 'materiais',
  'unidade', 'unidades', 'pecas', 'peca', 'pelo', 'pela', 'pelos', 'pelas', 'nosso', 'nossa', 'aqui', 'tambem', 'ainda', 'todos', 'todas', 'todo',
  'toda', 'mesmo', 'mesma', 'sobre', 'junto', 'juntos', 'apenas', 'somente', 'outro', 'outra', 'demais', 'restante', 'resto', 'estao', 'esta',
  'estava', 'estavam', 'quando', 'entao', 'assim', 'porem', 'entretanto', 'contudo', 'isso', 'esse', 'essa', 'esses', 'essas', 'este', 'esta',
  'estes', 'estas', 'cada', 'sendo', 'qual', 'quais', 'como', 'onde', 'tambem', 'solicitacao', 'protocolo', 'pedido', 'malote', 'correio',
  'voce', 'voces', 'eram', 'era', 'estamos', 'estou', 'quem', 'motoboy', 'transportadora', 'entrega', 'envio', 'remessa', 'lista', 'abaixo', 'confirmar', 'confirme', 'recebimento', 'dispon',
]);
const VERBISH = /^(envi|separ|despach|entreg|remet|mand|transfer|liber|segu|sair|saiu|retir|inclu|encaminh|disponibiliz|atend|forn|prepar|embal|result|receb|devolv|troc|estorn|falt|fic|rest|sobr|tem|temos|hav|ser|foi|foram|pod|prec|quer|dese|solicit|ped)/;

/** Palavras do trecho que não são item, nem verbo/cumprimento conhecido (podem esconder um item que não existe no cadastro). */
function unknownWords(toks: Tok[], idx: CatalogIndex): string[] {
  const out: string[] = [];
  for (const t of toks) {
    if (t.kind !== 'word' || t.raw.length < 4) continue;
    if (idx.vocabSet.has(t.s) || CUE_SET.has(t.raw) || FILLER.has(t.raw) || VERBISH.test(t.raw) || RE_SENT.test(` ${t.raw} `)) continue;
    if (/\d/.test(t.raw)) continue;
    out.push(t.raw);
  }
  return [...new Set(out)];
}

function polarityOf(text: string): { own: Polarity | null; sent: boolean } {
  const t = ' ' + text + ' ';
  const sent = RE_SENT.test(t);
  if (RE_EXCH.test(t)) return { own: 'return', sent };
  if (RE_RET.test(t)) return { own: 'return', sent };
  if (RE_NEG.test(t)) return { own: 'negated', sent };
  if (RE_FUT.test(t)) return { own: 'future', sent };
  if (RE_COND.test(t)) return { own: 'info', sent };
  if (RE_INFO.test(t) && !sent) return { own: 'info', sent };
  if (sent) return { own: 'sent', sent };
  return { own: null, sent };
}

/* ------------------------------------------------------------------ */
/*  Quebra do texto em trechos                                         */
/* ------------------------------------------------------------------ */

/** Remove citação da mensagem original e rodapé de assinatura. */
export function cleanReply(text: string): { text: string; cut: boolean } {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let cut = false;
  for (const line of lines) {
    const f = fold(line).trim();
    if (/^>/.test(f)) {
      cut = true;
      continue;
    }
    if (
      /^(em .{5,100} escreveu:?$|on .{5,100} wrote:?$|-{2,}\s*(mensagem original|original message|mensagem encaminhada)|_{5,}$|de:\s.+|from:\s.+|enviado em:|sent:|assunto:|subject:)/.test(f)
    ) {
      cut = true;
      break;
    }
    if (/^(atenciosamente|att\.?|abracos?|cordialmente|grato|grata|obrigado|obrigada|um abraco|abs|at\.te|equipe\b.*|almoxarifado\b.*)[,.!\s]*$/.test(f) && f.split(' ').length <= 4) {
      cut = true;
      break;
    }
    out.push(line);
  }
  return { text: out.join('\n'), cut };
}

const ABBREV = new Set(['tam', 'un', 'und', 'unid', 'pc', 'pcs', 'qtd', 'qtde', 'nr', 'num', 'sr', 'sra', 'dr', 'dra', 'ex', 'obs', 'ref', 'aprox', 'cx', 'pct', 'n', 'no', 'c', 'p', 'conj', 'aux', 'etc']);

function splitClauses(line: string): { text: string; q: boolean }[] {
  // separa frases por . ! ? seguidos de espaço+maiúscula/número (não quebra "2.5", "tam. 7" nem "c/ fiel.")
  const out: { text: string; q: boolean }[] = [];
  let start = 0;
  const re = /[.!?]+(?=\s+[A-ZÀ-Ý0-9"“(]|\s*$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    const before = line.slice(start, m.index);
    const lastWord = (before.match(/([A-Za-zÀ-ÿ]+)\s*$/)?.[1] ?? '').toLowerCase();
    if (m[0] === '.' && ABBREV.has(fold(lastWord)) && m.index + 1 < line.length) continue;
    out.push({ text: before, q: m[0].includes('?') });
    start = m.index + m[0].length;
  }
  out.push({ text: line.slice(start), q: /\?\s*$/.test(line) });
  return out.map((x) => ({ text: x.text.trim(), q: x.q })).filter((x) => x.text);
}

const PIECE_SPLIT =
  /\s*(?:;|\s\/\s|\s\|\s|\+|&|(?:(?<!\d),|,(?!\d))|\s+e\s+|\s+mais\s+|\s+al[eé]m\s+d[aeo]s?\s+|\s+(?=(?:mas|por[eé]m|contudo|entretanto|todavia|no entanto)\s))\s*/i;

function stripBullet(line: string): string {
  return line
    .replace(/^\s*(?:[-–—•*·▪●○□■☐☑✔✓>]+\s*)+/, '')
    .replace(/^\s*\d{1,2}\s*[.)]\s+/, '')
    .replace(/^\s*\d{1,2}\s*[-–—]\s+(?=\D)/, '')
    .trim();
}

/* ------------------------------------------------------------------ */
/*  Casamento de itens                                                 */
/* ------------------------------------------------------------------ */

interface GroupHit {
  g: Group;
  recall: number;
  miss: number;
  score: number;
  consumed: Set<number>; // posições dos tokens numéricos consumidos pelo nome
  matchedWords: number;
  nonBrandMatched: boolean;
}

function isLeadQty(toks: Tok[], i: number, idx: CatalogIndex): boolean {
  // nenhum nome de item nem número antes
  for (let k = 0; k < i; k++) {
    const t = toks[k];
    if (t.kind === 'num' || t.kind === 'numw' || t.kind === 'size') return false;
    if (t.kind === 'word' && idx.vocabSet.has(t.s)) return false;
    if (t.kind === 'tam' || t.kind === 'x' || t.kind === 'qtdw') return false;
  }
  const next = toks[i + 1];
  if (!next) return false;
  return next.kind !== 'num' && next.kind !== 'numw' && next.kind !== 'tam';
}

type Role = 'qty' | 'size' | 'unk' | null;

function assignRoles(toks: Tok[], idx: CatalogIndex): Role[] {
  const roles: Role[] = toks.map(() => null);
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.kind !== 'num' && t.kind !== 'numw') continue;
    const prev = toks[i - 1];
    const next = toks[i + 1];
    if (prev && prev.kind === 'tam') roles[i] = 'size';
    else if (prev && (prev.kind === 'x' || prev.kind === 'qtdw')) roles[i] = 'qty';
    else if (next && next.kind === 'x' && !(toks[i + 2] && (toks[i + 2].kind === 'num' || toks[i + 2].kind === 'numw'))) roles[i] = 'qty';
    else if (next && next.kind === 'unit') roles[i] = 'qty';
    else if (isLeadQty(toks, i, idx)) roles[i] = 'qty';
    else roles[i] = 'unk';
  }
  return roles;
}

function scoreGroups(toks: Tok[], roles: Role[], idx: CatalogIndex): GroupHit[] {
  // tokens "palavra" do texto que existem no vocabulário do catálogo
  const textWords: string[] = [];
  const ambPos = new Map<string, number[]>();
  toks.forEach((t, i) => {
    if (t.kind === 'word' && idx.vocabSet.has(t.s)) textWords.push(t.s);
    if (t.kind === 'word' && /^[a-z]+\d|\d[a-z]/.test(t.s) && idx.df.has(t.s)) textWords.push(t.s);
    if (
      (t.kind === 'num' || t.kind === 'numw' || t.kind === 'size') &&
      roles[i] !== 'qty' &&
      roles[i] !== 'size'
    ) {
      const a = ambPos.get(t.s) ?? [];
      a.push(i);
      ambPos.set(t.s, a);
    }
  });
  const words = [...new Set(textWords)];
  if (words.length === 0) return [];
  const textW = words.reduce((s, x) => s + idx.w(x), 0);
  const hits: GroupHit[] = [];
  for (const g of idx.groups) {
    let matched = 0;
    let total = 0;
    let matchedWords = 0;
    let nonBrand = false;
    const consumed = new Set<number>();
    for (const n of g.tokens) {
      const w = idx.w(n);
      total += w;
      if (isAmb(n)) {
        const pos = ambPos.get(n);
        if (pos) {
          matched += w;
          pos.forEach((p) => consumed.add(p));
        }
      } else if (words.includes(n)) {
        matched += w;
        matchedWords++;
        if (!BRAND.has(n)) nonBrand = true;
      }
    }
    if (matchedWords === 0) continue;
    let missW = 0;
    for (const x of words) if (!g.tokens.has(x)) missW += idx.w(x);
    const recall = total ? matched / total : 0;
    const miss = textW ? missW / textW : 0;
    hits.push({ g, recall, miss, score: recall - 0.7 * miss, consumed, matchedWords, nonBrandMatched: nonBrand });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits;
}

const SIZE_SYNONYM: Record<string, string> = { eg: 'xg', exg: 'xg', xg: 'xg' };

interface Pick {
  g: Group | null;
  confidence: Confidence;
  warnings: string[];
  candidatesGroups: Group[];
  hit?: GroupHit;
  viaHint?: boolean;
}

function pickGroup(hits: GroupHit[], boosted: Set<string>): Pick {
  const warnings: string[] = [];
  const cons = hits.filter((h) => h.miss === 0);
  if (cons.length > 0) {
    const full = cons.filter((h) => h.recall >= 0.999);
    let chosen: GroupHit | null = null;
    let confidence: Confidence = 'high';
    let pool = cons;
    // empate entre nomes completos: vence o que "gastou" um número que está no texto (ex.: "Algema de dobradiça 2")
    let fullPool = full;
    let byNumber = false;
    if (full.length > 1) {
      const max = Math.max(...full.map((h) => h.consumed.size));
      const top = full.filter((h) => h.consumed.size === max);
      if (top.length === 1 && max > 0) {
        fullPool = top;
        byNumber = true;
      }
    }
    if (fullPool.length === 1) {
      chosen = fullPool[0];
      const others = cons.filter((h) => h !== chosen);
      const strong = others.filter((h) => h.recall >= 0.85);
      if (strong.length && !byNumber) {
        confidence = 'medium';
        warnings.push(`Também existe "${strong[0].g.name}" com nome parecido.`);
      }
    } else if (full.length === 0 && cons.length === 1) {
      chosen = cons[0];
      if (!chosen.nonBrandMatched) confidence = 'medium';
    } else {
      pool = full.length > 1 ? full : cons;
    }
    if (!chosen) {
      // várias possibilidades: o pedido original pode desempatar
      const b = pool.filter((h) => boosted.has(h.g.key));
      if (b.length === 1 && pool.length > 1) {
        chosen = b[0];
        confidence = 'medium';
        warnings.push('Escolhi pelo item que foi pedido na solicitação. Confira.');
        return { g: chosen.g, confidence, warnings, candidatesGroups: pool.map((h) => h.g), hit: chosen, viaHint: true };
      }
      return { g: null, confidence: 'none', warnings, candidatesGroups: pool.slice(0, 12).map((h) => h.g) };
    }
    return { g: chosen.g, confidence, warnings, candidatesGroups: [chosen.g], hit: chosen };
  }
  // nenhum nome bate 100%: aceita o mais parecido só se for bem claro
  const near = hits.filter((h) => h.score >= 0.35 && h.miss <= 0.34);
  if (near.length > 0) {
    const [a, b] = near;
    if (!b || a.score - b.score >= 0.2) {
      return {
        g: a.g,
        confidence: 'medium',
        warnings: ['O nome escrito é diferente do cadastro. Confira se é este item.'],
        candidatesGroups: near.slice(0, 5).map((h) => h.g),
        hit: a,
      };
    }
    return { g: null, confidence: 'none', warnings, candidatesGroups: near.slice(0, 8).map((h) => h.g) };
  }
  return { g: null, confidence: 'none', warnings, candidatesGroups: hits.slice(0, 5).map((h) => h.g) };
}

interface Resolved {
  qty: number;
  qtyAssumed: boolean;
  itemId: string | null;
  candidateIds: string[];
  confidence: Confidence;
  warnings: string[];
  sizeFromText: boolean;
}

function sizeOfTok(t: Tok): string | null {
  if (t.kind === 'size') return t.s;
  if (t.kind === 'num') return t.s;
  if (t.kind === 'numw') return String(t.val);
  return null;
}

function resolveInGroup(g: Group, toks: Tok[], roles: Role[], consumed: Set<number>, idx: CatalogIndex, base: Confidence, sameSizeAs?: string | null): Resolved {
  const warnings: string[] = [];
  let confidence = base;
  const rowsSizes = g.rows.map((r) => idx.rowSize.get(r.id) ?? '');
  const numericSizes = new Set(rowsSizes.filter((s) => /^\d+$/.test(s)));
  const allSizes = new Set(rowsSizes);

  const qtyVals: number[] = [];
  const sizeVals: string[] = [];
  const unk: { i: number; v: number }[] = [];
  toks.forEach((t, i) => {
    if (consumed.has(i)) return;
    const r = roles[i];
    if ((t.kind === 'num' || t.kind === 'numw') && r === 'qty') qtyVals.push(t.val as number);
    else if ((t.kind === 'num' || t.kind === 'numw') && r === 'size') sizeVals.push(String(t.val));
    else if (t.kind === 'size') sizeVals.push(t.s);
    else if ((t.kind === 'num' || t.kind === 'numw') && r === 'unk') unk.push({ i, v: t.val as number });
  });

  let qty: number | null = qtyVals.length ? qtyVals[0] : null;
  if (qtyVals.length > 1 && new Set(qtyVals).size > 1) {
    warnings.push('Há mais de uma quantidade no trecho. Confira.');
    confidence = downgrade(confidence);
  }
  let orderGuess = false;
  const wantsNumeric = numericSizes.size > 0;
  if (unk.length) {
    if (qty === null) {
      if (unk.length === 1) {
        const v = unk[0].v;
        if (wantsNumeric && numericSizes.has(String(v)) && sizeVals.length === 0) sizeVals.push(String(v));
        else qty = v;
      } else {
        const sizeIdx = unk.findIndex((u) => numericSizes.has(String(u.v)));
        if (sizeIdx >= 0 && sizeVals.length === 0) {
          sizeVals.push(String(unk[sizeIdx].v));
          const rest = unk.filter((_u, k) => k !== sizeIdx);
          qty = rest[rest.length === 1 ? 0 : rest.length - 1].v;
          if (unk.every((u) => numericSizes.has(String(u.v)))) orderGuess = true;
        } else {
          qty = unk[0].v;
          warnings.push('Há números que não consegui identificar. Confira.');
          confidence = downgrade(confidence);
        }
      }
    } else {
      for (const u of unk) {
        if (wantsNumeric && numericSizes.has(String(u.v)) && sizeVals.length === 0) sizeVals.push(String(u.v));
        else {
          warnings.push(`Não entendi o número ${u.v}. Confira.`);
          confidence = downgrade(confidence);
        }
      }
    }
  }
  if (orderGuess) {
    warnings.push('Dois números parecem tamanho: considerei o primeiro como tamanho e o segundo como quantidade.');
    confidence = downgrade(confidence);
  }

  let qtyAssumed = false;
  if (qty === null) {
    qty = 1;
    qtyAssumed = true;
    warnings.push('Não vi a quantidade no texto; considerei 1.');
  }
  if (qty < 1 || qty > 9999) {
    warnings.push('Quantidade fora do normal.');
    confidence = downgrade(downgrade(confidence));
    if (qty < 1) qty = 1;
    if (qty > 9999) qty = 9999;
  }

  // ---- escolhe a linha (tamanho) dentro do grupo
  const sizes = [...new Set(sizeVals)];
  let rows = g.rows;
  let itemId: string | null = null;
  let candidateIds = rows.map((r) => r.id);

  if (g.rows.length === 1) {
    itemId = g.rows[0].id;
    const only = rowsSizes[0];
    if (sizes.length && only !== 'unico' && only !== '' && !sizes.includes(only)) {
      warnings.push(`O tamanho ${sizes[0].toUpperCase()} não existe para este item (cadastrado: ${g.rows[0].size}).`);
      confidence = 'low';
    } else if (sizes.length && (only === 'unico' || only === '') && !sizes.every((s) => s === 'unico')) {
      // tamanho citado para item sem tamanho: ignora, mas avisa
      warnings.push(`Este item não tem tamanho cadastrado (o texto cita ${sizes[0].toUpperCase()}).`);
      confidence = downgrade(confidence);
    }
  } else if (sizes.length === 1 || sizes.length > 1) {
    const matches = (s: string) => rows.filter((r) => (idx.rowSize.get(r.id) ?? '') === s);
    let found: CatalogRow[] = [];
    for (const s of sizes) found = found.concat(matches(s));
    found = [...new Set(found)];
    if (found.length === 0) {
      // cadastro que agrupa tamanhos ("G,GG,XG"): aceita o tamanho como membro do grupo
      const member = rows.filter((r) => {
        const parts = (idx.rowSize.get(r.id) ?? '').split(/[,;/]/);
        return parts.length > 1 && sizes.some((s) => parts.includes(s));
      });
      if (member.length === 1) {
        found = member;
        warnings.push(`O cadastro agrupa os tamanhos ${member[0].size}. Confira.`);
        confidence = downgrade(confidence);
      }
    }
    if (found.length === 0) {
      // sinônimos (EG ≈ XG ≈ EXG)
      const syn = rows.filter((r) => {
        const rs = idx.rowSize.get(r.id) ?? '';
        return sizes.some((s) => SIZE_SYNONYM[s] && SIZE_SYNONYM[s] === SIZE_SYNONYM[rs]);
      });
      if (syn.length === 1) {
        found = syn;
        warnings.push(`Tamanho ${sizes[0].toUpperCase()} interpretado como ${syn[0].size}. Confira.`);
        confidence = downgrade(confidence);
      }
    }
    if (found.length === 1 && sizes.length === 1) {
      itemId = found[0].id;
    } else if (found.length >= 1 && sizes.length > 1) {
      warnings.push('Há mais de um tamanho no mesmo trecho. Escolha qual foi enviado.');
      candidateIds = found.map((r) => r.id);
      confidence = 'none';
    } else {
      warnings.push(`Não achei o tamanho ${sizes.join('/').toUpperCase()} para este item.`);
      confidence = 'none';
    }
  } else {
    // linhas com saldo primeiro
    candidateIds = [...rows].sort((a, b) => Number(b.quantity > 0) - Number(a.quantity > 0)).map((r) => r.id);
    const plain = rows.filter((r) => (idx.rowSize.get(r.id) ?? '') === '' || idx.rowSize.get(r.id) === 'unico');
    if (sameSizeAs && rows.some((r) => r.id === sameSizeAs)) {
      // "Você pediu 5 botinas 42, enviamos 3": mesmo item/tamanho da frase anterior
      itemId = sameSizeAs;
      warnings.push('Considerei o mesmo item e tamanho da frase anterior. Confira.');
      confidence = downgrade(confidence);
    } else if (plain.length === 1) {
      // o texto não cita tamanho e existe uma única linha sem tamanho: é a leitura natural, mas pede conferência
      itemId = plain[0].id;
      const others = rows.filter((r) => r !== plain[0]).map((r) => r.size).join(', ');
      warnings.push(`O texto não cita tamanho: usei a linha sem tamanho cadastrado (há também: ${others}).`);
      confidence = downgrade(confidence);
    } else {
      warnings.push('Não vi o tamanho no texto. Escolha qual foi enviado.');
      confidence = 'none';
    }
  }

  if (itemId) candidateIds = [itemId, ...candidateIds.filter((x) => x !== itemId)];
  if (qtyAssumed && confidence === 'high') confidence = 'medium';
  return { qty, qtyAssumed, itemId, candidateIds, confidence, warnings, sizeFromText: sizes.length > 0 };
}

function downgrade(c: Confidence): Confidence {
  return c === 'high' ? 'medium' : c === 'medium' ? 'low' : c;
}

/* ------------------------------------------------------------------ */
/*  Principal                                                          */
/* ------------------------------------------------------------------ */

function removeExcluded(text: string, exclude: string[] | undefined): string {
  let t = text;
  for (const e of exclude ?? []) {
    const name = fold(e).replace(/\s+/g, ' ').trim();
    if (name.length < 2) continue;
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
    // só tira o nome quando vem depois de "posto", "para o", "colaborador"... (não confunde com "Camisa Max Forte")
    const re = new RegExp(`(?:posto|unidade|filial|loja|cliente|setor|local|colaborador[a]?|funcionario|funcionaria|para o|para a|para|pro|pra|ao|ola,?|oi,?|sr\\.?|sra\\.?)\\s+${esc}`, 'gi');
    t = foldKeep(t).replace(re, ' ');
  }
  return t;
}

// aplica o "fold" mantendo o tamanho do texto (letras acentuadas → mesma letra sem acento)
function foldKeep(s: string): string {
  return s.replace(/[\u00c0-\u017f]/g, (ch) => fold(ch));
}

export function parseReply(text: string, catalog: CatalogRow[] | CatalogIndex, opts: ParseOptions = {}): ParseResult {
  const idx: CatalogIndex = Array.isArray(catalog) ? buildIndex(catalog) : catalog;
  const notes: string[] = [];
  const cleaned = cleanReply(text);
  if (cleaned.cut) notes.push('Ignorei a parte citada/assinatura do final da mensagem.');
  const boosted = hintGroups(opts.hints ?? [], idx);

  const lines: ParsedLine[] = [];
  let ctx: Polarity | null = null;
  let lastGroup: Group | null = null;
  let lastItemId: string | null = null;
  let seq = 0;

  /** Analisa um trecho e devolve a linha (ou null se não for item). */
  const analyze = (piece: string, polarity: Polarity, allowInherit: boolean | 'header'): ParsedLine | null => {
    const toks0 = tokenize(piece);
    if (toks0.length === 0) return null;
    const toks = fixTypos(toks0, idx);
    const roles = assignRoles(toks, idx);
    const hits = scoreGroups(toks, roles, idx);
    const hasQtyAnchor = roles.some((r) => r === 'qty');
    const hasNum = toks.some((t) => t.kind === 'num' || t.kind === 'numw');
    if (hits.length > 0) {
      const best = hits[0];
      const anyNonBrand = hits.some((h) => h.nonBrandMatched && h.miss === 0) || best.nonBrandMatched;
      if (!hasNum && !anyNonBrand) return null; // só "Max Serviços" etc.: não é item
      if (!hasNum && allowInherit === 'header') {
        const only = pickGroup(hits, boosted);
        if (only.g) {
          lastGroup = only.g;
          lastItemId = null;
        }
        return null;
      }
      const pick = pickGroup(hits, boosted);
      if (pick.g && pick.hit) {
        const r = resolveInGroup(pick.g, toks, roles, pick.hit.consumed, idx, pick.confidence);
        lastGroup = pick.g;
        lastItemId = r.itemId;
        const unk = unknownWords(toks0, idx).filter((u) => !toks.some((t) => t.raw === u && idx.vocabSet.has(t.s)));
        const w = [...pick.warnings, ...r.warnings];
        let conf = r.confidence;
        if (unk.length) {
          w.push(`Não reconheci a palavra "${unk.join('", "')}" no trecho. Pode ser outro item.`);
          if (conf === 'high') conf = 'medium';
        }
        return mk(++seq, piece, polarity, r.qty, r.qtyAssumed, r.itemId, r.candidateIds, conf, w);
      }
      const q = roughQty(toks, roles);
      const cand = collectCandidates(pick.candidatesGroups, toks, idx);
      lastGroup = pick.candidatesGroups.length === 1 ? pick.candidatesGroups[0] : null;
      lastItemId = null;
      return mk(++seq, piece, polarity, q.qty, q.assumed, null, cand, 'none', ['Não consegui definir qual item é. Escolha na lista.', ...pick.warnings]);
    }
    if (allowInherit && hasNum && lastGroup && isPureQtySize(toks)) {
      // "1 G", "tam 8 (1 un)": continua o item anterior
      const hit: GroupHit = { g: lastGroup, recall: 1, miss: 0, score: 1, consumed: new Set(), matchedWords: 0, nonBrandMatched: true };
      const r = resolveInGroup(hit.g, toks, roles, hit.consumed, idx, 'high', lastItemId);
      const w = [...r.warnings];
      let conf = r.confidence;
      if (r.itemId) {
        w.unshift(`Continuação do item anterior: ${hit.g.name}.`);
        conf = r.confidence === 'high' && !r.qtyAssumed && r.sizeFromText ? 'high' : 'medium';
      }
      return mk(++seq, piece, polarity, r.qty, r.qtyAssumed, r.itemId, r.candidateIds, conf, w);
    }
    if (hasQtyAnchor && polarity === 'sent' && looksLikeUnknownItem(toks, idx)) {
      const q = roughQty(toks, roles);
      return mk(++seq, piece, polarity, q.qty, q.assumed, null, [], 'none', ['Não encontrei este item no estoque.']);
    }
    return null;
  };

  /** Trecho só com tamanho e/ou quantidade ("tam 7", "2 unidades", "quantidade 2", "42"). */
  const pureFragment = (piece: string): boolean => {
    const toks = tokenize(piece);
    if (!toks.length || !toks.some((t) => t.kind === 'num' || t.kind === 'numw' || t.kind === 'size')) return false;
    return isPureQtySize(toks);
  };

  let lineNo = 0;
  let prevEmitted: { line: ParsedLine; lineNo: number; piece: string } | null = null;
  let pending: { piece: string; lineNo: number } | null = null;

  const rawLines = cleaned.text.split('\n');
  for (const rawLine of rawLines) {
    lineNo++;
    if (!rawLine.trim()) {
      ctx = null;
      continue;
    }
    const body = stripBullet(rawLine);
    if (!body) continue;
    for (const clauseInfo of splitClauses(body)) {
      const clause = clauseInfo.text;
      const cleanedClause = openCuePar(removeExcluded(clause, opts.exclude), idx);
      const isHeader = /:\s*$/.test(clause);
      let carry: Polarity | null = null;
      const pieces = cleanedClause.split(PIECE_SPLIT).map((p) => p.trim()).filter(Boolean);
      // "trocamos 1 botina 40 por 1 botina 42": o primeiro item voltou, o segundo saiu
      const clauseText = ' ' + cueFix(prep(cleanedClause), idx) + ' ';
      const exchange = RE_EXCH.test(clauseText);
      const complex = RE_SPLITWORDS.test(clauseText);
      const firstLine = lines.length;
      let emitted = 0;
      for (let pi = 0; pi < pieces.length; pi++) {
        let piece = pieces[pi];
        let forced: Polarity | null = null;
        if (exchange) {
          const m = piece.match(/^(.*?)\s+por\s+(.*)$/i);
          if (m && m[2]) {
            pieces.splice(pi + 1, 0, m[2]);
            piece = m[1];
            forced = 'return';
          } else if (pi > 0 && /por\s/i.test(pieces[pi - 1] ?? '')) forced = 'sent';
        }
        const ptext = ' ' + cueFix(prep(piece), idx) + ' ';
        const conj = RE_CONJ.test(prep(piece));
        const { own } = polarityOf(ptext);
        let polarity: Polarity;
        if (forced) polarity = forced;
        else if (clauseInfo.q) polarity = 'info';
        else if (own) polarity = own;
        else if (conj) polarity = 'sent';
        else polarity = carry ?? ctx ?? 'sent';
        if (own && own !== 'sent') carry = own;
        else if (own === 'sent' || conj) carry = null;
        if (forced === 'return') carry = null;

        let line: ParsedLine | null = null;

        // "Botina, tamanho 42, 2 unidades": pedaços soltos entram no item anterior
        if (prevEmitted && lineNo - prevEmitted.lineNo <= 1 && pureFragment(piece) && (prevEmitted.line.qtyAssumed || !prevEmitted.line.itemId)) {
          const joinedText: string = prevEmitted.piece + ', ' + piece;
          const joined = analyze(joinedText, prevEmitted.line.polarity, false);
          if (joined && (!joined.qtyAssumed || (joined.itemId && !prevEmitted.line.itemId))) {
            const at = lines.indexOf(prevEmitted.line);
            if (at >= 0) lines.splice(at, 1);
            decorate(joined);
            lines.push(joined);
            prevEmitted = { line: joined, lineNo, piece: joinedText };
            emitted++;
            continue;
          }
        }
        // "Quantidade: 2" escrito ANTES do item
        if (!prevEmitted && !lastGroup && pureFragment(piece) && !tokenize(piece).some((t) => t.kind === 'size' || t.kind === 'tam')) {
          pending = { piece, lineNo };
          continue;
        }
        if (pending && lineNo - pending.lineNo <= 1) {
          const joined = analyze(piece + ', ' + pending.piece, polarity, false);
          pending = null;
          if (joined && !joined.qtyAssumed) line = joined;
          else line = analyze(piece, polarity, true);
        } else {
          line = analyze(piece, polarity, isHeader && pieces.length === 1 ? 'header' : true);
        }
        if (!line) continue;
        emitted++;
        decorate(line);
        lines.push(line);
        prevEmitted = { line, lineNo, piece };
      }
      if (complex) {
        for (let k = firstLine; k < lines.length; k++) {
          lines[k].warnings.push('O texto divide as quantidades ("cada", "sendo"...). Confira os números.');
          lines[k].confidence = downgrade(lines[k].confidence);
        }
      }
      if (emitted === 0 && isHeader) {
        const { own } = polarityOf(clauseText);
        ctx = own ?? 'sent';
      }
    }
  }

  finalize(lines, idx, notes);
  return { lines, notes };
}

/** "(o 40 está sem estoque)": parênteses com aviso de falta/futuro viram um trecho separado. */
function openCuePar(s: string, idx: CatalogIndex): string {
  return s.replace(/\(([^()]*)\)/g, (m, inner: string) => {
    const t = ' ' + cueFix(prep(inner), idx) + ' ';
    if (RE_NEG.test(t) || RE_FUT.test(t) || RE_RET.test(t) || RE_INFO.test(t)) return `, ${inner}, `;
    return m;
  });
}

function mk(
  n: number,
  source: string,
  polarity: Polarity,
  qty: number,
  qtyAssumed: boolean,
  itemId: string | null,
  candidates: string[],
  confidence: Confidence,
  warnings: string[],
): ParsedLine {
  return {
    key: `l${n}`,
    source: source.trim(),
    qty,
    qtyAssumed,
    itemId,
    candidates,
    confidence,
    polarity,
    selected: false,
    warnings: [...new Set(warnings)],
  };
}

function roughQty(toks: Tok[], roles: Role[]): { qty: number; assumed: boolean } {
  const q = toks.findIndex((t, i) => roles[i] === 'qty' && (t.kind === 'num' || t.kind === 'numw'));
  if (q >= 0) return { qty: Math.min(9999, Math.max(1, toks[q].val as number)), assumed: false };
  return { qty: 1, assumed: true };
}

function collectCandidates(groups: Group[], toks: Tok[], idx: CatalogIndex): string[] {
  const sizes = new Set<string>();
  for (const t of toks) {
    const s = sizeOfTok(t);
    if (s && t.kind === 'size') sizes.add(s);
  }
  const out: string[] = [];
  for (const g of groups) {
    const rows = [...g.rows];
    rows.sort((a, b) => {
      const sa = sizes.has(idx.rowSize.get(a.id) ?? '') ? 1 : 0;
      const sb = sizes.has(idx.rowSize.get(b.id) ?? '') ? 1 : 0;
      return sb - sa || Number(b.quantity > 0) - Number(a.quantity > 0);
    });
    for (const r of rows) out.push(r.id);
  }
  return out.slice(0, 60);
}

/** Trecho com só quantidade/tamanho (e palavras de ligação), sem nome de item. */
function isPureQtySize(toks: Tok[]): boolean {
  let hasQtyOrSize = false;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.kind === 'num' || t.kind === 'numw' || t.kind === 'size') hasQtyOrSize = true;
    else if (t.kind === 'tam' || t.kind === 'x' || t.kind === 'unit' || t.kind === 'qtdw') continue;
    else if (t.kind === 'word' && RE_CUE_WORD.test(t.s)) continue;
    else return false;
  }
  return hasQtyOrSize;
}

function looksLikeUnknownItem(toks: Tok[], idx: CatalogIndex): boolean {
  // "2 pacotes de algo": qtd na frente + uma palavra desconhecida logo depois
  const i = toks.findIndex((t) => t.kind === 'num' || t.kind === 'numw');
  if (i < 0) return false;
  for (let k = 0; k < i; k++) {
    const t = toks[k];
    if (!(t.kind === 'word' && RE_CUE_WORD.test(t.s))) return false;
  }
  if (i > 4) return false;
  let n = i + 1;
  if (toks[n] && toks[n].kind === 'unit') n++;
  const w = toks[n];
  return !!w && w.kind === 'word' && w.s.length >= 3 && !idx.vocabSet.has(w.s);
}

function hintGroups(hints: string[], idx: CatalogIndex): Set<string> {
  const out = new Set<string>();
  for (const h of hints) {
    for (const clause of h.split(/\n/)) {
      for (const piece of stripBullet(clause).split(PIECE_SPLIT)) {
        const toks0 = tokenize(piece);
        if (!toks0.length) continue;
        const toks = fixTypos(toks0, idx);
        const roles = assignRoles(toks, idx);
        const hits = scoreGroups(toks, roles, idx).filter((x) => x.miss === 0);
        if (hits.length > 0 && hits.length <= 4) hits.forEach((x) => out.add(x.g.key));
      }
    }
  }
  return out;
}

function decorate(line: ParsedLine) {
  if (line.polarity === 'negated') line.warnings.push('O texto diz que este item NÃO foi enviado.');
  if (line.polarity === 'future') line.warnings.push('O texto fala de envio futuro/pendente. Marque só se já saiu.');
  if (line.polarity === 'info') line.warnings.push('Parece informação de estoque/pedido, não um envio.');
  if (line.polarity === 'return') line.warnings.push('Parece devolução ou troca, não uma saída.');
}

/** Última passada: saldo, repetidos e a decisão de pré-marcar. */
function finalize(lines: ParsedLine[], idx: CatalogIndex, notes: string[]) {
  const seen = new Map<string, ParsedLine>();
  for (const l of lines) {
    const row = l.itemId ? idx.byId.get(l.itemId) : null;
    if (row && l.qty > row.quantity) {
      l.warnings.push(`Saldo insuficiente: há ${row.quantity} no almoxarifado e o texto fala em ${l.qty}.`);
    }
    if (row) {
      const k = row.id;
      const prev = seen.get(k);
      if (prev) {
        if (prev.qty === l.qty && prev.polarity === l.polarity) {
          l.warnings.push('Parece repetido (mesmo item e quantidade já aparecem acima).');
          l.confidence = 'low';
        } else {
          l.warnings.push('Este item aparece mais de uma vez no texto.');
        }
      } else seen.set(k, l);
    }
    const blocking =
      !row ||
      l.polarity !== 'sent' ||
      l.confidence !== 'high' ||
      l.qtyAssumed ||
      l.qty > (row?.quantity ?? 0) ||
      l.warnings.some((w) => w.startsWith('Parece repetido'));
    l.selected = !blocking;
  }
  const dup = lines.filter((l) => l.selected && l.itemId);
  const per = new Map<string, number>();
  for (const l of dup) per.set(l.itemId as string, (per.get(l.itemId as string) ?? 0) + l.qty);
  for (const [id, q] of per) {
    const row = idx.byId.get(id);
    if (row && q > row.quantity) {
      notes.push(`A soma das linhas de "${row.name}${row.size ? ' · ' + row.size : ''}" passa do saldo (${row.quantity}).`);
      for (const l of dup) if (l.itemId === id) l.selected = false;
    }
  }
}
