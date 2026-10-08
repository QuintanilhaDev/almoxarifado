import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireAlmox } from '@/lib/access';
import { fail, readJson, serverError } from '@/lib/http';
import { sanitizeFields } from '@/lib/almoxarifado/validate';
import { broadcast } from '@/lib/broadcast';
import { getFormFields } from '@/lib/almoxarifado/formConfig';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireAlmox('formulario', 'view');
    const { data } = await db().from('form_config').select('updated_by, updated_at').eq('id', 1).maybeSingle();
    return NextResponse.json({ fields: await getFormFields(), meta: data ?? null });
  } catch (e) {
    return serverError(e);
  }
}

export async function PUT(req: Request) {
  const body = await readJson<{ fields?: unknown }>(req);
  const { fields, error: invalid } = sanitizeFields(body?.fields);
  if (!fields) return fail(invalid || 'Formulário inválido.');
  try {
    const admin = await requireAlmox('formulario', 'edit');
    const { error } = await db()
      .from('form_config')
      .upsert({ id: 1, fields, updated_by: admin.display_name, updated_at: new Date().toISOString() });
    if (error) throw error;
    await broadcast('form:update', { by: admin.display_name });
    return NextResponse.json({ fields });
  } catch (e) {
    return serverError(e);
  }
}
