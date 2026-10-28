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

/* ------------------------------------------------------------------ */
/* senhas ditas à Max: nunca vão para auditoria, histórico ou memória   */
/* ------------------------------------------------------------------ */

const SECRET_WORD = /^(senha|senhas|password|passwd|pwd|pin)$/;
// palavras que podem vir entre "senha" e o valor ("nova senha do joão para X")
const SECRET_LINK = new Set(['para', 'pra', 'como', 'seja', 'sera', 'e', 'eh', 'ser', 'fica', 'igual', '=', ':', 'is', 'to']);
// adjetivos/artigos que podem vir entre "senha" e o valor ("nova senha provisória X")
const SECRET_SKIP = new Set(['a', 'o', 'nova', 'novo', 'atual', 'provisoria', 'temporaria', 'inicial', 'com', 'sua', 'minha', 'tua', 'seu', 'meu']);
// "senha da Juliana": o que vem depois é o dono, não o valor
const SECRET_OWNER = new Set(['de', 'do', 'da', 'dos', 'das', 'dele', 'dela', 'deles', 'no', 'na', 'em', 'que', 'pro', 'pela', 'pelo']);
// palavras comuns logo depois de "senha" que não são o valor ("a senha está errada")
const SECRET_COMMON = new Set([
  'esta', 'estava', 'ta', 'tava', 'errada', 'errado', 'certa', 'correta', 'incorreta', 'invalida', 'antiga', 'expirou', 'venceu', 'mudou', 'nao', 'foi', 'nunca', 'sempre',
  'trocada', 'redefinida', 'alterada', 'bloqueada', 'nem', 'ainda', 'tambem', 'agora', 'depois', 'aqui', 'ai', 'mesmo', 'mesma', 'forte', 'fraca', 'segura', 'padrao',
  'usuario', 'login', 'acesso', 'conta', 'max', 'ok', 'sim', 'pode', 'por', 'favor',
]);
export const SECRET_MASK = '***';

const bare = (w: string) => normalize(w).replace(/[:=]+$/, '');

/**
 * Tira senhas de um texto ("senha: X", "nova senha X", "senha do joão para X", "com a senha X").
 * Vale para o navegador e o servidor; o pedido em si continua indo para a ação normalmente.
 */
export function redactSecrets(text: string): string {
  if (!text) return text;
  const parts = text.split(/(\s+)/);
  const words: number[] = [];
  parts.forEach((p, i) => p.trim() && words.push(i));
  const mask = (wi: number) => {
    const i = words[wi];
    if (i === undefined) return;
    // só a vírgula final fica (ponto e símbolos podem fazer parte da senha)
    parts[i] = SECRET_MASK + (parts[i].endsWith(',') ? ',' : '');
  };
  for (let w = 0; w < words.length; w++) {
    const raw = parts[words[w]];
    // "senha:abc" / "senha=abc" numa palavra só
    const glued = raw.match(/^(senha|password|pwd|pin)\s*[:=]\s*(\S+)$/i);
    if (glued) {
      parts[words[w]] = `${glued[1]}: ${SECRET_MASK}`;
      continue;
    }
    if (!SECRET_WORD.test(bare(raw))) continue;
    const explicit = /[:=]$/.test(raw);
    let target = -1;
    // conector até 8 palavras adiante: o valor vem logo depois dele
    for (let k = w + 1; k < Math.min(words.length, w + 9); k++) {
      const b = bare(parts[words[k]]);
      if (SECRET_WORD.test(b)) break;
      if (SECRET_LINK.has(b) || /[:=]$/.test(parts[words[k]]) || /^(é|e:)$/i.test(parts[words[k]])) {
        target = k + 1;
        // "para a X": pula só artigo curto
        while (target < words.length - 1 && /^(a|o)$/.test(bare(parts[words[target]]))) target++;
        break;
      }
    }
    if (target < 0) {
      // sem conector: a palavra logo depois (pulando "nova", "provisória"…), se não for o dono nem palavra comum
      let k = w + 1;
      while (k < words.length && SECRET_SKIP.has(bare(parts[words[k]]))) k++;
      const b = k < words.length ? bare(parts[words[k]]) : '';
      if (b && (explicit || (!SECRET_OWNER.has(b) && !SECRET_COMMON.has(b) && !/^[?!.]+$/.test(parts[words[k]])))) target = k;
    }
    if (target >= 0 && target < words.length) {
      mask(target);
      w = target;
    }
  }
  return parts.join('');
}

/** o texto parece trazer uma senha? */
export const hasSecret = (text: string) => Boolean(text) && redactSecrets(text) !== text;

/** a Max acabou de perguntar uma senha? (a próxima resposta da pessoa é a própria senha) */
export const ASKED_SECRET_RE = /\b(senha)\b[^?]*\?\s*$/i;
