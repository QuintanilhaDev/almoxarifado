'use client';

export class ApiError extends Error {
  status: number;
  data: Record<string, unknown>;
  constructor(message: string, status: number, data: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

/** fetch com JSON; se a sessão expirar, volta para o login. */
export async function api<T = Record<string, unknown>>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init || {};
  const r = await fetch(url, {
    cache: 'no-store',
    ...rest,
    headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(rest.headers || {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) {
    window.location.href = '/';
    throw new ApiError('Sessão expirada.', 401, data);
  }
  if (!r.ok) throw new ApiError(data.error || 'Algo deu errado. Tente de novo.', r.status, data);
  return data as T;
}
