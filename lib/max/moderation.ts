import { normalize } from './text';

/**
 * Filtro de linguagem da Max (ambiente de trabalho). Roda no navegador e no servidor,
 * antes de qualquer outra coisa: palavrão ou conteúdo impróprio não chega à IA.
 */
const WORDS = new Set([
  'porra', 'caralho', 'caraio', 'krl', 'crl', 'merda', 'bosta', 'puta', 'puto', 'putaria', 'fdp', 'pqp', 'vsf', 'vtnc', 'tnc',
  'foda', 'fodase', 'foder', 'fode', 'fodido', 'fodida', 'fuder', 'fude', 'fudido', 'fudida', 'cu', 'cuzao', 'cuzona', 'buceta', 'boceta', 'xoxota', 'xereca',
  'piroca', 'pica', 'rola', 'caceta', 'punheta', 'punheteiro', 'boquete', 'arrombado', 'arrombada', 'viado', 'viadinho', 'bicha', 'vagabunda', 'vadia', 'piranha',
  'corno', 'corna', 'desgracado', 'desgracada', 'babaca', 'escroto', 'escrota', 'otario', 'otaria', 'retardado', 'retardada', 'mongol', 'safada', 'safado',
  'porno', 'pornografia', 'putinha', 'gostosa', 'tesao', 'transar', 'trepar', 'sexo', 'nudes', 'nude', 'pelada', 'pelado',
]);
const PHRASES = [
  /\bfilh[oa] d[ae] puta\b/, /\bvai (se|te|tomar|toma)( \w+)? (fuder|foder|ferrar|cu|no cu)\b/, /\bpau no cu\b/, /\btomar no cu\b/, /\bvai a merda\b/, /\bputa que pariu\b/,
  /\bcomo (fazer|fabricar|montar) (uma )?(bomba|arma|droga)\b/, /\b(matar|agredir|bater em|espancar) (alguem|uma pessoa|o chefe|meu chefe|um colega)\b/, /\bcomprar (droga|drogas|maconha|cocaina)\b/,
];
// palavras inocentes que contêm ou coincidem com as da lista em contexto de trabalho
const ALLOW_CONTEXT: [string, RegExp][] = [
  ['rola', /\b(o que|que|como) rola\b|\brola (de|um|uma)\b/],
  ['pica', /\bpica[- ]pau\b/],
  ['sexo', /\b(sexo|genero) (do|da|masculino|feminino)\b|\bcampo sexo\b/],
];

export const BLOCKED_REPLY = 'Vamos manter a conversa profissional. Posso ajudar com algo do trabalho?';

export function isBlocked(text: string): boolean {
  const n = normalize(text);
  if (!n) return false;
  if (PHRASES.some((r) => r.test(n))) return true;
  for (const tok of n.split(' ')) {
    if (!WORDS.has(tok)) continue;
    const ok = ALLOW_CONTEXT.find(([w]) => w === tok);
    if (ok && ok[1].test(n)) continue;
    return true;
  }
  return false;
}
