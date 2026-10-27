import { NextResponse } from 'next/server';
import { requireMaster } from '@/lib/access';
import { fail, serverError } from '@/lib/http';
import { db } from '@/lib/supabaseAdmin';
import { FardaFileError, lerControleFarda } from '@/lib/fardamento/parse';
import type { ControleFarda } from '@/lib/fardamento/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/** a planilha importada fica guardada já organizada (hub_meta), sem tabela nova no banco */
const KEY = 'fardamento_controle';

/** Controle de fardamento na Gestão (masters gerais): GET devolve as entregas; POST importa a planilha. */
export async function GET() {
  try {
    await requireMaster();
    const { data, error } = await db().from('hub_meta').select('value').eq('key', KEY).maybeSingle();
    if (error) throw error;
    const v = data?.value as ControleFarda | undefined;
    return NextResponse.json(v?.entregas ? v : { vazio: true }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    return serverError(e);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireMaster();
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return fail('Não consegui receber a planilha. Tente de novo.');
    }
    const file = form.get('file');
    if (!file || typeof file === 'string') return fail('Escolha a planilha.');
    if (file.size === 0) return fail('A planilha está vazia.');
    if (file.size > 4 * 1024 * 1024) return fail('A planilha passa de 4 MB. Apague as abas de resumo (tabelas dinâmicas) e envie de novo.', 413);
    let lido;
    try {
      lido = await lerControleFarda(Buffer.from(await file.arrayBuffer()), file.name || 'planilha.xlsx');
    } catch (e) {
      if (e instanceof FardaFileError) return fail(e.message, 422);
      throw e;
    }
    const value: ControleFarda = {
      arquivo: (file.name || 'planilha.xlsx').slice(0, 120),
      aba: lido.aba,
      importadoEm: new Date().toISOString(),
      por: user.display_name,
      avisos: lido.avisos,
      entregas: lido.entregas,
    };
    const { error } = await db().from('hub_meta').upsert({ key: KEY, value }, { onConflict: 'key' });
    if (error) throw error;
    return NextResponse.json(value, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    return serverError(e);
  }
}
