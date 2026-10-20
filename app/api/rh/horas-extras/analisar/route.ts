import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/access';
import { AccessError, fail, serverError } from '@/lib/http';
import { canHoras } from '@/lib/horas/access';
import { DEFAULT_HORAS, apurar, type HorasConfig } from '@/lib/horas/calculo';
import { iaParaLido, type MesFolha } from '@/lib/horas/ia';
import { juntar, limparLido } from '@/lib/horas/juntar';
import { lerTextoLivre } from '@/lib/horas/texto';
import { loadEspelho, PontoFileError } from '@/lib/pontos/load';
import { parseEspelho } from '@/lib/pontos/parse';
import { llmConfigured, visionModel } from '@/lib/max/server/llm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const int = (v: unknown, min: number, max: number, d: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : d;
};
const config = (raw: Partial<HorasConfig>): HorasConfig => ({
  semanal: int(raw.semanal, 60, 80 * 60, DEFAULT_HORAS.semanal),
  diaria: int(raw.diaria, 60, 16 * 60, DEFAULT_HORAS.diaria),
  tolerancia: int(raw.tolerancia, 0, 60, DEFAULT_HORAS.tolerancia),
  inicioMes: int(raw.inicioMes, 1, 28, DEFAULT_HORAS.inicioMes),
});
const IMG = /\.(png|jpe?g|webp|gif|bmp|heic|heif|tiff?)$/i;

/**
 * Apurador de horas extras.
 *  - multipart com o arquivo: lê direto (PDF com texto, Excel, CSV…). Se o arquivo for imagem
 *    ou PDF escaneado, responde { precisaIa: 'imagem' } (a tela manda as páginas para /ler);
 *    se tiver texto mas sem formato reconhecível, { precisaIa: 'texto', partes } ;
 *  - JSON { partes: [{ nome, lido } | { nome, docs }] }: junta os arquivos (pasta inteira) e calcula;
 *    { docs } sozinho continua valendo (um documento lido pela IA).
 * Nada fica gravado.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    if (!canHoras(user)) throw new AccessError(403, 'O apurador de horas extras é do RH.');
    const ia = { texto: llmConfigured(), imagem: Boolean(visionModel()) };
    if ((req.headers.get('content-type') ?? '').includes('application/json')) {
      type ParteIn = { nome?: unknown; lido?: unknown; docs?: unknown };
      const b = (await req.json().catch(() => null)) as { docs?: unknown; partes?: ParteIn[]; nome?: unknown; config?: Partial<HorasConfig>; leitura?: unknown; mesFolha?: unknown } | null;
      const mesFolha = typeof b?.mesFolha === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(b.mesFolha) ? b.mesFolha : null;
      const mesesFolha: (MesFolha & { arquivo: string })[] = [];
      const entrada: ParteIn[] = Array.isArray(b?.partes) ? b.partes : Array.isArray(b?.docs) ? [{ nome: b.nome, docs: b.docs }] : [];
      if (!b || !entrada.length || entrada.length > 200) return fail('Dados inválidos.');
      const partes: { nome: string; lido: NonNullable<ReturnType<typeof limparLido>> }[] = [];
      for (const p of entrada) {
        const nome = String(p?.nome ?? 'documento').slice(0, 120);
        let lido;
        if (Array.isArray(p?.docs)) {
          if (p.docs.length > 40) return fail('Dados inválidos.');
          const ia = iaParaLido(p.docs as Parameters<typeof iaParaLido>[0], new Date(), mesFolha);
          mesesFolha.push(...ia.meses.map((m) => ({ ...m, arquivo: nome })));
          lido = ia;
        } else lido = limparLido(p?.lido);
        if (!lido) return fail('Dados inválidos.');
        partes.push({ nome, lido });
      }
      const lido = juntar(partes);
      if (!lido.funcionarios.some((f) => f.days.some((d) => d.punches.length))) return fail(partes.length > 1 ? 'Nenhum dos arquivos tem funcionários com dias e horários. Confira se são folhas ou espelhos de ponto legíveis.' : 'A leitura não encontrou funcionários com dias e horários neste documento. Confira se é uma folha ou espelho de ponto legível.', 422);
      const apuracao = apurar(lido, config(b.config ?? {}), { arquivo: String(b.nome ?? partes[0].nome).slice(0, 160), leitura: String(b.leitura ?? 'Lido com IA').slice(0, 80), por: user.display_name });
      // folhas sem o mês escrito: a tela mostra o mês deduzido e deixa trocar
      const semMesEscrito = mesesFolha.filter((m) => m.certeza !== 'escrito');
      return NextResponse.json({ apuracao, ia, mesesFolha: semMesEscrito }, { headers: { 'Cache-Control': 'no-store' } });
    }
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return fail('Não consegui receber o arquivo. Tente de novo.');
    }
    const file = form.get('file');
    if (!file || typeof file === 'string') return fail('Escolha o arquivo.');
    if (file.size === 0) return fail('O arquivo está vazio.');
    if (file.size > 4 * 1024 * 1024) return fail('O arquivo é grande demais (máximo 4 MB). Divida em partes.', 413);
    let raw: Partial<HorasConfig> = {};
    try {
      raw = JSON.parse(String(form.get('config') ?? '{}'));
    } catch {
      /* padrão */
    }
    const name = file.name || 'arquivo';
    if ((file.type || '').startsWith('image/') || IMG.test(name)) return NextResponse.json({ precisaIa: 'imagem', ia });
    let loaded;
    try {
      loaded = await loadEspelho(Buffer.from(await file.arrayBuffer()), name);
    } catch (e) {
      if (e instanceof PontoFileError) {
        // PDF sem texto (escaneado/foto): a tela transforma as páginas em imagem
        if (/escanead|não tem texto/i.test(e.message)) return NextResponse.json({ precisaIa: 'imagem', ia });
        return fail(e.message, 422);
      }
      throw e;
    }
    const lido = parseEspelho(loaded.sheets);
    const dias = lido.funcionarios.reduce((t, f) => t + f.days.filter((d) => d.punches.length).length, 0);
    if (lido.funcionarios.length && dias) {
      const leitura = `${loaded.tipo} lido direto`;
      const apuracao = apurar(lido, config(raw), { arquivo: name, leitura, por: user.display_name });
      // a leitura volta junto: com vários arquivos, a tela junta tudo num cálculo só
      return NextResponse.json({ apuracao, lido, leitura, ia }, { headers: { 'Cache-Control': 'no-store' } });
    }
    // tem texto, mas num formato que o leitor não reconhece: a IA estrutura (em partes)
    const texto = loaded.sheets.map((s) => s.rows.map((r) => r.filter(Boolean).join('  ')).filter(Boolean).join('\n')).join('\n\n').trim();
    if (!texto) return NextResponse.json({ precisaIa: 'imagem', ia });
    const partes: string[] = [];
    let cur = '';
    for (const l of texto.split('\n')) {
      if (cur.length + l.length > 12000 && cur) {
        partes.push(cur);
        cur = '';
      }
      cur += l + '\n';
    }
    if (cur.trim()) partes.push(cur);
    // reserva sem IA: o leitor simples de texto (se a IA falhar ou não estiver ligada, a tela usa este)
    const livre = lerTextoLivre(texto);
    const heuristico = livre.funcionarios.length ? livre : null;
    if (!ia.texto && heuristico) return NextResponse.json({ lido: heuristico, leitura: 'Texto lido sem IA (conferir)', ia });
    return NextResponse.json({ precisaIa: 'texto', partes: partes.slice(0, 20), heuristico, ia });
  } catch (e) {
    return serverError(e);
  }
}
