import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/access';
import { AccessError, fail, serverError } from '@/lib/http';
import { canHoras } from '@/lib/horas/access';
import { lerImagensComIa, lerTextoComIa } from '@/lib/horas/leitura';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Uma página por vez com a IA: { imagem: dataURL } (foto, escaneado, manuscrito) ou
 * { texto } (parte de um documento sem formato reconhecível). Devolve o que foi transcrito.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    if (!canHoras(user)) throw new AccessError(403, 'O apurador de horas extras é do RH.');
    const text = await req.text();
    if (text.length > 6_000_000) return fail('Página grande demais. Tente uma foto menor.', 413);
    let b: { imagem?: unknown; texto?: unknown };
    try {
      b = JSON.parse(text);
    } catch {
      return fail('Dados inválidos.');
    }
    const r =
      typeof b.imagem === 'string' && /^data:image\/(png|jpe?g|webp);base64,/.test(b.imagem)
        ? await lerImagensComIa([b.imagem])
        : typeof b.texto === 'string' && b.texto.trim()
          ? await lerTextoComIa(b.texto.slice(0, 14000))
          : null;
    if (!r) return fail('Mande a página (imagem) ou o texto.');
    if (r.erro || !r.lido) return fail(r.erro === 'IA não configurada' ? 'A leitura de fotos, escaneados e textos fora do padrão usa a IA da Max, que não está configurada neste servidor.' : `Não consegui ler esta parte: ${r.erro}.`, r.erro === 'IA não configurada' ? 503 : 502);
    // a tela junta as páginas e manda tudo para /analisar (as dúvidas da leitura vão junto)
    const lidos = r.lido.funcionarios.reduce((t, f) => t + f.days.length, 0);
    return NextResponse.json({ docs: r.docs, funcionarios: r.lido.funcionarios.length, dias: lidos });
  } catch (e) {
    return serverError(e);
  }
}
