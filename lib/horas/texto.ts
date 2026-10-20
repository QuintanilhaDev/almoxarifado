import { dropZeros, fold, marksIn, parseDate, timesIn } from '../pontos/parse';
import type { DiaLido, FuncLido, Lido } from '../pontos/types';

/**
 * Leitor simples de texto solto (sem IA): relatório de outro sistema, texto do OCR de uma foto,
 * documento digitado. Procura quem é o funcionário (rótulo "Nome:", "Funcionário:"… ou o nome
 * na própria linha) e, em cada linha com data, as batidas que vêm depois dela.
 * Serve de reserva quando a IA não está disponível; o resultado sai marcado para conferir.
 */
const DATA = /(?:^|[^\d/])(\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?|\d{4}-\d{2}-\d{2})(?![\d/])/;
const PERIODO = /(\d{1,2}\/\d{1,2}\/\d{2,4})\s*(?:a|at[eé]|-|–|à)\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i;
const NAO_DIA = /per[ií]odo|emiss[aã]o|admiss[aã]o|data de|declaro|totaliz|gerado em|impresso|compet[eê]ncia|refer[eê]ncia|nascimento|\bde \d{1,2} de [a-zç]+ de \d{4}/i;
const ROTULO_NOME = /(?:^|\s)(?:nome(?: do (?:funcion[aá]rio|colaborador))?|funcion[aá]rio|colaborador|empregado|servidor)\s*[:\-–]\s*(.+)$/i;
const ROTULO_MAT = /(?:matr[ií]cula|matr\.?|mat\.|chapa|registro|re|c[oó]d(?:igo)?\.?)\s*[:\-–]?\s*(\d{1,12})/i;
const ROTULO_CARGO = /(?:cargo|fun[cç][aã]o)\s*[:\-–]\s*([^\d:]{3,60}?)(?:\s{2,}|$|\s+(?:matr|per[ií]odo|admiss|setor|posto))/i;
const RUIDO = /espelho|relat[oó]rio|folha|ponto|per[ií]odo|empresa|cnpj|p[aá]gina|total|assinatura|declaro|data|entrada|sa[ií]da|hor[aá]rio|semana|jornada/i;

const limpaNome = (s: string) =>
  s
    .split(/\s{2,}|\t|\s+(?=(?:matr|mat\.|chapa|cargo|fun[cç][aã]o|cpf|pis|admiss|per[ií]odo|setor|posto|re\b)\b)/i)[0]
    .replace(/[^A-Za-zÀ-ÿ' .]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const pareceNome = (s: string) => {
  const n = limpaNome(s);
  const palavras = n.split(' ').filter((w) => w.length > 1);
  return palavras.length >= 2 && palavras.length <= 7 && n.length <= 80 && !RUIDO.test(n) ? n : null;
};

export function lerTextoLivre(texto: string, hoje = new Date()): Lido {
  const linhas = texto.split(/\r?\n/).map((l) => l.replace(/ /g, ' ').trimEnd());
  const hint: { from?: string; to?: string; year: number } = { year: hoje.getFullYear() };
  let periodo: Lido['periodo'] = null;
  const pm = texto.match(PERIODO);
  if (pm) {
    const a = parseDate(pm[1], hint);
    const b = parseDate(pm[2], hint);
    if (a && b && a <= b) {
      periodo = { from: a, to: b };
      Object.assign(hint, periodo);
    }
  }
  const comRotulo = linhas.some((l) => ROTULO_NOME.test(l) && pareceNome(l.match(ROTULO_NOME)![1]));
  const funcs: FuncLido[] = [];
  let cur: FuncLido | null = null;
  const novo = (name: string) => {
    const key = fold(name);
    cur = funcs.find((f) => fold(f.name) === key) ?? null;
    if (!cur) {
      cur = { name: name.toUpperCase(), matricula: null, cargo: null, posto: null, days: [] };
      funcs.push(cur);
    }
    return cur;
  };

  for (const [i, l] of linhas.entries()) {
    if (!l.trim()) continue;
    const rot = l.match(ROTULO_NOME);
    const nomeRot = rot ? pareceNome(rot[1]) : null;
    if (nomeRot) novo(nomeRot);
    const c = cur as FuncLido | null;
    if (c) {
      const mat = l.match(ROTULO_MAT);
      if (mat && !c.matricula && (nomeRot || !DATA.test(l))) c.matricula = mat[1];
      const cg = l.match(ROTULO_CARGO);
      if (cg && !c.cargo) c.cargo = cg[1].trim().toUpperCase();
    }
    if (nomeRot) continue;
    const dm = l.match(DATA);
    const date = dm && !NAO_DIA.test(l) ? parseDate(dm[1], hint) : null;
    if (!date) {
      // sem rótulo no arquivo: um nome sozinho na linha, logo antes das linhas com data
      if (!comRotulo && !/\d/.test(l)) {
        const n = pareceNome(l);
        const prox = linhas.slice(i + 1, i + 6).some((x) => DATA.test(x) && timesIn(x).length);
        if (n && prox) novo(n);
      }
      continue;
    }
    const antes = l.slice(0, dm!.index! + dm![0].length);
    const depois = l.slice(dm!.index! + dm![0].length);
    // tabela com o nome em cada linha ("JOÃO DA SILVA  21/09/2026  07:00  12:00 …")
    if (!comRotulo) {
      const n = pareceNome(antes.replace(DATA, ' '));
      if (n) novo(n);
    }
    const punches = dropZeros(timesIn(depois)).slice(0, 12);
    const marks = marksIn(depois);
    if (!punches.length && !marks.length) continue;
    const f = (cur as FuncLido | null) ?? novo('Funcionário sem nome no arquivo');
    const same = f.days.find((d) => d.date === date);
    if (same) same.punches.push(...punches.filter((p) => !same.punches.includes(p)));
    else f.days.push({ date, punches, marks, schedule: null } satisfies DiaLido);
  }
  const funcionarios = funcs.filter((f) => f.days.some((d) => d.punches.length));
  for (const f of funcionarios) f.days.sort((a, b) => a.date.localeCompare(b.date));
  if (!periodo && funcionarios.length) {
    const all = funcionarios.flatMap((f) => f.days.map((d) => d.date)).sort();
    periodo = { from: all[0], to: all[all.length - 1] };
  }
  return { funcionarios, periodo, formato: 'texto', avisos: [] };
}
