import 'server-only';
import { db } from '../supabaseAdmin';
import type { AvulsoC } from './controle';

/** EPI extras (avulsos): itens fora do kit, cada entrega com o próprio vencimento. Guardados em hub_meta. */
export const AVULSOS_KEY = 'epi_avulsos';
export async function carregarAvulsos(): Promise<AvulsoC[]> {
  const { data, error } = await db().from('hub_meta').select('value').eq('key', AVULSOS_KEY).maybeSingle();
  if (error) throw error;
  const items = (data?.value as { items?: AvulsoC[] } | null)?.items;
  return Array.isArray(items) ? items.filter((i) => i && typeof i.name === 'string').map((i) => ({ name: i.name, period_months: Number(i.period_months) || 12 })) : [];
}
