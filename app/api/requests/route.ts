import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { fail, readJson, serverError } from '@/lib/http';
import { getFormFields } from '@/lib/almoxarifado/formConfig';
import { validateAnswers } from '@/lib/almoxarifado/validate';
import { isAuthorizedEmail } from '@/lib/almoxarifado/emails';
import { broadcast } from '@/lib/broadcast';
import { answerToText } from '@/lib/format';
import type { Attachment } from '@/lib/almoxarifado/types';

export const dynamic = 'force-dynamic';

const PATH_RE = /^([0-9a-f-]{36})\/\d{1,2}-[A-Za-z0-9._-]{1,80}$/;

export async function POST(req: Request) {
  const body = await readJson<{ values?: Record<string, unknown>; attachments?: Attachment[] }>(req);
  if (!body || typeof body.values !== 'object' || body.values === null) return fail('Requisição inválida.');

  const rawAtt = Array.isArray(body.attachments) ? body.attachments : [];
  if (rawAtt.length > 10) return fail('Envie no máximo 10 arquivos.');
  const attachments: Attachment[] = [];
  let uploadId: string | null = null;
  for (const a of rawAtt) {
    const m = PATH_RE.exec(String(a?.path || ''));
    if (!m) return fail('Anexo inválido.');
    if (uploadId && m[1] !== uploadId) return fail('Anexo inválido.');
    uploadId = m[1];
    attachments.push({
      path: String(a.path),
      name: String(a.name || 'arquivo').slice(0, 120),
      type: String(a.type || '').slice(0, 80),
      size: Math.max(0, Number(a.size) || 0),
    });
  }

  try {
    const fields = await getFormFields();
    const { ok, errors, answers } = validateAnswers(fields, body.values, attachments.length > 0);
    if (!ok) return fail('Confira os campos destacados.', 422, { errors });

    const emailField = fields.find((f) => f.system === 'email');
    const email = String(answers.find((a) => a.fieldId === emailField?.id)?.value || '');
    if (!(await isAuthorizedEmail(email)))
      return fail('Este e-mail não está autorizado. Peça ao almoxarifado para cadastrá-lo.', 403, {
        errors: { [emailField?.id || 'email']: 'E-mail não autorizado.' },
      });

    const pick = (k: string) => {
      const f = fields.find((x) => x.system === k);
      const v = answers.find((a) => a.fieldId === f?.id)?.value;
      return v === undefined ? null : answerToText(v).slice(0, 200);
    };

    const { data, error } = await db()
      .from('requests')
      .insert({
        email,
        collaborator: pick('colaborador'),
        posto: pick('posto'),
        answers: answers.filter((a) => a.fieldId !== emailField?.id),
        attachments,
      })
      .select('id, protocol, collaborator')
      .single();
    if (error) throw error;

    await broadcast('request:new', { id: data.id, protocol: data.protocol, collaborator: data.collaborator });
    return NextResponse.json({ id: data.id, protocol: data.protocol });
  } catch (e) {
    return serverError(e);
  }
}
