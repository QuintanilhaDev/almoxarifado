import ExcelJS from 'exceljs';
import { MESES_ABREV, type Entrega, type Peca } from './types';

/**
 * Lê a planilha de controle de fardamento. Procura sozinha a aba com as entregas (a que tem
 * as colunas Funcionário e Data de Entrega) e entende as colunas pelos títulos:
 *   Empresa · Data de Solicitação · Solicitante · Funcionário · Função · Posto · mês/ano ·
 *   Data de Entrega · e os pares "peça + QTD" (CAMISA MC / QTD MC, CALÇA / QTD CALÇA,
 *   CALÇADOS / QTD CALÇADOS, ITENS A / QTD A …).
 * As abas de resumo (tabelas dinâmicas) são ignoradas: tudo é recalculado a partir das entregas.
 */

export class FardaFileError extends Error {}

const fold = (v: unknown) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
const limpa = (v: unknown) =>
  String(v ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–.]+|[\s\-–]+$/g, '')
    .trim();
const vazio = (v: unknown) => {
  const s = limpa(v);
  return !s || /^[-–_.0]+$/.test(s) || /^(n\/?a|nao|não|x)$/i.test(s);
};

/** valor da célula do exceljs: texto, número, data, fórmula, rich text… */
function valor(c: ExcelJS.CellValue): unknown {
  if (c === null || c === undefined) return null;
  if (c instanceof Date) return c;
  if (typeof c === 'object') {
    const o = c as {
      result?: unknown;
      richText?: { text: string }[];
      text?: unknown;
      error?: unknown;
    };
    if ('error' in o && o.error) return null;
    if ('result' in o) return o.result instanceof Date ? o.result : (o.result ?? null);
    if (o.richText) return o.richText.map((r) => r.text).join('');
    if ('text' in o) return o.text;
    return null;
  }
  return c;
}

const iso = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
/** data da célula: Date, número de série do Excel ou texto dd/mm/aaaa */
function data(v: unknown): string | null {
  if (v instanceof Date) {
    const y = v.getUTCFullYear();
    return y >= 2000 && y <= 2100 ? iso(v) : null;
  }
  if (typeof v === 'number' && v > 36000 && v < 80000) return iso(new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000));
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const d = new Date(Date.UTC(y, Number(m[2]) - 1, Number(m[1])));
    return d.getUTCDate() === Number(m[1]) && y >= 2000 && y <= 2100 ? iso(d) : null;
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
/** "jan/25", "janeiro/2025", 01/2025 ou uma data → AAAA-MM */
function mesAno(v: unknown): string | null {
  const d = data(v);
  if (d) return d.slice(0, 7);
  const s = fold(v);
  let m = s.match(/^([a-zç]{3})[a-zç]*[/ -](\d{2,4})$/);
  if (m) {
    const i = MESES_ABREV.indexOf(m[1]);
    const y = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
    return i >= 0 && y >= 2000 && y <= 2100 ? `${y}-${String(i + 1).padStart(2, '0')}` : null;
  }
  m = s.match(/^(\d{1,2})[/-](\d{4})$/);
  return m && Number(m[1]) >= 1 && Number(m[1]) <= 12 ? `${m[2]}-${m[1].padStart(2, '0')}` : null;
}
function qtd(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 && v < 1000 ? Math.round(v) : null;
  const m = String(v ?? '').match(/\d+/);
  const n = m ? Number(m[0]) : NaN;
  return n > 0 && n < 1000 ? n : null;
}

const EMPRESAS: [RegExp, string][] = [
  [/max ?servi/, 'Max Serviços'],
  [/max ?forte/, 'Max Forte'],
  [/max ?confi/, 'Max Confiável'],
];
const empresa = (v: unknown) => {
  const f = fold(v);
  for (const [re, nome] of EMPRESAS) if (re.test(f)) return nome;
  return limpa(v).toUpperCase() || 'Não informada';
};
const titulo = (s: string) =>
  s
    .toLowerCase()
    .replace(/(^|[\s/(-])([a-zà-ÿ])/g, (_, a: string, b: string) => a + b.toUpperCase())
    .replace(/\b(De|Da|Do|Das|Dos|E|Com|C\/)\b/g, (w) => w.toLowerCase())
    .replace(/\b(Mc|Ml|Pvc|Uv|Asg|Epi)\b/g, (w) => w.toUpperCase());

type Col = 'empresa' | 'solic' | 'solicitante' | 'func' | 'funcao' | 'posto' | 'mes' | 'entrega';
function campo(h: string): Col | null {
  const f = fold(h).replace(/[.:]/g, '');
  if (/^empresa$|^filial$/.test(f)) return 'empresa';
  if (/data (de |da )?solicita/.test(f)) return 'solic';
  if (/^solicitante|^solicitado por|^requisitante/.test(f)) return 'solicitante';
  if (/^(funcionario|colaborador|nome)( do funcionario)?$/.test(f)) return 'func';
  if (/^(funcao|cargo)$/.test(f)) return 'funcao';
  if (/^(posto|cliente|local|posto de trabalho)$/.test(f)) return 'posto';
  if (/^mes ?\/ ?ano$|^mes$|^competencia$|^referencia$/.test(f)) return 'mes';
  if (/data (de |da )?entrega|^entregue em$/.test(f)) return 'entrega';
  return null;
}
/** coluna de peça (a próxima coluna "QTD …" é a quantidade dela) */
function pecaDe(h: string): { tipo: 'fixa'; nome: string } | { tipo: 'calcado' } | { tipo: 'livre' } | null {
  const f = fold(h).replace(/\./g, '');
  if (!f || /^qtd|^quant/.test(f)) return null;
  if (/^calcados?$|^calçados?$/.test(f)) return { tipo: 'calcado' };
  if (/^(itens?|acessorios?|outros?|epi)\b/.test(f)) return { tipo: 'livre' };
  if (/^cam(isa)? ?mc$|manga curta/.test(f)) return { tipo: 'fixa', nome: 'Camisa MC' };
  if (/^cam(isa)? ?ml$|manga longa/.test(f)) return { tipo: 'fixa', nome: 'Camisa ML' };
  if (/^cam(isa)? ?soc/.test(f)) return { tipo: 'fixa', nome: 'Camisa social' };
  if (/^cam(isa)? ?asg/.test(f)) return { tipo: 'fixa', nome: 'Camisa ASG' };
  if (/^cam(isa)? ?uv/.test(f)) return { tipo: 'fixa', nome: 'Camisa UV' };
  if (/^cam(isa)? ?polo|^polo/.test(f)) return { tipo: 'fixa', nome: 'Camisa polo' };
  if (/^calca/.test(f)) return { tipo: 'fixa', nome: 'Calça' };
  if (/^(camisa|camiseta|bermuda|jaqueta|japona|colete|blus)/.test(f)) return { tipo: 'fixa', nome: titulo(limpa(h)) };
  return null;
}
const NOMES_CALCADO: [RegExp, string][] = [
  [/^anti/, 'Antiderrapante'],
  [/^(sap(ato)?\.? ?)?social$/, 'Sapato social'],
  [/^botina/, 'Botina'],
  [/^bota (de )?pvc|^bota de borracha|^galocha/, 'Bota de PVC'],
  [/sete leguas|^7 leguas|^bota 7/, 'Bota sete léguas'],
  [/^bota/, 'Bota'],
  [/^sapato/, 'Sapato'],
  [/^tenis/, 'Tênis'],
  [/^coturno/, 'Coturno'],
];
/** "BOTINA 40" → ["Botina", "40"]; "BONÉ" → ["Boné", null]; "CAMISA ML G" → ["Camisa ML", "G"] */
function separa(texto: string, calcado: boolean): [string, string | null] {
  const s = limpa(texto);
  let nome = s;
  let tam: string | null = null;
  const m = s.match(/^(.*?)(?:\s+n[ºo°]\.?)?[\s-]*(\d{2})$/i);
  if (m && m[1].trim()) {
    nome = m[1].trim();
    tam = m[2];
  } else {
    const l = s.match(/^(.*?)\s+(PP|P|M|G|GG|XG|EXG|EXGG|G\d)$/);
    if (l && l[1].trim().length > 3) {
      nome = l[1].trim();
      tam = l[2];
    }
  }
  const f = fold(nome);
  if (calcado || /^(botina|bota|sapato|sap\.|tenis|coturno|anti|sete leguas)/.test(f)) for (const [re, n] of NOMES_CALCADO) if (re.test(f)) return [n, tam];
  for (const [re, n] of ACESSORIOS) if (re.test(chaveNome(nome))) return [n, tam];
  return [calcado ? titulo(nome) || 'Calçado' : titulo(nome), tam];
}
/** chave para juntar grafias diferentes do mesmo item (acento, espaço, barra, ponto) */
export const chaveNome = (s: string) => fold(s).replace(/[^a-z0-9]/g, '');
/** nomes usados na planilha com grafias diferentes → um nome só */
const ACESSORIOS: [RegExp, string][] = [
  [/^apitoc?(om)?fi[e]?l$/, 'Apito com fiel'],
  [/^apitoc?(om)?cord(a|ã)o$/, 'Apito com cordão'],
  [/^apito$/, 'Apito'],
  [/^(cinto)?social(cinto)?$|^cintosocial$/, 'Cinto social'],
  [/^cintoniquelado$/, 'Cinto niquelado'],
  [/^oculos?de?pro?t?e?r?t?ecao$|^oculos$/, 'Óculos de proteção'],
  [/^portatonfa$/, 'Porta-tonfa'],
  [/^capadecolete$/, 'Capa de colete'],
  [/^capadechuva$/, 'Capa de chuva'],
  [/^capadechuvamoto$/, 'Capa de chuva (moto)'],
  [/^mascaradescartavel$/, 'Máscara descartável'],
  [/^luvalatex$/, 'Luva de látex'],
  [/^bone$/, 'Boné'],
];
const tamanho = (v: unknown): string | null => {
  if (typeof v === 'number') return String(v);
  const s = limpa(v)
    .toUpperCase()
    .replace(/^ESP\s+/, 'ESP');
  return s || null;
};

export interface LidoFarda {
  aba: string;
  entregas: Entrega[];
  avisos: string[];
}

export async function lerControleFarda(buf: Buffer | ArrayBuffer, nome = 'planilha.xlsx'): Promise<LidoFarda> {
  if (!/\.xlsx$|\.xlsm$/i.test(nome)) throw new FardaFileError('Envie a planilha em Excel (.xlsx).');
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as ArrayBuffer);
  } catch {
    throw new FardaFileError('Não consegui abrir esta planilha. Salve de novo no Excel como .xlsx e tente outra vez.');
  }
  // TODAS as abas com entregas (cabeçalho com Funcionário e mais duas colunas conhecidas):
  // ex.: uma aba por ano ou por empresa. Resumos e tabelas dinâmicas ficam de fora.
  const abas: { ws: ExcelJS.Worksheet; linha: number }[] = [];
  const ignoradas: string[] = [];
  for (const ws of wb.worksheets) {
    let melhor: { linha: number; nota: number } | null = null;
    for (let r = 1; r <= Math.min(15, ws.actualRowCount + 5); r++) {
      const cols = new Set<Col>();
      ws.getRow(r).eachCell((c) => {
        const k = campo(String(valor(c.value) ?? ''));
        if (k) cols.add(k);
      });
      const nota = cols.size + (cols.has('entrega') ? 2 : 0);
      if (cols.has('func') && cols.size >= 3 && (!melhor || nota > melhor.nota)) melhor = { linha: r, nota };
    }
    if (melhor) abas.push({ ws, linha: melhor.linha });
    else if (ws.actualRowCount > 0) ignoradas.push(ws.name);
  }
  if (!abas.length) throw new FardaFileError('Não encontrei nenhuma aba com as entregas (precisa ter as colunas Funcionário, Posto e Data de Entrega).');
  const entregas: Entrega[] = [];
  const vistos = new Map<string, number>();
  let semData = 0;
  let semQtd = 0;
  let repetidas = 0;
  const lidas: { nome: string; n: number }[] = [];
  for (const { ws, linha } of abas) {
    const head: { col: number; texto: string }[] = [];
    ws.getRow(linha).eachCell((c, col) => head.push({ col, texto: String(valor(c.value) ?? '') }));
    const fixo = new Map<Col, number>();
    const pecas: { col: number; qcol: number | null; def: NonNullable<ReturnType<typeof pecaDe>> }[] = [];
    for (const [k, h] of head.entries()) {
      const c = campo(h.texto);
      if (c && !fixo.has(c)) {
        fixo.set(c, h.col);
        continue;
      }
      const p = pecaDe(h.texto);
      if (p) {
        const prox = head[k + 1];
        pecas.push({ col: h.col, qcol: prox && /^qtd|^quant/i.test(fold(prox.texto)) ? prox.col : null, def: p });
      }
    }
    let n = 0;
    const ultima = ws.actualRowCount + 50;
    let vazias = 0;
    for (let r = linha + 1; r <= Math.min(ws.rowCount, 200_000); r++) {
      const row = ws.getRow(r);
      const get = (c: Col) => (fixo.has(c) ? valor(row.getCell(fixo.get(c)!).value) : null);
      const func = limpa(get('func')).toUpperCase();
      if (!func || /^total/i.test(func)) {
        if (++vazias > 400 && r > ultima) break;
        continue;
      }
      vazias = 0;
      const d = data(get('entrega'));
      const s = data(get('solic'));
      const m = d?.slice(0, 7) ?? mesAno(get('mes')) ?? s?.slice(0, 7) ?? null;
      if (!m) {
        semData++;
        continue;
      }
      const itens: Peca[] = [];
      for (const p of pecas) {
        const v = valor(row.getCell(p.col).value);
        if (vazio(v) && !(typeof v === 'number' && v > 0)) continue;
        let q = p.qcol ? qtd(valor(row.getCell(p.qcol).value)) : 1;
        if (q === null) {
          // peça marcada sem quantidade: conta 1 e avisa
          semQtd++;
          q = 1;
        }
        if (p.def.tipo === 'fixa') itens.push([p.def.nome, tamanho(v), q]);
        else {
          const [nome, tam] = separa(String(v), p.def.tipo === 'calcado');
          if (nome) itens.push([nome, tam, q]);
        }
      }
      const e: Entrega = {
        e: empresa(get('empresa')),
        s,
        q: limpa(get('solicitante')).toUpperCase() || 'Não informado',
        f: func,
        fn: limpa(get('funcao')).toUpperCase() || 'Não informada',
        p: limpa(get('posto')).toUpperCase() || 'Não informado',
        d,
        m,
        i: itens,
      };
      // a mesma entrega copiada em duas abas (ex.: "2026" e "TODAS") conta uma vez só
      const chave = `${fold(e.f)}|${e.d ?? e.m}|${fold(e.p)}|${JSON.stringify(e.i)}`;
      const de = vistos.get(chave);
      if (de !== undefined && de !== lidas.length) {
        repetidas++;
        continue;
      }
      vistos.set(chave, lidas.length);
      entregas.push(e);
      n++;
    }
    lidas.push({ nome: ws.name, n });
  }
  unificaNomes(entregas);
  if (!entregas.length) throw new FardaFileError(`${abas.length > 1 ? 'As abas' : 'A aba'} ${abas.map((a) => `"${a.ws.name}"`).join(', ')} não têm entregas preenchidas.`);
  const avisos: string[] = [];
  const comDados = lidas.filter((l) => l.n);
  if (comDados.length > 1) avisos.push(`Entregas lidas de ${comDados.length} abas: ${comDados.map((l) => `${l.nome} (${l.n})`).join(', ')}.`);
  if (repetidas) avisos.push(`${repetidas} entrega(s) repetidas em mais de uma aba foram contadas uma vez.`);
  if (semData) avisos.push(`${semData} linha(s) sem data de entrega nem mês ficaram de fora.`);
  if (semQtd) avisos.push(`${semQtd} peça(s) estavam sem quantidade e foram contadas como 1.`);
  const semPeca = entregas.filter((e) => !e.i.length).length;
  if (semPeca) avisos.push(`${semPeca} entrega(s) sem nenhuma peça preenchida (contam como entrega, sem peças).`);
  return { aba: comDados.map((l) => l.nome).join(' + ') || abas[0].ws.name, entregas, avisos };
}

function distancia(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[b.length];
}
/** erros de digitação ("Luva Pgimentada", "Capa de Cuva", "Palitó"): junta com o nome mais usado e parecido */
function unificaNomes(entregas: Entrega[]) {
  const cont = new Map<string, number>();
  for (const e of entregas) for (const i of e.i) cont.set(i[0], (cont.get(i[0]) ?? 0) + 1);
  // mesma chave (acento, espaço, maiúscula): fica a grafia mais usada
  const porChave = new Map<string, string>();
  for (const [n, c] of [...cont].sort((a, b) => b[1] - a[1])) if (!porChave.has(chaveNome(n))) porChave.set(chaveNome(n), n);
  const nomes = [...cont].sort((a, b) => b[1] - a[1]);
  const troca = new Map<string, string>();
  for (const [n, c] of nomes) {
    const k = chaveNome(n);
    let alvo = porChave.get(k)!;
    if (alvo === n && k.length >= 5) {
      const maior = nomes.find(([m, cm]) => cm > c * 2 && m !== n && chaveNome(m).length >= 5 && distancia(chaveNome(m), k) <= (k.length >= 9 ? 2 : 1));
      if (maior) alvo = troca.get(maior[0]) ?? maior[0];
    }
    if (alvo !== n) troca.set(n, alvo);
  }
  if (!troca.size) return;
  for (const e of entregas) for (const i of e.i) i[0] = troca.get(i[0]) ?? i[0];
}
