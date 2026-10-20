import 'server-only';
import { llmConfigured, llmDocJson, visionModel } from '../max/server/llm';
import { marksIn, parseDate } from '../pontos/parse';
import type { DiaLido, FuncLido, Lido } from '../pontos/types';

/**
 * Leitura com IA para o que o leitor comum não entende:
 *  - texto sem estrutura reconhecível (relatórios de outros sistemas, documentos digitados);
 *  - imagem: foto, PDF escaneado e folha de ponto escrita à mão (modelo de visão).
 * A IA só TRANSCREVE (quem, que dia, que batidas); todo cálculo é feito aqui, em minutos.
 * O que ela marcar como ilegível vira aviso para conferir.
 */

const SYSTEM = [
  'Você transcreve folhas e espelhos de ponto de funcionários (impressos, planilhas, fotos ou escritos à mão) para JSON.',
  'Extraia TODOS os funcionários e TODOS os dias, com as batidas na ordem em que aparecem (entrada, saída para o intervalo, volta do intervalo, saída).',
  'Horas no formato HH:MM de 24 horas ("7h30" = "07:30"; "19.00" = "19:00"). Datas no formato dd/mm/aaaa; se o ano não aparecer na linha, use o do cabeçalho/período.',
  'Não calcule nada e ignore colunas de totais, saldos, horas extras e assinaturas. Não invente: se um horário estiver ilegível, deixe-o de fora e marque "duvida": true no dia.',
  'Dia sem batidas com anotação (folga, falta, atestado, férias, feriado, DSR): batidas vazias e a anotação em "obs".',
  'Responda somente com JSON neste formato:',
  '{"periodo":{"de":"dd/mm/aaaa","ate":"dd/mm/aaaa"} ou null,"funcionarios":[{"nome":"NOME COMPLETO","matricula":null,"cargo":null,"posto":null,"dias":[{"data":"dd/mm/aaaa","batidas":["07:00","12:00","13:00","17:00"],"obs":null,"duvida":false}]}]}',
].join('\n');

interface IaDia {
  data?: unknown;
  batidas?: unknown;
  obs?: unknown;
  duvida?: unknown;
}
interface IaFunc {
  nome?: unknown;
  matricula?: unknown;
  cargo?: unknown;
  posto?: unknown;
  dias?: unknown;
}
export interface IaDoc {
  periodo?: { de?: unknown; ate?: unknown } | null;
  funcionarios?: unknown;
}

const str = (v: unknown, n = 120) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
const hora = (v: unknown) => {
  const m = String(v ?? '')
    .trim()
    .match(/^(\d{1,2})\s*[:hH.]\s*(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h < 24 && mi < 60 ? `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}` : null;
};

/** junta o que a IA leu (várias páginas/pedaços) num Lido, com avisos do que ficou duvidoso */
export function iaParaLido(docs: IaDoc[], today = new Date()): Lido {
  const avisos: string[] = [];
  let periodo: Lido['periodo'] = null;
  const hint: { from?: string; to?: string; year: number } = { year: today.getFullYear() };
  for (const d of docs) {
    const de = parseDate(String(d.periodo?.de ?? ''), hint);
    const ate = parseDate(String(d.periodo?.ate ?? ''), hint);
    if (de && ate && de <= ate) {
      periodo = { from: de, to: ate };
      Object.assign(hint, periodo);
      break;
    }
  }
  const byKey = new Map<string, FuncLido>();
  const duvidas: string[] = [];
  for (const d of docs) {
    for (const f of (Array.isArray(d.funcionarios) ? d.funcionarios : []) as IaFunc[]) {
      const nome = str(f.nome, 100);
      if (!nome) continue;
      const mat = str(f.matricula, 30);
      const key = mat ? `m:${mat.replace(/\D/g, '') || mat}` : `n:${nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ')}`;
      let cur = byKey.get(key);
      if (!cur) {
        cur = { name: nome.toUpperCase(), matricula: mat, cargo: str(f.cargo, 60), posto: str(f.posto, 90), days: [] };
        byKey.set(key, cur);
      }
      for (const x of (Array.isArray(f.dias) ? f.dias : []) as IaDia[]) {
        const date = parseDate(String(x.data ?? ''), hint);
        if (!date) continue;
        const punches = (Array.isArray(x.batidas) ? x.batidas : []).map(hora).filter((h): h is string => Boolean(h)).slice(0, 12);
        const obs = str(x.obs, 60);
        const day: DiaLido = { date, punches, marks: obs ? marksIn(obs) : [], schedule: null };
        const same = cur.days.find((y) => y.date === date);
        // o mesmo dia em duas páginas (cabeçalho repetido, página sobreposta): não duplica as batidas
        if (same) same.punches.push(...punches.filter((h) => !same.punches.includes(h)));
        else cur.days.push(day);
        if (x.duvida === true) duvidas.push(`${cur.name.split(' ')[0]} ${date.slice(8)}/${date.slice(5, 7)}`);
      }
    }
  }
  const funcionarios = [...byKey.values()].filter((f) => f.days.length);
  for (const f of funcionarios) f.days.sort((a, b) => a.date.localeCompare(b.date));
  if (duvidas.length) avisos.push(`A leitura ficou em dúvida em ${duvidas.length} dia(s): ${duvidas.slice(0, 12).join(', ')}${duvidas.length > 12 ? '…' : ''}. Confira esses dias no documento original.`);
  if (!periodo && funcionarios.length) {
    const all = funcionarios.flatMap((f) => f.days.map((x) => x.date)).sort();
    periodo = { from: all[0], to: all[all.length - 1] };
  }
  return { funcionarios, periodo, formato: 'ia', avisos };
}

/** texto sem estrutura reconhecível → IA (em pedaços, para caber) */
export async function lerTextoComIa(texto: string): Promise<{ lido: Lido | null; docs: IaDoc[]; erro: string | null }> {
  if (!llmConfigured()) return { lido: null, docs: [], erro: 'IA não configurada' };
  const linhas = texto.split('\n');
  const partes: string[] = [];
  let cur = '';
  for (const l of linhas) {
    if (cur.length + l.length > 12000 && cur) {
      partes.push(cur);
      cur = '';
    }
    cur += l + '\n';
  }
  if (cur.trim()) partes.push(cur);
  const docs: IaDoc[] = [];
  for (const p of partes.slice(0, 12)) {
    const r = await llmDocJson<IaDoc>({ system: SYSTEM, user: `Documento (texto extraído, pode estar desalinhado):\n\n${p}` });
    if (r.erro) return { lido: null, docs: [], erro: r.erro };
    if (r.data) docs.push(r.data);
  }
  return { lido: iaParaLido(docs), docs, erro: null };
}

/** imagens (fotos, páginas escaneadas, manuscrito) → IA de visão, uma página por vez */
export async function lerImagensComIa(imagens: string[]): Promise<{ lido: Lido | null; docs: IaDoc[]; erro: string | null }> {
  const model = visionModel();
  if (!model) return { lido: null, docs: [], erro: 'IA não configurada' };
  const docs: IaDoc[] = [];
  for (const [i, img] of imagens.slice(0, 20).entries()) {
    const r = await llmDocJson<IaDoc>({ system: SYSTEM, user: `Página ${i + 1} de ${imagens.length} de uma folha/espelho de ponto. Transcreva tudo o que estiver legível.`, images: [img], model, timeoutMs: 55000 });
    if (r.erro) return { lido: null, docs: [], erro: r.erro };
    if (r.data) docs.push(r.data);
  }
  return { lido: iaParaLido(docs), docs, erro: null };
}
