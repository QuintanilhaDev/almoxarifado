import 'server-only';
import { fail } from '../http';

/** A tabela (ou as colunas novas) ainda não existe: falta rodar o supabase/fornecedores.sql */
export function missingSuppliers(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  return ['42P01', 'PGRST205', '42703', 'PGRST204'].includes(err?.code ?? '') || /does not exist|could not find the/i.test(err?.message ?? '');
}
export const suppliersSetup = () =>
  fail('O cadastro de fornecedores ainda não foi ativado no banco. Rode o arquivo supabase/fornecedores.sql no SQL Editor do Supabase.', 409, { setup: true });
