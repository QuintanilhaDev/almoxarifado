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

export async function chat(body: Record<string, unknown>, timeoutMs = 15000): Promise<ChatResult> {
  const base = (process.env.MAX_LLM_BASE_URL || '').replace(/\/+$/, '');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const effort = llmEffort();
    const r = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.MAX_LLM_API_KEY}` },
      body: JSON.stringify({ model: process.env.MAX_LLM_MODEL, temperature: 0.2, ...(effort ? { reasoning_effort: effort } : {}), ...body }),
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
