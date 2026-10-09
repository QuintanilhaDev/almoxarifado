import 'server-only';
import { db } from '../supabaseAdmin';
import { DEFAULT_FIELDS } from './defaultForm';
import type { FormField } from './types';

export async function getFormFields(): Promise<FormField[]> {
  const { data, error } = await db().from('form_config').select('fields').eq('id', 1).maybeSingle();
  if (error) throw error;
  const fields = (data?.fields as FormField[] | undefined) ?? null;
  return Array.isArray(fields) && fields.length ? fields : DEFAULT_FIELDS;
}
