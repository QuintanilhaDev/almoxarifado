import 'server-only';
import { currencyAnswer, currencyIn } from './currency';
import { askLlm, llmConfigured } from './llm';
import { isWeatherQuestion, weatherAnswer } from './weather';
import { looksLikeQuestion, wikiAnswer } from './wiki';
import { isBlocked } from '../moderation';

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

// caracteres de controle e separadores invisíveis (nunca entram no pedido à IA)
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g;

export function cleanText(v: unknown, max = 400): string {
  return String(v ?? '')
    .replace(CONTROL_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/**
 * Frases-modelo que o navegador manda (vão para o pedido à IA): curtas, sem caracteres
 * de controle, sem aspas/crases que fecham o texto e sem palavrão.
 */
export function cleanExamples(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const e of v.slice(0, 80)) {
    if (typeof e !== 'string') continue;
    const s = cleanText(e.replace(/["`<>{}]/g, ' '), 120);
    if (s.length < 2 || isBlocked(s) || out.includes(s)) continue;
    out.push(s);
    if (out.length >= 40) break;
  }
  return out;
}

/** palpite de comando que o navegador manda junto (entre aspas no pedido à IA) */
export function cleanHint(v: unknown): string | undefined {
  const s = cleanText(String(v ?? '').replace(/["`<>{}]/g, ' '), 120);
  return s && !isBlocked(s) ? s : undefined;
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
