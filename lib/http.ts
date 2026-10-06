import { NextResponse } from 'next/server';

export function fail(message: string, status = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export function serverError(e: unknown) {
  console.error(e);
  return NextResponse.json(
    { error: 'Não foi possível concluir agora. Verifique a conexão com o banco e tente de novo.' },
    { status: 500 },
  );
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}
