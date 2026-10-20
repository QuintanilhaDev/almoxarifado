import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/access';
import { AccessError, fail, serverError } from '@/lib/http';
import { canPontos, DEFAULT_PONTO, type PontoConfig } from '@/lib/pontos/types';
import { loadEspelho, PontoFileError } from '@/lib/pontos/load';
import { parseEspelho } from '@/lib/pontos/parse';
import { analisar } from '@/lib/pontos/analyze';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const int = (v: unknown, min: number, max: number, d: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : d;
};

/**
 * Recebe o espelho de ponto (Excel, CSV ou PDF), lê e calcula. Nada fica gravado: o arquivo
 * e o resultado só existem nesta resposta (dados pessoais dos funcionários).
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    if (!canPontos(user)) throw new AccessError(403, 'A aba Pontos não está liberada para você.');
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return fail('Não consegui receber o arquivo. Tente de novo.');
    }
    const file = form.get('file');
    if (!file || typeof file === 'string') return fail('Escolha o arquivo do espelho de ponto.');
    if (file.size === 0) return fail('O arquivo está vazio.');
    if (file.size > 4 * 1024 * 1024) return fail('O arquivo é grande demais (máximo 4 MB). Exporte um período ou um posto por vez.', 413);
    let raw: Partial<PontoConfig> = {};
    try {
      raw = JSON.parse(String(form.get('config') ?? '{}'));
    } catch {
      /* usa o padrão */
    }
    const cfg: PontoConfig = {
      escala: raw.escala === '12x36' || raw.escala === 'diaria' ? raw.escala : 'auto',
      tolerancia: int(raw.tolerancia, 0, 60, DEFAULT_PONTO.tolerancia),
      jornada: int(raw.jornada, 60, 720, DEFAULT_PONTO.jornada),
      plantao: int(raw.plantao, 360, 1440, DEFAULT_PONTO.plantao),
      intervalo: int(raw.intervalo, 0, 180, DEFAULT_PONTO.intervalo),
      interjornada: int(raw.interjornada, 0, 1440, DEFAULT_PONTO.interjornada),
      inicio: int(raw.inicio, 1, 31, DEFAULT_PONTO.inicio),
    };
    let loaded;
    try {
      loaded = await loadEspelho(Buffer.from(await file.arrayBuffer()), file.name || 'espelho');
    } catch (e) {
      if (e instanceof PontoFileError) return fail(e.message, 422);
      throw e;
    }
    const lido = parseEspelho(loaded.sheets);
    if (!lido.funcionarios.length) {
      return fail('Não achei funcionários e batidas neste arquivo. Confira se é o espelho de ponto exportado do GesOper (com as colunas de data, entrada e saída).', 422);
    }
    const analise = analisar(lido, cfg, { arquivo: file.name || 'espelho', por: user.display_name });
    analise.formato = `${loaded.tipo} (${lido.formato === 'lista' ? 'lista de batidas' : 'espelho por funcionário'})`;
    return NextResponse.json({ analise }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return serverError(e);
  }
}
