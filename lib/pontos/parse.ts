import type { DiaLido, FuncLido, Lido } from './types';

/**
 * Leitor do espelho de ponto (GesOper e parecidos), sem depender de um layout fixo:
 *
 *  - "espelho": um bloco por funcionário ("Funcionário: FULANO  Matrícula: 123"), com a
 *    linha de cabeçalho (Data, Entrada, Saída…) e uma linha por dia;
 *  - "lista": uma tabela só, com as colunas Nome, Data e as batidas em cada linha.
 *
 * As colunas de batida são achadas pelo cabeçalho (Entrada/Saída/E1/S1/Marcações). As de
 * totais (Trabalhadas, Extras, Atraso, Saldo…) nunca viram batida. O horário previsto
 * (Horário/Escala) é guardado para calcular atraso. Sem cabeçalho, vale todo HH:MM da linha.
 * Para PDF, cada texto vem com a posição x: a coluna é a do cabeçalho mais próximo.
 */

export interface Sheet {
  name: string;
  rows: string[][];
  /** posição x de cada célula (PDF) */
  xs?: number[][];
}

export const fold = (s: unknown) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const TIME_G = /(?<![\d:])([01]?\d|2[0-3])[:hH]([0-5]\d)(?::[0-5]\d)?(?![\d:])/g;
const DATE_RE = /(?<!\d)(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?(?!\d)|(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/;

/** marcações de dia sem batida que o espelho costuma trazer */
const MARKS: [RegExp, string][] = [
  [/\bfolga\b|\bdsr\b|descanso semanal|\bd\.?s\.?r\b/, 'FOLGA'],
  [/\bferias\b/, 'FÉRIAS'],
  [/justific/, 'JUSTIFICADA'],
  [/atestado|licen[cç]a medica|\bmedico\b/, 'ATESTADO'],
  [/\bfalta\b(?! de)|\bausente\b|\bausencia\b/, 'FALTA'],
  [/\bferiado\b/, 'FERIADO'],
  [/\babon/, 'ABONO'],
  [/afastad|\binss\b|auxilio/, 'AFASTAMENTO'],
  [/licenca|licen[cç]a/, 'LICENÇA'],
  [/compensa/, 'COMPENSAÇÃO'],
  [/suspens/, 'SUSPENSÃO'],
  [/treinamento|curso|reciclagem/, 'TREINAMENTO'],
  [/\bdemitid|\bdesligad|rescis/, 'DESLIGADO'],
  [/\badmiss/, 'ADMISSÃO'],
];
/** marcas que justificam o dia sem batida */
export const JUSTIFICA = new Set(['JUSTIFICADA', 'FOLGA', 'FÉRIAS', 'ATESTADO', 'FERIADO', 'ABONO', 'AFASTAMENTO', 'LICENÇA', 'COMPENSAÇÃO', 'SUSPENSÃO', 'TREINAMENTO', 'DESLIGADO', 'ADMISSÃO']);

const LABEL_NAME = /^(?:nome(?: do)?(?: funcionario| colaborador| empregado)?|funcionario|colaborador|empregado|vigilante|servidor|trabalhador)(?:\s*[:\-–]\s*|\s+|$)(.*)$/;
const LABEL_MAT = /^(?:matricula|matr\.?|mat\.?|chapa|registro|re|cod(?:igo)?(?: do funcionario)?|n[ºo°]? ?func(?:ionario)?|cracha|pis)(?:\s*[:\-–]\s*|\s+|$)(.*)$/;
const LABEL_POSTO = /^(?:posto(?: de trabalho| de servico)?|local(?: de trabalho)?|lotacao|cliente|centro de custo|departamento|unidade|setor|empresa\/posto)(?:\s*[:\-–]\s*|\s+|$)(.*)$/;
const LABEL_CARGO = /^(?:cargo|funcao)(?:\s*[:\-–]\s*|\s+|$)(.*)$/;
/** dia da semana colado na data ("21/08-Sex", "21/08 sexta-feira", "21/08Sex") */
const WEEKDAY = '(?:dom(?:ingo)?|seg(?:unda)?|ter(?:[cç]a)?|qua(?:rta)?|qui(?:nta)?|sex(?:ta)?|s[aá]b(?:ado)?)(?:-feira)?\\.?';
const DATE_HEAD = new RegExp(`^\\s*(?:\\d{1,2}[/.-]\\d{1,2}(?:[/.-]\\d{2,4})?|\\d{4}-\\d{2}-\\d{2})(?:\\s*[-–,]?\\s*${WEEKDAY})?`, 'i');
const START_DATE = new RegExp(DATE_HEAD.source + '\\s*\\S', 'i');
const LABEL_EMPRESA = /^(?:empresa|filial|razao social|empregador)(?:\s*[:\-–]\s*|\s+|$)(.*)$/;
/** linhas de cabeçalho/rodapé que têm data mas não são dia do espelho */
const NOT_DAY = /per[ií]odo|emiss[aã]o|admiss[aã]o|data de|declaro|totaliz|gerado em|impresso|compet[eê]ncia|refer[eê]ncia|\bde \d{1,2} de [a-zç]+ de \d{4}/i;
/** textos da linha que não são cliente/posto */
const NOT_LOCAL = /ponto eletr|eletronico|manual|biometr|aplicativo|\bapp\b|ajust|rubrica|visto|digital|facial|reconhec|^(sim|nao|n[aã]o|ok)$|^(dom|seg|ter|qua|qui|sex|sab)\.?$|^(domingo|segunda|terca|quarta|quinta|sexta|sabado)/i;

type Col = 'date' | 'punch' | 'multi' | 'schedule' | 'name' | 'mat' | 'posto' | 'cargo' | 'systrab' | 'sysdif' | 'skip' | 'other';
function headerKind(h: string): Col | null {
  const f = fold(h).replace(/[.:]/g, '');
  if (!f) return null;
  if (/realizad|registrad|^ent interv|^entrada (e )?saida$|^ent saida$/.test(f)) return 'multi';
  if (/^(hr|hrs|horas?) (dia|trab(alhadas?)?)$|^trabalhad[oa]s?$|^horas trab$/.test(f)) return 'systrab';
  if (/^(horas? )?dif(erenca)?$|^saldo( do dia)?$/.test(f)) return 'sysdif';
  if (/^(data|dia|dt|date)( do ponto| da marcacao)?$|^data\/dia$|^dia\/data$/.test(f)) return 'date';
  if (/^(nome|funcionario|colaborador|empregado)( do funcionario| do colaborador)?$/.test(f)) return 'name';
  if (/^(matricula|matr|mat|chapa|registro|re|codigo|cod|cracha)$/.test(f)) return 'mat';
  if (/^(posto|local|lotacao|cliente|centro de custo|unidade|setor|departamento)( de trabalho)?$/.test(f)) return 'posto';
  if (/^(cargo|funcao)$/.test(f)) return 'cargo';
  if (/trab|extra|atras|falt|noturn|total|saldo|debit|credit|banco|\bbh\b|abon|adicional|hora[s]? (normais|diurn)|carga|dsr|desconto|observ|justif|ocorr|situac|status|motivo|evento|interval[o]? (prev|total)|h\.? ?ext|h\.? ?not|hn\b|he\b/.test(f)) return 'skip';
  if (/horario|escala|jornada|previst|programad|turno/.test(f)) return 'schedule';
  if (/^(marcacoes|marcacao|batidas|registros|pontos|marcacoes realizadas|horarios registrados)$/.test(f)) return 'multi';
  if (/^(e|s|ent|sai|entrada|saida|entr|said|in|out)\s*\d?$|^\d[ªaº°o]? ?(entrada|saida|ent|sai)$|^(entrada|saida|ent|sai)\.? ?\d[ªaº°o]?$|^(entrada|saida) (inicial|final|almoco|intervalo|refeicao)|^(inicio|fim|retorno|volta|ida) (intervalo|almoco|refeicao|jornada)|^(intervalo|almoco|refeicao)( (inicio|fim|saida|volta|retorno))?$|^(inicio|fim|retorno)$/.test(f)) return 'punch';
  if (/dia da semana|semana|^sem$/.test(f)) return 'other';
  return null;
}

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const validDate = (y: number, m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= 31 && new Date(Date.UTC(y, m - 1, d)).getUTCDate() === d;

/** "21/09/2026", "21/09/26", "2026-09-21", "21/09" (ano vem do período) */
export function parseDate(s: string, yearHint: { from?: string; to?: string; year: number }): string | null {
  const m = String(s).match(DATE_RE);
  if (!m) return null;
  let y: number;
  let mo: number;
  let d: number;
  if (m[4]) {
    y = Number(m[4]);
    mo = Number(m[5]);
    d = Number(m[6]);
  } else {
    d = Number(m[1]);
    mo = Number(m[2]);
    if (m[3]) y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    else {
      // sem ano: o do período (o mês que cai entre o início e o fim)
      const from = yearHint.from;
      const to = yearHint.to;
      y = yearHint.year;
      if (from && to) {
        const yf = Number(from.slice(0, 4));
        const yt = Number(to.slice(0, 4));
        y = yf === yt ? yf : mo >= Number(from.slice(5, 7)) ? yf : yt;
      }
    }
  }
  return validDate(y, mo, d) && y >= 2000 && y <= 2100 ? iso(y, mo, d) : null;
}

export function timesIn(s: string): string[] {
  const out: string[] = [];
  for (const m of String(s).matchAll(TIME_G)) out.push(`${m[1].padStart(2, '0')}:${m[2]}`);
  return out;
}

/** "00:00" no espelho é campo vazio (o GesOper preenche assim o que não foi batido) */
export function dropZeros(ps: string[]): string[] {
  const z = ps.filter((p) => p === '00:00').length;
  if (!z) return ps;
  if (z === ps.length || z >= 2) return ps.filter((p) => p !== '00:00');
  // um só 00:00: vale como saída à meia-noite se fecha um turno da noite
  const i = ps.indexOf('00:00');
  const prev = ps[i - 1];
  return i === ps.length - 1 && prev && Number(prev.slice(0, 2)) >= 16 ? ps : ps.filter((p) => p !== '00:00');
}

/** "11,03" (11h03) e "-0,05" (−5 min): horas no formato do sistema de ponto */
const HHMM_NUM = /^(-?)(\d{1,3}),(\d{2})$/;
const hhmmNum = (s: string) => {
  const m = s.trim().match(HHMM_NUM);
  if (!m || Number(m[3]) >= 60) return null;
  return (m[1] ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
};

export function marksIn(s: string): string[] {
  const f = fold(s);
  if (!f) return [];
  const out: string[] = [];
  for (const [re, tag] of MARKS) if (re.test(f) && !out.includes(tag)) out.push(tag);
  return out;
}

const cleanName = (s: string) =>
  s
    .replace(/\s{2,}.*$/, (x) => (/(matr|chapa|cargo|fun[cç]|posto|admiss|pis|cpf|re:)/i.test(x) ? '' : x))
    .replace(/\b(matr[ií]cula|chapa|cargo|fun[cç][aã]o|posto|admiss[aã]o|pis|cpf)\b.*$/i, '')
    .replace(/^[\d\s.\-–:]+(?=[A-Za-zÀ-ú])/, '')
    .replace(/[:\-–|]+$/, '')
    .trim();

/** acha "Rótulo: valor" numa linha (rótulo e valor na mesma célula ou na célula seguinte) */
function labelled(row: string[], re: RegExp): string | null {
  for (let i = 0; i < row.length; i++) {
    const cell = row[i];
    if (!cell) continue;
    // várias informações na mesma célula/linha (PDF): "Funcionário: JOÃO  Matrícula: 123"
    // sem acento e minúsculo, mas com o mesmo tamanho do original (para recortar o valor)
    const f = cell.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trimStart();
    const m = f.match(re);
    if (!m) continue;
    const startAt = cell.trimStart().length - m[1].length + (cell.length - cell.trimStart().length);
    let v = m[1] ? cell.slice(Math.max(0, startAt)).trim() : '';
    if (!v) v = (row.slice(i + 1).find((x) => x && x.trim()) ?? '').trim();
    const hk = v ? headerKind(v) : null;
    if (v && (!hk || hk === 'other' || hk === 'posto' || hk === 'cargo' || hk === 'skip')) return v;
  }
  return null;
}

function findInline(text: string, re: RegExp): string | null {
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

const MAX_DAYS = 400;

/** monta os funcionários e os dias a partir das planilhas (ou linhas do PDF) */
export function parseEspelho(sheets: Sheet[], today = new Date()): Lido {
  const avisos: string[] = [];
  // período citado no arquivo ("Período: 21/09/2026 a 20/10/2026")
  let periodo: { from: string; to: string } | null = null;
  const yearHint: { from?: string; to?: string; year: number } = { year: today.getFullYear() };
  for (const sh of sheets) {
    for (const row of sh.rows.slice(0, 400)) {
      const t = row.join(' ');
      const m = t.match(/(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})\s*(?:a|à|até|ate|-|–|ao)\s*(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})/i);
      if (m && /per[ií]odo|apura|compet|refer|de\s/i.test(t)) {
        const a = parseDate(m[1], yearHint);
        const b = parseDate(m[2], yearHint);
        if (a && b && a <= b) {
          periodo = { from: a, to: b };
          break;
        }
      }
    }
    if (periodo) break;
  }
  if (periodo) Object.assign(yearHint, periodo);

  const byKey = new Map<string, FuncLido>();
  const order: string[] = [];
  let empNow: { empresa: string | null; cnpj: string | null } = { empresa: null, cnpj: null };
  const getFunc = (name: string, mat: string | null, posto: string | null, cargo: string | null) => {
    const key = mat ? `m:${mat.replace(/\D/g, '') || mat}` : `n:${fold(name)}`;
    let f = byKey.get(key);
    if (!f) {
      f = { name, matricula: mat, posto, cargo, empresa: empNow.empresa, cnpj: empNow.cnpj, days: [] };
      byKey.set(key, f);
      order.push(key);
    }
    if (!f.posto && posto) f.posto = posto;
    if (!f.empresa && empNow.empresa) f.empresa = empNow.empresa;
    if (!f.cnpj && empNow.cnpj) f.cnpj = empNow.cnpj;
    if (!f.cargo && cargo) f.cargo = cargo;
    return f;
  };
  const addDay = (f: FuncLido, d: DiaLido) => {
    const cur = f.days.find((x) => x.date === d.date);
    if (cur) {
      // o mesmo dia em duas linhas (ex.: segunda linha com as batidas da tarde)
      for (const p of d.punches) cur.punches.push(p);
      for (const k of d.marks) if (!cur.marks.includes(k)) cur.marks.push(k);
      cur.schedule = cur.schedule ?? d.schedule;
      cur.local = cur.local ?? d.local;
      cur.sisTrab = cur.sisTrab ?? d.sisTrab;
      cur.sisDif = cur.sisDif ?? d.sisDif;
    } else if (f.days.length < MAX_DAYS) f.days.push(d);
  };

  let formato = 'espelho';
  for (const sh of sheets) {
    let cols: Col[] | null = null;
    let colX: number[] | null = null;
    let cur: FuncLido | null = null;
    let pendingName: string | null = null;
    let pendingMat: string | null = null;
    let pendingPosto: string | null = null;
    let pendingCargo: string | null = null;
    let sheetPosto: string | null = null;
    let sheetEmpresa: string | null = null;
    let sheetCnpj: string | null = null;

    for (let r = 0; r < sh.rows.length; r++) {
      const raw = sh.rows[r];
      const row = raw.map((c) => String(c ?? '').trim());
      if (!row.some(Boolean)) continue;
      const joined = row.filter(Boolean).join('  ');
      const fj = fold(joined);

      // cabeçalho de colunas (Data | Entrada | Saída …)
      const kinds = row.map((c) => headerKind(c));
      const hasDate = kinds.includes('date');
      const punchCols = kinds.filter((k) => k === 'punch' || k === 'multi').length;
      if (hasDate && (punchCols >= 1 || kinds.includes('name'))) {
        cols = kinds.map((k) => k ?? 'other');
        colX = sh.xs?.[r] ?? null;
        if (kinds.includes('name')) formato = 'lista';
        continue;
      }

      // dados do funcionário (bloco do espelho)
      const name = labelled(row, LABEL_NAME) ?? findInline(joined, /(?:funcion[aá]rio|colaborador|empregado|nome)\s*[:\-–]\s*([A-Za-zÀ-ú][A-Za-zÀ-ú.' ]{3,80}?)(?=\s{2,}|\s+(?:matr|chapa|cargo|fun[cç]|posto|admiss|pis|cpf|re\b)|$)/i);
      const mat = labelled(row, LABEL_MAT) ?? findInline(joined, /(?:matr[ií]cula|chapa|re)\s*[:\-–]?\s*(\d[\d.\-/]*)/i);
      const posto = labelled(row, LABEL_POSTO) ?? findInline(joined, /(?:posto|lota[cç][aã]o|local de trabalho|cliente)\s*[:\-–]\s*(.+?)(?=\s{2,}|\s+(?:matr|chapa|cargo|per[ií]odo|admiss)|$)/i);
      const cargo = labelled(row, LABEL_CARGO);
      // célula do dia: só a data (com o dia da semana: "21/08-Sex") ou começando por ela
      const dateCell = NOT_DAY.test(joined)
        ? -1
        : row.findIndex((c) => DATE_RE.test(c) && parseDate(c, yearHint) && (c.replace(DATE_RE, '').replace(/[a-zà-ú.,\s-]/gi, '').length < 3 || START_DATE.test(c)));
      // empresa/filial do cabeçalho (vale para os funcionários seguintes)
      empNow = { empresa: sheetEmpresa, cnpj: sheetCnpj };
      const emp = labelled(row, LABEL_EMPRESA);
      if (emp) sheetEmpresa = emp.replace(/\s+cnpj.*$/i, '').slice(0, 80);
      const cnpj = findInline(joined, /cnpj\s*[:\-–]?\s*([\d./-]{14,18})/i);
      if (cnpj) sheetCnpj = cnpj;
      empNow = { empresa: sheetEmpresa, cnpj: sheetCnpj };
      if (name && dateCell < 0) {
        const nm = cleanName(name);
        if (nm && nm.length >= 3 && /[a-zA-ZÀ-ú]{2}/.test(nm) && !/per[ií]odo|empresa|cnpj/i.test(nm)) {
          pendingName = nm;
          pendingMat = mat ? mat.replace(/\s.*$/, '') : null;
          pendingPosto = posto ? posto.slice(0, 80) : sheetPosto;
          pendingCargo = cargo ? cargo.slice(0, 60) : null;
          cur = null;
          continue;
        }
      }
      if (dateCell < 0) {
        if (mat && pendingName && !pendingMat) pendingMat = mat.replace(/\s.*$/, '');
        if (posto) {
          if (pendingName) pendingPosto = posto.slice(0, 80);
          else sheetPosto = posto.slice(0, 80);
          if (cur && !cur.posto) cur.posto = posto.slice(0, 80);
        }
        if (cargo && pendingName) pendingCargo = cargo.slice(0, 60);
        continue;
      }

      // linha de dia
      const date = parseDate(row[dateCell], yearHint);
      if (!date) continue;
      let who: FuncLido | null = null;
      const punches: string[] = [];
      const marks: string[] = [];
      let schedule: string[] | null = null;
      let local: string | null = null;
      const nums: number[] = [];
      let numsOk = true;
      // o que vem depois da data na mesma célula ("21/08-Sex 07:01 12:03") também conta
      const cells = row.map((c, i) => (i === dateCell ? c.replace(DATE_HEAD, '').trim() : c));
      /** texto livre da linha: cliente/posto, horas do sistema (11,03) ou marcação */
      const free = (c: string) => {
        for (const m of c.matchAll(/(?<![\d.,:])-?\d{1,3},\d{2}(?![\d,:])/g)) {
          const v = hhmmNum(m[0]);
          if (v === null) numsOk = false;
          else nums.push(v);
        }
        const text = c.replace(TIME_G, ' ').replace(/-?\d{1,3},\d{2}/g, ' ').replace(/\s+/g, ' ').trim();
        if (/[A-Za-zÀ-ú]{3}/.test(text) && !marksIn(text).length && !NOT_LOCAL.test(fold(text)) && (!local || text.length > local.length)) local = text.slice(0, 90);
      };
      if (cols) {
        const xs = sh.xs?.[r];
        // cada célula na coluna do cabeçalho (no PDF, a do x mais próximo)
        const colOf = (i: number) => {
          if (xs && colX) {
            let best = 0;
            let bd = Infinity;
            colX.forEach((x, k) => {
              const d = Math.abs(x - xs[i]);
              if (d < bd) {
                bd = d;
                best = k;
              }
            });
            return cols![best] ?? 'other';
          }
          return cols![i] ?? 'other';
        };
        let nameCell: string | null = null;
        let matCell: string | null = null;
        let postoCell: string | null = null;
        let cargoCell: string | null = null;
        let trab: number | null = null;
        let dif: number | null = null;
        cells.forEach((c, i) => {
          if (!c) return;
          const k = i === dateCell ? 'multi' : colOf(i);
          if (k === 'punch' || k === 'multi') {
            punches.push(...timesIn(c));
            if (i === dateCell || k === 'multi') free(c);
          } else if (k === 'schedule') schedule = [...(schedule ?? []), ...timesIn(c)];
          else if (k === 'name') nameCell = c;
          else if (k === 'mat') matCell = c;
          else if (k === 'posto') postoCell = c;
          else if (k === 'cargo') cargoCell = c;
          else if (k === 'systrab') trab = hhmmNum(c) ?? (timesIn(c)[0] ? Number(timesIn(c)[0].slice(0, 2)) * 60 + Number(timesIn(c)[0].slice(3)) : trab);
          else if (k === 'sysdif') dif = hhmmNum(c.replace(/^\+/, '')) ?? dif;
          else if (k !== 'skip') {
            // coluna sem nome conhecido (no PDF, texto entre duas colunas): hora é batida,
            // "11,03" é hora do sistema, texto é o cliente/posto
            punches.push(...timesIn(c));
            free(c);
          }
          if (k !== 'name' && k !== 'posto' && k !== 'cargo') marks.push(...marksIn(c));
        });
        if (postoCell) local = String(postoCell).slice(0, 90);
        // horas do sistema: as colunas com nome; o que sobrou de "11,03" nas outras completa
        const rest = [...nums];
        const t: number | null = trab ?? (rest.length ? rest.shift()! : null);
        const d0: number | null = dif ?? (rest.length ? rest.shift()! : null);
        nums.splice(0, nums.length, ...(t !== null ? [t, ...(d0 !== null ? [d0] : [])] : []));
        if (nameCell) who = getFunc(cleanName(nameCell), matCell, postoCell ?? sheetPosto, cargoCell);
      } else {
        // sem cabeçalho: todo HH:MM da linha é batida; o texto é o cliente/posto
        cells.forEach((c) => {
          if (!c) return;
          punches.push(...timesIn(c));
          marks.push(...marksIn(c));
          free(c);
        });
      }
      if (!who) {
        if (!cur && pendingName) cur = getFunc(pendingName, pendingMat, pendingPosto, pendingCargo);
        who = cur;
      }
      if (!who) continue;
      const sched = schedule as string[] | null;
      const sys = numsOk && nums.length ? { sisTrab: nums[0], sisDif: nums.length > 1 ? nums[1] : null } : {};
      const vazias = punches.filter((p) => p === '00:00').length;
      addDay(who, { date, punches: dropZeros(punches), vazias, marks: [...new Set(marks)], schedule: sched && sched.length >= 2 ? sched : null, local, ...sys });
    }
  }

  const funcionarios = order.map((k) => byKey.get(k)!).filter((f) => f.days.length);
  for (const f of funcionarios) f.days.sort((a, b) => a.date.localeCompare(b.date));
  if (!funcionarios.length) avisos.push('Não achei funcionários com dias e batidas neste arquivo.');
  if (!periodo && funcionarios.length) {
    const all = funcionarios.flatMap((f) => f.days.map((d) => d.date)).sort();
    periodo = { from: all[0], to: all[all.length - 1] };
  }
  return { funcionarios, periodo, formato, avisos };
}
