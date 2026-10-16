import 'server-only';
import { llmJson } from '../max/server/llm';
import { poLabel, poLeft, type PurchaseOrder } from '../compras/pc';

export interface AiLine {
  i: number;
  description: string;
  code: string;
  qty: number;
  unit: string;
  unit_value: number;
}
export interface AiHit {
  po_id: string;
  po_key: string;
  item_id: string;
  label: string;
  confidence: number;
}

/**
 * Último recurso para linhas que nem a equivalência, nem o código, nem o nome resolveram:
 * a IA lê a descrição do fornecedor (abreviada, com tamanho e cor misturados) e diz a qual
 * linha dos pedidos em aberto ela corresponde. É só SUGESTÃO: a pessoa confirma a ligação.
 * Sem IA configurada (MAX_LLM_*), simplesmente não sugere.
 */
export async function aiMatch(lines: AiLine[], pos: PurchaseOrder[]): Promise<Map<number, AiHit>> {
  const out = new Map<number, AiHit>();
  const refs = pos.flatMap((po) => po.items.filter((it) => it.item_id && poLeft(it) > 0).map((it) => ({ po, it })));
  if (!lines.length || !refs.length || lines.length > 60 || refs.length > 150) return out;
  const table = refs.map((r, k) => `R${k + 1} | ${poLabel(r.po.number)} | ${r.it.name}${r.it.size ? ' ' + r.it.size : ''}${r.it.brand ? ' · ' + r.it.brand : ''}${r.it.ext_code ? ' · cód. ' + r.it.ext_code : ''} | falta receber ${poLeft(r.it)} ${r.it.unit} | R$ ${r.it.unit_price.toFixed(2)}`).join('\n');
  const notes = lines.map((l) => `L${l.i + 1} | ${l.description}${l.code ? ' · cód. ' + l.code : ''} | ${l.qty} ${l.unit} | R$ ${l.unit_value.toFixed(2)}`).join('\n');
  const system = [
    'VINCULO_NF. Você confere notas fiscais de compra de uma empresa de segurança privada.',
    'Recebe as linhas de uma nota fiscal (L) e as linhas dos pedidos de compra em aberto do mesmo fornecedor (R).',
    'Para cada linha L, diga qual linha R é o MESMO produto (mesmo tipo, tamanho/numeração e cor quando informados). Abreviações de fornecedor são comuns (CAM = camisa, CALC = calça, MASC = masculino, TAM = tamanho).',
    'Quantidade e preço ajudam a desempatar, mas não mudam o produto. Se não tiver certeza, não ligue.',
    'Responda só com JSON: {"links":[{"l":1,"r":3,"confianca":0.9}]}. Omita as linhas sem correspondência.',
  ].join('\n');
  const j = await llmJson<{ links?: { l?: unknown; r?: unknown; confianca?: unknown }[] }>(system, `Linhas da nota:\n${notes}\n\nLinhas dos pedidos:\n${table}`);
  for (const x of j?.links ?? []) {
    const li = Number(x?.l) - 1;
    const r = refs[Number(x?.r) - 1];
    const conf = Number(x?.confianca);
    if (!r || !lines.some((l) => l.i === li) || !(conf >= 0.7)) continue;
    out.set(li, { po_id: r.po.id, po_key: r.it.key, item_id: r.it.item_id!, label: `${r.it.name}${r.it.size ? ' ' + r.it.size : ''}`, confidence: Math.min(conf, 0.97) });
  }
  return out;
}
