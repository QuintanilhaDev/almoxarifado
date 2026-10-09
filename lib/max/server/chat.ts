import 'server-only';

/** Chamada crua ao serviço de IA (API "chat/completions" compatível com a OpenAI). */
export interface ToolCall {
  id: string;
  type?: string;
  function: { name: string; arguments: string };
}
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}
export type ChatResult = { ok: true; message: ChatMessage } | { ok: false; status: number };

export function llmEffort(): string {
  const raw = (process.env.MAX_LLM_REASONING_EFFORT || '').trim().toLowerCase();
  return ['low', 'medium', 'high'].includes(raw) ? raw : '';
}

/**
 * Modelo reserva: entra quando o principal responde "limite atingido" (429) ou está fora do ar.
 * Na Groq cada modelo tem a sua própria cota gratuita, então a reserva praticamente dobra o fôlego.
 * MAX_LLM_FALLBACK_MODEL define outro; "off" desliga.
 */
export function fallbackModel(main: string): string | null {
  const raw = (process.env.MAX_LLM_FALLBACK_MODEL || '').trim();
  if (/^(off|0|nao|none)$/i.test(raw)) return null;
  if (raw) return raw === main ? null : raw;
  if (!/groq\.com/i.test(process.env.MAX_LLM_BASE_URL || '')) return null;
  if (main === 'openai/gpt-oss-120b') return 'openai/gpt-oss-20b';
  if (main === 'openai/gpt-oss-20b') return 'openai/gpt-oss-120b';
  return null;
}

async function once(body: Record<string, unknown>, timeoutMs: number): Promise<ChatResult> {
  const base = (process.env.MAX_LLM_BASE_URL || '').replace(/\/+$/, '');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.MAX_LLM_API_KEY}` },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      console.error('[max/ia] resposta', r.status, (await r.text().catch(() => '')).slice(0, 300));
      return { ok: false, status: r.status };
    }
    const j = (await r.json()) as { choices?: { message?: ChatMessage }[] };
    const m = j.choices?.[0]?.message;
    if (!m) return { ok: false, status: 502 };
    return { ok: true, message: { role: 'assistant', content: typeof m.content === 'string' ? m.content : null, tool_calls: Array.isArray(m.tool_calls) ? m.tool_calls : undefined } };
  } catch (e) {
    console.error('[max/ia]', (e as Error).name);
    return { ok: false, status: (e as Error).name === 'AbortError' ? 504 : 500 };
  } finally {
    clearTimeout(timer);
  }
}

export async function chat(body: Record<string, unknown>, timeoutMs = 15000): Promise<ChatResult> {
  const effort = llmEffort();
  const full = { model: process.env.MAX_LLM_MODEL, temperature: 0.2, ...(effort ? { reasoning_effort: effort } : {}), ...body };
  const first = await once(full, timeoutMs);
  if (first.ok || ![429, 500, 502, 503].includes(first.status)) return first;
  const spare = fallbackModel(String(full.model ?? ''));
  if (!spare) return first;
  const second = await once({ ...full, model: spare }, timeoutMs);
  // se a reserva também falhar, vale o motivo do principal (ex.: limite)
  return second.ok ? second : first;
}

/** Texto pronto para a voz: sem markdown, sem marcas de citação da busca, sem links. */
export function spoken(text: string, max = 900): string {
  return text
    .replace(/【[^】]*】/g, '')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_#`>|]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;!?])/g, '$1')
    .replace(/\s*\(?\b(fontes?|veja em|saiba mais em|leia mais em|links?)\s*:?\s*\)?\.?\s*$/i, '')
    .trim()
    .slice(0, max);
}
