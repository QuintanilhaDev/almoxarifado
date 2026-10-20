import type { DiaLido, FuncLido, Lido } from '../pontos/types';

/**
 * Vários arquivos (uma pasta inteira, um espelho por mês, uma folha por funcionário…)
 * viram uma leitura só: a mesma pessoa (pela matrícula ou, sem ela, pelo nome) é juntada,
 * e o mesmo dia repetido em dois arquivos não é contado duas vezes.
 */
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const txt = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const chave = (f: FuncLido) => {
  const m = (f.matricula ?? '').replace(/\D/g, '').replace(/^0+/, '');
  return m ? `m:${m}` : `n:${fold(f.name)}`;
};

/** o que vem da tela não é confiável: só passa o que tem formato de dia e batida */
export function limparLido(raw: unknown): Lido | null {
  const r = raw as Partial<Lido> | null;
  if (!r || !Array.isArray(r.funcionarios)) return null;
  const funcionarios: FuncLido[] = [];
  for (const f of r.funcionarios.slice(0, 3000) as Partial<FuncLido>[]) {
    const name = txt(f?.name, 100);
    if (!name || !Array.isArray(f.days)) continue;
    const days: DiaLido[] = [];
    for (const d of f.days.slice(0, 800) as Partial<DiaLido>[]) {
      if (typeof d?.date !== 'string' || !DATE.test(d.date)) continue;
      days.push({
        date: d.date,
        punches: (Array.isArray(d.punches) ? d.punches : []).filter((p): p is string => typeof p === 'string' && HORA.test(p)).slice(0, 16),
        marks: (Array.isArray(d.marks) ? d.marks : []).map((m) => txt(m, 30)).filter((m): m is string => Boolean(m)).slice(0, 6),
        schedule: null,
      });
    }
    if (days.length) funcionarios.push({ name, matricula: txt(f.matricula, 30), posto: txt(f.posto, 90), cargo: txt(f.cargo, 60), days });
  }
  const per = r.periodo && typeof r.periodo.from === 'string' && DATE.test(r.periodo.from) && typeof r.periodo.to === 'string' && DATE.test(r.periodo.to) ? { from: r.periodo.from, to: r.periodo.to } : null;
  const avisos = (Array.isArray(r.avisos) ? r.avisos : []).map((a) => txt(a, 400)).filter((a): a is string => Boolean(a)).slice(0, 10);
  return { funcionarios, periodo: per, formato: txt(r.formato, 30) ?? 'lista', avisos };
}

export function juntar(partes: { nome: string; lido: Lido }[]): Lido {
  const muitos = partes.length > 1;
  const avisos: string[] = [];
  const byKey = new Map<string, FuncLido>();
  // nome → chave, para casar "JOÃO SILVA" sem matrícula num arquivo com a matrícula do outro
  const porNome = new Map<string, string>();
  let repetidos = 0;
  for (const { nome, lido } of partes) {
    for (const a of lido.avisos) avisos.push(muitos ? `${nome}: ${a}` : a);
    for (const f of lido.funcionarios) {
      let k = chave(f);
      if (k.startsWith('n:') && porNome.has(fold(f.name))) k = porNome.get(fold(f.name))!;
      let cur = byKey.get(k);
      if (!cur) {
        cur = { ...f, days: [] };
        byKey.set(k, cur);
        if (!porNome.has(fold(f.name))) porNome.set(fold(f.name), k);
      } else {
        cur.matricula ??= f.matricula;
        cur.cargo ??= f.cargo;
        cur.posto ??= f.posto;
      }
      for (const d of f.days) {
        const same = cur.days.find((x) => x.date === d.date);
        if (!same) {
          cur.days.push({ ...d, punches: [...d.punches], marks: [...d.marks] });
          continue;
        }
        // mesmo dia em dois arquivos: só entram as batidas que ainda não estavam lá
        const novas = d.punches.filter((p) => !same.punches.includes(p));
        if (same.punches.length && d.punches.length && !novas.length) repetidos++;
        same.punches.push(...novas);
        for (const m of d.marks) if (!same.marks.includes(m)) same.marks.push(m);
      }
    }
  }
  const funcionarios = [...byKey.values()];
  for (const f of funcionarios) f.days.sort((a, b) => a.date.localeCompare(b.date));
  if (repetidos) avisos.push(`${repetidos} dia(s) apareceram em mais de um arquivo com as mesmas batidas e foram contados uma vez só.`);
  const datas = funcionarios.flatMap((f) => f.days.map((d) => d.date)).sort();
  const ps = partes.map((p) => p.lido.periodo).filter((p): p is { from: string; to: string } => Boolean(p));
  const from = [...ps.map((p) => p.from), datas[0]].filter(Boolean).sort()[0];
  const to = [...ps.map((p) => p.to), datas[datas.length - 1]].filter(Boolean).sort().pop();
  return { funcionarios, periodo: from && to ? { from, to } : null, formato: muitos ? 'varios' : partes[0]?.lido.formato ?? 'lista', avisos };
}
