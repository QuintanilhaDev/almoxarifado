import 'server-only';

/** fetch com tempo limite; devolve null em qualquer falha (a Max nunca trava por causa de um serviço externo). */
export async function getJson<T>(url: string, init: RequestInit = {}, timeoutMs = 6000): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      cache: 'no-store',
      headers: { 'User-Agent': 'MaxHub/1.0 (assistente interna)', Accept: 'application/json', ...(init.headers || {}) },
    });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
