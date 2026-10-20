import 'server-only';
import { llmConfigured, llmDocJson, visionModel } from '../max/server/llm';
import { iaParaLido, SYSTEM, type IaDoc } from './ia';
import type { Lido } from '../pontos/types';

export { iaParaLido, type IaDoc };

/**
 * Leitura com IA para o que o leitor comum não entende (texto solto, foto, escaneado, manuscrito).
 * A IA só transcreve; a montagem e o cálculo ficam em ./ia.ts e ./calculo.ts.
 */
type Resultado = { lido: Lido | null; docs: IaDoc[]; erro: string | null; espera?: number };

/** texto sem estrutura reconhecível → IA (em pedaços, para caber na cota por minuto) */
export async function lerTextoComIa(texto: string): Promise<Resultado> {
  if (!llmConfigured()) return { lido: null, docs: [], erro: 'IA não configurada' };
  const partes: string[] = [];
  let cur = '';
  for (const l of texto.split('\n')) {
    if (cur.length + l.length > 7000 && cur) {
      partes.push(cur);
      cur = '';
    }
    cur += l + '\n';
  }
  if (cur.trim()) partes.push(cur);
  const docs: IaDoc[] = [];
  for (const p of partes.slice(0, 4)) {
    const r = await llmDocJson<IaDoc>({ system: SYSTEM, user: `Documento (texto extraído, pode estar desalinhado):\n\n${p}`, maxTokens: 3500 });
    if (r.erro) return { lido: null, docs: [], erro: r.erro, espera: r.espera };
    if (r.data) docs.push(r.data);
  }
  return { lido: iaParaLido(docs), docs, erro: null };
}

/** imagens (fotos, páginas escaneadas, manuscrito) → IA de visão, uma página por vez */
export async function lerImagensComIa(imagens: string[]): Promise<Resultado> {
  const model = visionModel();
  if (!model) return { lido: null, docs: [], erro: 'IA não configurada' };
  const docs: IaDoc[] = [];
  for (const [i, img] of imagens.slice(0, 20).entries()) {
    const r = await llmDocJson<IaDoc>({ system: SYSTEM, user: `Página ${i + 1} de ${imagens.length} de uma folha/espelho de ponto. Transcreva tudo o que estiver legível.`, images: [img], model, maxTokens: 2500, timeoutMs: 55000 });
    if (r.erro) return { lido: null, docs: [], erro: r.erro, espera: r.espera };
    if (r.data) docs.push(r.data);
  }
  return { lido: iaParaLido(docs), docs, erro: null };
}
