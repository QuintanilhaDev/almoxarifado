/**
 * Entendimento de pedidos de AÇÃO, do jeito que as pessoas falam ou digitam.
 *
 * Em vez de frases prontas, a Max procura as peças do pedido em qualquer ordem:
 *  - o verbo (em qualquer forma: "cadastrar", "cadastra", "cadastre", "cadastrei", "quero cadastrar", "pode cadastrar"…),
 *  - a quantidade (em número ou por extenso: "dez", "vinte e cinco"),
 *  - o item com o tamanho, o posto, a pessoa, o setor, o e-mail…
 * Tudo comparado com tolerância a erros de digitação e de reconhecimento de voz.
 */
import { SECTORS, type SectorDef } from '../sectors';
import { bestMatches, contentTokens, normalize, stem, tokenize, wordsToDigits } from './text';

/* ------------------------------------------------------------------ */
/* verbos                                                              */
/* ------------------------------------------------------------------ */

export const V = {
  create: /\b(cadastr\w*|cri[ae]\w*|cria|crie|adicion\w*|inclu\w*|insir\w*|inser\w*|registr\w*|nov[oa]s?|abr\w+ (um|uma) (nov[oa]|cadastro)|gerar? (um|uma))\b/,
  remove: /\b(exclu\w*|apag\w*|delet\w*|remov\w*|tir[ae]\w*|elimin\w*|descadastr\w*)\b/,
  entry: /\b(entrada|entradas|(dar|de|da|deu|dei|lanc\w+|registr\w+|faz\w*|fiz\w*) (uma |a )?entrada|cheg(ou|aram|ar|ando|ada|aram)|recebi\w*|recebe\w*|recebemos|entrou|entraram|rep(or|oe|us|usemos|onha|ondo)|reabastec\w+|abastec\w+|acrescent\w+|adicion\w+|soma\w*|som[ae]\w*|coloc\w+ mais|bot\w+ mais)\b/,
  exit: /\b(saida|saidas|(dar|de|da|deu|dei|lanc\w+|registr\w+) (uma |a )?(saida|baixa)|baix(a|ar|e|ei|ou|amos|aram)|retir\w+|tir(a|ar|e|ei|ou|amos|aram)|saiu|sairam|sai|usei|usamos|usaram|us(ou|ar)|consum\w+|gast\w+|perd\w+|quebr\w+|estrag\w+)\b/,
  adjust: /\b(ajust\w+|corrig\w+|acert\w+|contei|contamos|contagem|o saldo (d[oa]s? .+ )?(e|eh|esta|fica|ficou|para|pra|=)|saldo (real|certo|correto))\b/,
  send: /\b(envi\w+|mand\w+|transfer\w+|lev[ae]\w*|levou|despach\w+|distribu\w+|entreg\w+)\b/,
  giveBack: /\b(devolv\w+|devolucao|voltou|voltaram|volt\w+ (do|da|de)|retorn\w+|recolh\w+|trouxe\w*|trazer)\b/,
  status: /\b(marc\w+|mud\w+|troc\w+|alter\w+|coloc\w+|deix\w+|pass\w+|pon(ha|ho|ham)|por como|atualiz\w+|defin\w+|mova|mover)\b/,
  resolve: /\b(resolv\w+|finaliz\w+|conclu\w+|encerr\w+|fech\w+|atend\w+|dar (como )?(resolvid|conclu))/,
  reopen: /\b(reabr\w+|reabertura|volt\w+ (para|pra) (nova|pendente))\b/,
  deactivate: /\b(desativ\w+|bloque\w+|suspend\w+|desabilit\w+|inativ\w+|(tir\w+|remov\w+|cort\w+) (o |a )?acesso)\b/,
  activate: /\b(reativ\w+|ativ(a|ar|e|ou)\b|desbloque\w+|habilit\w+|(volt\w+|devolv\w+|libera\w*) (o |a )?acesso)\b/,
  authorize: /\b(autoriz\w+|liber\w+|permit\w+|cadastr\w+|adicion\w+|inclu\w+)\b/,
  unauthorize: /\b(desautoriz\w+|remov\w+|tir\w+|exclu\w+|apag\w+|bloque\w+|revog\w+)\b/,
  open: /\b(abr\w+|abre|mostr\w+|ver|veja|exib\w+|ir (para|pra|ao|a)|va (para|pra)|vai (para|pra)|entr\w+ (em|no|na)|acess\w+|leva\w*|lev[ae] (me )?(para|pra))\b/,
  importing: /\b(import\w+|carreg\w+|sub(ir|a|o|indo)|sobe|upload|envi\w+ (a |uma )?planilha|plan(ilha)?s? (de|com))\b/,
  ask: /^(como|qual|quais|quanto|quantos|quantas|onde|quando|quem|por que|porque|o que|tem |existe|existem|ha )/,
  explain: /\b(como (fa[cz]o|faz|se faz|eu|posso|consigo|funciona)|explic\w+|passo a passo|ensina\w*|me mostr\w+ como|o que (e|significa))\b/,
};

/** a frase é uma pergunta de "como fazer" (aí quem responde é o manual, não a ação) */
export const asksHow = (norm: string) => V.explain.test(norm);

/* ------------------------------------------------------------------ */
/* números                                                             */
/* ------------------------------------------------------------------ */

const SIZE_LETTERS = new Set(['pp', 'p', 'm', 'g', 'gg', 'xg', 'xgg', 'eg', 'egg', 'u', 'unico']);
const PREP = new Set(['para', 'pra', 'pro', 'por', 'com', 'sem', 'que', 'mas', 'mais', 'menos', 'ate', 'como', 'fica', 'ficar', 'seja', 'sendo', 'agora', 'hoje', 'ontem', 'reais', 'real', 'dias', 'dia', 'horas', 'semanas', 'meses']);
const QTY_UNITS = /^(unidades?|un|und|unid|pecas?|pares?|itens?|caixas?|pacotes?|kits?|rolos?|x)$/;

export interface Amounts {
  /** quantidade pedida ("10 botas", "dez unidades de bota") */
  qty: number | null;
  /** número que vem depois de "para/pra/=" (ajuste de saldo, mínimo) */
  target: number | null;
  /** a frase com os números por extenso trocados por algarismos */
  text: string;
}

/**
 * Separa a QUANTIDADE do TAMANHO: em "entrada de 10 botas 42" o 10 é quantidade e o 42 é tamanho.
 * Regra: o número que vem antes do item (ou antes de "unidades") é a quantidade; o que vem
 * logo depois do nome do item (ou de "tamanho/número") é o tamanho.
 */
export function amountsIn(norm: string): Amounts {
  const text = wordsToDigits(norm, true);
  const toks = tokenize(text);
  let qty: number | null = null;
  let target: number | null = null;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (!/^\d{1,6}$/.test(t)) continue;
    const prev = toks[i - 1] ?? '';
    const next = toks[i + 1] ?? '';
    const n = Number(t);
    if (/^(para|pra|=|fica|ficar|seja|sendo|e|eh)$/.test(prev) && target === null && i > 1) {
      // "saldo da bota 42 para 15", "mínimo da calça é 10"
      target = n;
      continue;
    }
    if (/^(tamanho|tam|numero|n|num|nº|calcado|manequim)$/.test(prev)) continue; // é tamanho
    const wordNext = /^[a-z]{3,}$/.test(next) && !PREP.has(next) && !SIZE_LETTERS.has(next);
    // "solicitação 12", "posto 01": número de registro (a não ser que venha um item depois: "compra 20 botas")
    if (/^(solicitac\w+|pedido|compra|nota|nf|protocolo|posto|matricula)$/.test(prev) && !(wordNext && /^(compra|pedido)$/.test(prev))) continue;
    if (QTY_UNITS.test(next)) {
      qty = n;
      continue;
    }
    // quantidade vem ANTES do nome ("2 coletes", "10 botas 42"); o número DEPOIS do nome é o tamanho ("botas 42")
    if (qty === null && /^[a-z]{3,}$/.test(next) && !PREP.has(next) && !SIZE_LETTERS.has(next)) {
      qty = n;
      continue;
    }
  }
  return { qty, target, text };
}

/** tamanho citado ("bota 42", "camisa G", "tamanho M", "número 40") */
export function sizeIn(norm: string): string | null {
  const t = wordsToDigits(norm, true);
  const m = t.match(/\b(?:tamanho|tam|numero|num|n)\s+([a-z]{1,3}|\d{1,3})\b/);
  if (m) return m[1].toUpperCase();
  const toks = tokenize(t);
  for (let i = 1; i < toks.length; i++) if (SIZE_LETTERS.has(toks[i]) && toks[i] !== 'u' && /^[a-z]{3,}$/.test(toks[i - 1])) return toks[i].toUpperCase();
  return null;
}

/* ------------------------------------------------------------------ */
/* coisas da plataforma                                                */
/* ------------------------------------------------------------------ */

const FILLER = new Set([
  ...'por favor favor pra mim para mim ai agora hoje ja mais menos so apenas aqui la entao ok max porfa obrigado obrigada vc voce voces pode poderia consegue consegues quero queria gostaria preciso precisamos vamos bora faz faca fazer fazendo me nos a o as os um uma uns umas de da do das dos no na nos nas em ao aos com sem e que pro pra para por unidade unidades un und unid peca pecas par pares item itens produto produtos material materiais estoque almoxarifado saldo quantidade total tudo todo toda todos todas isso esse essa este esta'.split(' '),
]);

/** palavras que sobram depois de tirar verbos, números, posto e cortesias: o nome do item */
export function leftovers(norm: string, drop: RegExp[] = [], dropWords: string[] = []): string {
  let t = wordsToDigits(norm, true);
  for (const r of drop) t = t.replace(new RegExp(r.source, 'g'), ' ');
  const kill = new Set(dropWords.flatMap((w) => tokenize(normalize(w))));
  return tokenize(t)
    .filter((w) => !FILLER.has(w) && !kill.has(w))
    .join(' ');
}

export type Found<T> = { one: T } | { many: T[] } | { none: true };

/** acha UM registro numa lista pelo que foi dito (ambíguo → devolve as opções) */
export function findOne<T>(needle: string, list: T[], label: (x: T) => string, min = 0.72): Found<T> {
  if (!needle.trim()) return { none: true };
  const hits = bestMatches(needle, list, label, min, 6);
  if (!hits.length) return { none: true };
  const top = hits[0];
  const close = hits.filter((h) => top.score - h.score < 0.04);
  if (close.length > 1) {
    // empate: se um deles é exatamente o que foi dito, fica com ele
    const exact = close.find((h) => normalize(label(h.item)) === normalize(needle));
    return exact ? { one: exact.item } : { many: close.map((h) => h.item) };
  }
  return { one: top.item };
}

/** item do estoque com o tamanho certo ("bota 42" não pode virar "bota 40") */
export function findItem<T extends { name: string; size: string | null }>(norm: string, needle: string, items: T[]): Found<T> {
  const size = sizeIn(norm) ?? sizeIn(needle);
  const label = (i: T) => `${i.name}${i.size ? ' ' + i.size : ''}`;
  const pool = size ? items.filter((i) => (i.size ?? '').toUpperCase() === size) : items;
  const r = findOne(needle, pool.length ? pool : items, label, 0.6);
  if ('many' in r && !size) {
    // sem tamanho e com várias opções do mesmo item: pergunta o tamanho
    return r;
  }
  return r;
}

/** posto citado em qualquer parte da frase ("pro Shopping Barra", "no posto 01") */
export function findPostoIn<T extends { name: string; code?: string | null }>(norm: string, postos: T[]): T | null {
  const toks = new Set(tokenize(wordsToDigits(norm, true)).map(stem));
  let best: { p: T; n: number } | null = null;
  for (const p of postos) {
    const words = contentTokens(normalize(p.name)).map(stem);
    if (!words.length) continue;
    // todas as palavras do nome precisam estar na frase ("posto 01": "posto" e "01")
    const hit = words.filter((w) => toks.has(w)).length;
    const code = p.code ? toks.has(normalize(p.code)) && /\bposto\b/.test(norm) : false;
    if ((hit === words.length || code) && (!best || words.length > best.n)) best = { p, n: words.length };
  }
  return best?.p ?? null;
}

/** pessoa citada (pelo nome, primeiro nome ou login) */
export function findPerson<T extends { display_name: string; username: string }>(norm: string, users: T[]): Found<T> {
  const toks = tokenize(norm);
  const at = toks.find((t) => users.some((u) => u.username === t || u.username === t.replace(/^@/, '')));
  if (at) return { one: users.find((u) => u.username === at.replace(/^@/, ''))! };
  // nome completo primeiro, depois o primeiro nome
  const full = users.filter((u) => {
    const w = contentTokens(normalize(u.display_name));
    return w.length > 1 && w.every((x) => toks.includes(x));
  });
  if (full.length === 1) return { one: full[0] };
  const first = users.filter((u) => toks.includes(contentTokens(normalize(u.display_name))[0] ?? '#'));
  if (first.length === 1) return { one: first[0] };
  if (first.length > 1) return { many: first };
  return { none: true };
}

export function sectorIn(norm: string): SectorDef | null {
  const toks = ` ${norm} `;
  return SECTORS.find((s) => s.aliases.some((a) => toks.includes(` ${normalize(a)} `)) || toks.includes(` ${normalize(s.name)} `)) ?? null;
}

/**
 * Devolve o trecho como a pessoa escreveu (com acentos e maiúsculas): a frase chega normalizada
 * ("lanterna tatica"), mas o cadastro deve sair "Lanterna tática".
 */
export function asWritten(normPhrase: string, raw: string): string {
  const want = tokenize(normPhrase);
  if (!want.length) return normPhrase;
  const words = raw.split(/\s+/).map((w) => w.replace(/^[^\p{L}\d@]+|[^\p{L}\d]+$/gu, '')).filter(Boolean);
  const normed = words.map((w) => normalize(w));
  for (let i = 0; i + want.length <= normed.length; i++) {
    if (want.every((w, k) => normed[i + k] === w)) return words.slice(i, i + want.length).join(' ');
  }
  return normPhrase;
}

/** "lanterna tática" → "Lanterna tática" (só a primeira letra, como no cadastro) */
export const firstUpper = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
/** "hospital central" → "Hospital Central" */
export const titleCase = (s: string) => s.replace(/(^|\s)(\p{L})/gu, (_m, sp: string, c: string) => sp + c.toUpperCase()).replace(/\s(De|Da|Do|Das|Dos|E)\s/g, (m) => m.toLowerCase());

/** e-mail citado (digitado, ou falado: "joao arroba empresa ponto com") */
export function emailIn(raw: string): string | null {
  const t = raw
    .toLowerCase()
    .replace(/\s+arroba\s+/g, '@')
    .replace(/(@[^\s]+?)\s+ponto\s+/g, '$1.')
    .replace(/\s+ponto\s+(com|br|net|org)\b/g, '.$1');
  const m = t.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/);
  return m ? m[0] : null;
}
