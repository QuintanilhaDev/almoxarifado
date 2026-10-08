import 'server-only';
import { normalize } from '../text';
import { getJson } from './net';

/** Conhecimento geral pela Wikipédia em português (gratuita, sem chave). */

const QUESTION = /^(quem (e|foi|eram|sao|era|descobriu|inventou|criou|fundou|escreveu|pintou|ganhou|venceu)|o que (e|sao|foi|significa|quer dizer)|que e|qual (e|foi|era)|quais (sao|foram)|onde (fica|e|esta|nasceu|ficava)|quando (foi|e|nasceu|morreu|comecou|terminou|aconteceu)|como (funciona|surgiu|e feito|se faz)|por ?que|defina|definicao de|significado de|me (fale|fala|conta|conte|explica|explique) (sobre|de|o que e|quem e|quem foi)|fale sobre|fala sobre|explique|explica|pesquis\w+|procur\w+ (sobre|por)|busc\w+ (sobre|por)|sabe (o que e|quem e|quem foi)|conhece|historia d[eoa]|capital d[eoa]|populacao d[eoa]|significado d[eoa])\b/;

export function looksLikeQuestion(text: string): boolean {
  return QUESTION.test(normalize(text));
}

/** Tira o "quem foi / o que é / me fale sobre" para sobrar o assunto. */
export function topicOf(text: string): string {
  let n = normalize(text);
  n = n
    .replace(/^(voce )?(sabe|conhece|pode me dizer|me diz|me diga)\s+/, '')
    .replace(/^(me )?(fale|fala|conta|conte|explica|explique|pesquise|pesquisa|pesquisar|procure|procura|busque|busca)( me)?( sobre| por| de| a respeito de)?\s+/, '')
    .replace(/^(defina|definicao de|significado de|o que significa|o que quer dizer)\s+/, '')
    .replace(/^(quem|o que|que|qual|quais|onde|quando|como|por ?que)\s+(e|foi|sao|eram|era|foram|fica|esta|ficava)\s+/, '')
    .replace(/^(o|a|os|as|um|uma)\s+/, '')
    .replace(/\s+(por favor|na wikipedia|no google)$/, '');
  return n.trim();
}

interface SearchResult {
  query?: { search?: { title: string }[] };
}
interface Summary {
  type?: string;
  title?: string;
  extract?: string;
}

function shorten(extract: string, max = 330): string {
  const clean = extract.replace(/\s*\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
  const sentences = clean.match(/[^.!?]+[.!?]+/g) ?? [clean];
  let out = '';
  for (const s of sentences) {
    if (out && (out + s).length > max) break;
    out += s;
    if (out.length > max * 0.6) break;
  }
  return (out || clean.slice(0, max)).trim();
}

export async function wikiAnswer(text: string): Promise<{ say: string; text: string } | null> {
  // perguntas inteiras ("quem descobriu o Brasil") rendem mais na busca do que só o assunto
  const queries = Array.from(new Set([topicOf(text), normalize(text)])).filter((q) => q.length >= 2);
  for (const query of queries) {
    const found = await getJson<SearchResult>(
      `https://pt.wikipedia.org/w/api.php?action=query&list=search&srlimit=1&format=json&origin=*&srsearch=${encodeURIComponent(query)}`,
    );
    const title = found?.query?.search?.[0]?.title;
    if (!title) continue;
    const sum = await getJson<Summary>(`https://pt.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`);
    if (!sum?.extract || sum.type === 'disambiguation') continue;
    const short = shorten(sum.extract);
    if (short.length < 30) continue;
    return { say: short, text: `${short}\n— Wikipédia, “${sum.title ?? title}”` };
  }
  return null;
}
