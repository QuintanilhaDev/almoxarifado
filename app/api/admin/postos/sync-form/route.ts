import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { currentAdmin, unauthorized } from '@/lib/auth';
import { fail, readJson, serverError } from '@/lib/http';
import { broadcast } from '@/lib/broadcast';
import { getFormFields } from '@/lib/formConfig';
import { loadPostos } from '@/lib/stockData';
import { postoKey } from '@/lib/sheetReader';

export const dynamic = 'force-dynamic';

/**
 * mode "to-form":   a lista do campo "Posto" do formulário passa a ser a dos postos cadastrados.
 * mode "from-form": cadastra como postos os nomes que já estão no campo "Posto" do formulário.
 */
export async function POST(req: Request) {
  const body = await readJson<{ mode?: string }>(req);
  const mode = body?.mode;
  if (mode !== 'to-form' && mode !== 'from-form') return fail('Ação inválida.');
  try {
    const admin = await currentAdmin();
    if (!admin) return unauthorized();
    const fields = await getFormFields();
    const idx = fields.findIndex((f) => f.system === 'posto');
    if (idx < 0) return fail('O formulário não tem o campo "Posto".', 404);

    if (mode === 'from-form') {
      const have = new Set((await loadPostos()).map((p) => postoKey(p.name)));
      const names = (fields[idx].options ?? []).map((n) => n.trim()).filter((n) => n && !have.has(postoKey(n)));
      const uniq = Array.from(new Map(names.map((n) => [postoKey(n), n] as const)).values());
      if (!uniq.length) return NextResponse.json({ added: 0 });
      const { data, error } = await db()
        .from('postos')
        .upsert(
          uniq.map((name) => ({ name: name.slice(0, 120), created_by: admin.display_name })),
          { onConflict: 'name_key', ignoreDuplicates: true },
        )
        .select('id');
      if (error) throw error;
      if (data?.length) await broadcast('postos:update', { by: admin.display_name });
      return NextResponse.json({ added: data?.length ?? 0 });
    }

    const postos = await loadPostos();
    if (!postos.length) return fail('Cadastre pelo menos um posto antes de atualizar o formulário.');
    const options = postos.map((p) => p.name).sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
    const next = fields.map((f, i) => (i === idx ? { ...f, options } : f));
    const { error } = await db()
      .from('form_config')
      .upsert({ id: 1, fields: next, updated_by: admin.display_name, updated_at: new Date().toISOString() });
    if (error) throw error;
    await broadcast('form:update', { by: admin.display_name });
    return NextResponse.json({ count: options.length });
  } catch (e) {
    return serverError(e);
  }
}
