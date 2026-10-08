/**
 * Categorias dos itens do estoque. Um item pode ter VÁRIAS ao mesmo tempo
 * (ex.: um cinto é "Acessório" e também faz parte do estoque "Max Forte").
 */
export const DEFAULT_CATEGORIES = [
  'Max Forte',
  'Max Serviços',
  'Max Confiável',
  'EPI',
  'Acessório',
  'Equipamento',
  'Higienizado',
] as const;

export const MAX_CATEGORIES = 8;
export const MAX_CATEGORY_LEN = 40;

/** Chave de comparação: sem acento, minúscula, sem plural simples ("acessórios" = "acessório"). */
export function categoryKey(s: string): string {
  const k = s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return k
    .split(' ')
    .map((w) => (w.length > 3 && w.endsWith('s') && w !== 'servicos' ? w.slice(0, -1) : w))
    .join(' ');
}

const CANON = new Map<string, string>(DEFAULT_CATEGORIES.map((c) => [categoryKey(c), c]));
// jeitos comuns de escrever
CANON.set('epis', 'EPI');
CANON.set('max servico', 'Max Serviços');
CANON.set('servico', 'Max Serviços');
CANON.set('servicos', 'Max Serviços');
CANON.set('forte', 'Max Forte');
CANON.set('confiavel', 'Max Confiável');
CANON.set('higienizada', 'Higienizado');
CANON.set('equipamentos', 'Equipamento');

/** Nome "oficial" da categoria, se for uma das conhecidas; senão o texto limpo. */
export function canonCategory(raw: string): string | null {
  const s = raw
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CATEGORY_LEN)
    .trim();
  if (!s) return null;
  const k = categoryKey(s);
  if (!k) return null;
  return CANON.get(k) ?? s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Aceita lista ou texto ("Acessório, Max Forte", "Max Serviços e Max Forte", "Max forte/serviço")
 * e devolve as categorias limpas, sem repetição.
 */
export function cleanCategories(v: unknown): string[] {
  let parts: string[] = [];
  if (Array.isArray(v)) parts = v.map((x) => String(x ?? ''));
  else if (typeof v === 'string') parts = v.split(/[,;|/+\n]|\s+e\s+/i);
  else return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const c = canonCategory(p);
    if (!c) continue;
    const k = categoryKey(c);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
    if (out.length >= MAX_CATEGORIES) break;
  }
  return sortCategories(out);
}

const ORDER = new Map<string, number>(DEFAULT_CATEGORIES.map((c, i) => [c, i]));
export function sortCategories(list: string[]): string[] {
  return [...list].sort(
    (a, b) => (ORDER.get(a) ?? 99) - (ORDER.get(b) ?? 99) || a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }),
  );
}

/** Categorias em uso (com a contagem de itens), as conhecidas primeiro. */
export function countCategories(items: { categories?: string[] | null }[]): { name: string; n: number }[] {
  const n = new Map<string, number>();
  for (const i of items) for (const c of i.categories ?? []) n.set(c, (n.get(c) ?? 0) + 1);
  return sortCategories([...n.keys()]).map((name) => ({ name, n: n.get(name)! }));
}

/** Sugestões para o cadastro: as conhecidas + as que a equipe já criou. */
export function categoryOptions(items: { categories?: string[] | null }[]): string[] {
  const all = new Set<string>(DEFAULT_CATEGORIES);
  for (const i of items) for (const c of i.categories ?? []) all.add(c);
  return sortCategories([...all]);
}

export const hasCategory = (i: { categories?: string[] | null }, name: string) => {
  const k = categoryKey(name);
  return (i.categories ?? []).some((c) => categoryKey(c) === k);
};

/** Acha, entre as categorias em uso, a que a pessoa quis dizer ("epi", "max forte", "acessorios"). */
export function findCategory(text: string, inUse: string[]): string | null {
  const k = categoryKey(text);
  if (!k) return null;
  const pool = sortCategories([...new Set([...inUse, ...DEFAULT_CATEGORIES])]);
  const exact = pool.find((c) => categoryKey(c) === k);
  if (exact) return exact;
  const canon = CANON.get(k);
  if (canon) return canon;
  return null;
}

/** Categoria citada dentro de uma frase inteira ("quanto temos de epi no estoque"). */
export function categoryInPhrase(phrase: string, inUse: string[]): string | null {
  const p = ` ${categoryKey(phrase)} `;
  const pool = [...new Set([...inUse, ...DEFAULT_CATEGORIES])].sort((a, b) => b.length - a.length);
  for (const c of pool) if (p.includes(` ${categoryKey(c)} `)) return c;
  // "serviços" sozinho é palavra comum demais: só vale junto de categoria/estoque/itens
  if (/ max servico /.test(p) || / (categoria|estoque|iten|item|linha) (de |da |do |dos )?servicos? /.test(p)) return 'Max Serviços';
  if (/ (categoria|estoque|iten|item|linha) (de |da |do )?forte /.test(p)) return 'Max Forte';
  if (/ (categoria|estoque|iten|item|linha) (de |da |do )?confiavel /.test(p)) return 'Max Confiável';
  return null;
}

export const MISSING_CATEGORIES_SQL =
  'As categorias ainda não foram ativadas no banco. Rode o arquivo supabase/categorias.sql no SQL Editor do Supabase.';
