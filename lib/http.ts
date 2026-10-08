import { NextResponse } from 'next/server';

/** Erro de acesso (401/403) lançado pelos "require…" de lib/access.ts. */
export class AccessError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function fail(message: string, status = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export function serverError(e: unknown) {
  if (e instanceof AccessError) return fail(e.message, e.status);
  console.error(e);
  return NextResponse.json(
    { error: 'Não foi possível concluir agora. Verifique a conexão com o banco e tente de novo.' },
    { status: 500 },
  );
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T | null> {
  try {
    const v = await req.json();
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as T) : null;
  } catch {
    return null;
  }
}
