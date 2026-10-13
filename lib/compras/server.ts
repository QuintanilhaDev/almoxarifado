import 'server-only';
import { fail } from '../http';
import type { PurchaseRequest } from './types';

/** '*' para trazer também as colunas do Projeto 3 (fornecedor, previsão) quando já existirem */
export const COLS = '*';

/** A tabela ainda não existe (falta rodar o supabase/compras.sql)? */
export function missingTable(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  return err?.code === '42P01' || err?.code === 'PGRST205' || /relation .* does not exist|could not find the table/i.test(err?.message ?? '');
}
export const SETUP_MSG = 'As solicitações de compra ainda não foram ativadas no banco. Rode o arquivo supabase/compras.sql no SQL Editor do Supabase.';
export const setupFail = () => fail(SETUP_MSG, 409, { setup: true });

/** Normaliza o que vem do banco (number pode chegar como texto). */
export function toRequest(r: Record<string, unknown>): PurchaseRequest {
  return {
    ...(r as unknown as PurchaseRequest),
    number: Number(r.number),
    items: Array.isArray(r.items) ? (r.items as PurchaseRequest['items']) : [],
    history: Array.isArray(r.history) ? (r.history as PurchaseRequest['history']) : [],
  };
}
