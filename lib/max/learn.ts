import { normalize, stem, tokenize } from './text';

/**
 * Aprendizado da Max (sem custo, sem treinar rede neural):
 * um classificador por vizinho mais próximo sobre os pedidos que já foram resolvidos.
 *
 *  - Cada pedido resolvido vira um exemplo: "frase" → comando da tela ou ferramenta usada.
 *  - Um pedido novo é comparado com os exemplos (radicais das palavras + trigramas de letras,
 *    então erros de voz, plural, ordem e cortesias não atrapalham).
 *  - Muito parecido (>= RECALL) com um exemplo de comando: a Max executa na hora, sem gastar a IA.
 *  - Parecido (>= HINT): o exemplo entra no pedido à IA como "caso já resolvido" (few-shot),
 *    o que deixa a IA mais certeira naquele tipo de pedido.
 *  - 👎 de quem usa rebaixa o exemplo; exemplo com mais 👎 do que acertos deixa de valer.
 */
export interface Learned {
  phrase: string;
  /** comando pronto da tela (a Max local executa) */
  route?: string | null;
  /** ou ferramenta da IA usada para responder */
  tool?: string | null;
  args?: Record<string, unknown> | null;
}

export const RECALL = 0.86;
export const HINT = 0.45;

const FILLER = new Set([
  'max', 'por', 'favor', 'gentileza', 'pfv', 'pf', 'voce', 'vc', 'pode', 'poderia', 'consegue', 'me', 'mim', 'pra', 'para', 'eu', 'quero', 'queria', 'gostaria',
  'preciso', 'desejo', 'de', 'da', 'do', 'das', 'dos', 'a', 'o', 'as', 'os', 'e', 'em', 'no', 'na', 'nos', 'nas', 'um', 'uma', 'que', 'ai', 'la', 'aqui',
  'fale', 'fala', 'falar', 'diga', 'diz', 'dizer', 'conta', 'conte', 'informe', 'informa', 'informar', 'saber', 'obrigado', 'obrigada', 'ola', 'oi', 'ao', 'se', 'esta', 'ta',
  'tem', 'temos', 'ha', 'qual', 'quais', 'e', 'eh', 'sao', 'foi', 'ser', 'agora', 'hoje',
  'gente', 'nos', 'entao', 'so', 'mesmo', 'tipo', 'assim', 'ja', 'ne', 'bem', 'muito', 'rapidinho', 'rapido', 'exatamente', 'atualmente', 'momento', 'neste', 'nesse',
  'mostra', 'mostre', 'mostrar', 'ver', 'veja', 'olha', 'olhe', 'sabe', 'sei', 'com', 'ao', 'aos', 'pro', 'pros',
]);
// "hoje"/"agora" contam para o sentido em pedidos de período; ficam fora só do FILLER de comparação fraca
FILLER.delete('hoje');

/** Palavras que carregam o sentido do pedido, já reduzidas ao radical. */
export function signature(text: string): string[] {
  const out = new Set<string>();
  for (const t of tokenize(normalize(text))) {
    if (FILLER.has(t)) continue;
    out.add(stem(t));
  }
  return [...out].sort();
}

/** Chave estável do pedido (mesmas palavras em outra ordem = mesma chave). */
export const signatureKey = (text: string) => signature(text).join(' ');

const numbers = (text: string) => (normalize(text).match(/\d+(?:[.,]\d+)?/g) ?? []).sort().join(',');

function trigrams(s: string): Set<string> {
  const p = `  ${s} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= p.length; i++) out.add(p.slice(i, i + 3));
  return out;
}
function overlap<T>(a: Set<T>, b: Set<T>): number {
  let n = 0;
  a.forEach((x) => b.has(x) && n++);
  return n;
}

/** 0..1 — quão parecido é o sentido de dois pedidos. */
export function phraseSimilarity(a: string, b: string): number {
  const sa = signature(a);
  const sb = signature(b);
  if (!sa.length || !sb.length) return 0;
  const A = new Set(sa);
  const B = new Set(sb);
  const inter = overlap(A, B);
  const jaccard = inter / (A.size + B.size - inter);
  const ta = trigrams(sa.join(' '));
  const tb = trigrams(sb.join(' '));
  const dice = (2 * overlap(ta, tb)) / (ta.size + tb.size);
  return 0.55 * jaccard + 0.45 * dice;
}

/**
 * Pedido praticamente igual a um já resolvido por COMANDO: devolve o comando para executar na hora.
 * Números precisam ser os mesmos ("bota 42" não vale para "bota 44").
 */
export function recall(text: string, learned: Learned[]): { route: string; score: number } | null {
  if (signature(text).length < 2) return null; // frase curta demais para generalizar com segurança
  const nums = numbers(text);
  let best: { route: string; score: number } | null = null;
  for (const l of learned) {
    if (!l.route || numbers(l.phrase) !== nums) continue;
    const s = phraseSimilarity(text, l.phrase);
    if (s >= RECALL && (!best || s > best.score)) best = { route: l.route, score: s };
  }
  return best;
}

/** Os exemplos mais parecidos, para a IA ver como pedidos assim já foram resolvidos. */
export function nearest(text: string, learned: Learned[], max = 4): (Learned & { score: number })[] {
  return learned
    .map((l) => ({ ...l, score: phraseSimilarity(text, l.phrase) }))
    .filter((l) => l.score >= HINT)
    .sort((a, b) => b.score - a.score)
    .slice(0, max);
}

/** A resposta é uma desistência ("não existe", "não consigo", "não sei")? */
export const GAVE_UP_RE =
  /\b(funcao|funcionalidade|recurso|ferramenta|opcao|isso|isto)\b[^.]{0,40}\b(ainda )?nao (existe|esta disponivel|e possivel)\b|\b(ainda )?nao (consigo|sei|posso)\b|\bnao (tenho|possuo) (acesso|essa informacao|como|ferramenta|essa funcao|esse dado)\b|\bnao (encontrei|ha) (uma |nenhuma )?(ferramenta|funcao)\b|\bfora do meu alcance\b|^(desculp\w+|sinto muito|infelizmente|lamento)\b|\bnao (ha|existe|encontrei|tenho) (um |uma |nenhum |nenhuma )?(comando|ferramenta|funcao|opcao|forma|maneira|jeito)\b/;
export const gaveUp = (say: string | null | undefined) => Boolean(say) && GAVE_UP_RE.test(normalize(say!));
