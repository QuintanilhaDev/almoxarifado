import 'server-only';
import { currencyAnswer, currencyIn } from './currency';
import { askLlm, llmConfigured } from './llm';
import { isWeatherQuestion, weatherAnswer } from './weather';
import { looksLikeQuestion, wikiAnswer } from './wiki';

export interface AnswerContext {
  userName: string;
  sectorName: string | null;
  scope: 'login' | 'hub' | 'sector';
  examples: string[];
  /** só a IA, só para dizer qual comando a frase quer (segunda opinião do motor local) */
  routeOnly?: boolean;
}

export interface Answer {
  say?: string;
  text?: string;
  route?: string;
  source: string;
}

export function cleanText(v: unknown, max = 400): string {
  return String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function cleanExamples(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((e): e is string => typeof e === 'string').map((e) => e.slice(0, 120)).slice(0, 40) : [];
}

/** Clima → câmbio → IA opcional → Wikipédia. Só a frase da pessoa sai do servidor. */
export async function answerRemote(text: string, ctx: AnswerContext): Promise<Answer> {
  if (ctx.routeOnly) {
    if (!llmConfigured()) return { source: 'nenhuma' };
    const ans = await askLlm(text, ctx);
    return ans?.route ? { route: ans.route, source: 'ia' } : { source: 'nenhuma' };
  }
  if (isWeatherQuestion(text)) {
    const w = await weatherAnswer(text);
    if (w) return { ...w, source: 'clima' };
  }
  if (currencyIn(text)) {
    const c = await currencyAnswer(text);
    if (c) return { ...c, source: 'cambio' };
  }
  if (llmConfigured()) {
    const ans = await askLlm(text, ctx);
    if (ans?.route) return { route: ans.route, source: 'ia' };
    if (ans?.say) return { say: ans.say, source: 'ia' };
  }
  if (looksLikeQuestion(text)) {
    const w = await wikiAnswer(text);
    if (w) return { ...w, source: 'wikipedia' };
  }
  return { source: 'nenhuma' };
}
