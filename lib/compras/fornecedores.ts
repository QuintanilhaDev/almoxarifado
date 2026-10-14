import { hasLevel, type HubUser } from '../permissions';

/** Fornecedor (tabela suppliers). Os que vieram das notas fiscais também aparecem aqui. */
export interface Supplier {
  id: string;
  name: string;
  trade_name: string | null;
  cnpj: string | null;
  phone: string | null;
  email: string | null;
  contact: string | null;
  category: string | null;
  city: string | null;
  uf: string | null;
  address: string | null;
  notes: string | null;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
  /** resumo das notas fiscais deste fornecedor (calculado na leitura) */
  notes_count?: number;
  last_note?: string | null;
  total?: number;
}

export const SUPPLIER_COLS = 'id, name, trade_name, cnpj, phone, email, contact, category, city, uf, address, notes, active, created_by, created_at, updated_at';

/**
 * Quem vê e quem mexe:
 *  - Compras (módulo Fornecedores): vê; com edição, cadastra, edita e importa.
 *  - Almoxarifado e Financeiro (módulo Notas): só consultam.
 */
export const supplierEdit = (u: HubUser | null | undefined) => hasLevel(u, 'compras', 'fornecedores', 'edit');
export const supplierView = (u: HubUser | null | undefined) =>
  hasLevel(u, 'compras', 'fornecedores', 'view') || hasLevel(u, 'almoxarifado', 'notas', 'view') || hasLevel(u, 'financeiro', 'notas', 'view');

const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '');

/** CNPJ (14 dígitos) ou CPF (11) com os dígitos verificadores certos. */
export function validDoc(d: string): boolean {
  if (/^(\d)\1+$/.test(d)) return false;
  const check = (base: string, weights: number[]) => {
    const s = base.split('').reduce((acc, n, i) => acc + Number(n) * weights[i], 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  if (d.length === 14) {
    const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const w2 = [6, ...w1];
    return check(d.slice(0, 12), w1) === Number(d[12]) && check(d.slice(0, 13), w2) === Number(d[13]);
  }
  if (d.length === 11) {
    const c = (len: number) => {
      const s = d.slice(0, len).split('').reduce((acc, n, i) => acc + Number(n) * (len + 1 - i), 0);
      const r = (s * 10) % 11;
      return r === 10 ? 0 : r;
    };
    return c(9) === Number(d[9]) && c(10) === Number(d[10]);
  }
  return false;
}

/** 12345678000199 → 12.345.678/0001-99 (CPF: 123.456.789-09) */
export function formatDoc(d: string | null | undefined): string {
  const x = digits(d);
  if (x.length === 14) return x.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (x.length === 11) return x.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return d ?? '';
}

const UFS = new Set('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' '));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const txt = (v: unknown, max: number): string | null => {
  const s = String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return s ? s.slice(0, max) : null;
};

export type SupplierRow = Omit<Supplier, 'id' | 'active' | 'created_by' | 'created_at' | 'updated_at' | 'notes_count' | 'last_note' | 'total'>;

/** Valida e limpa os campos de um fornecedor (formulário ou linha da planilha). */
export function supplierFields(raw: Record<string, unknown>): { row: SupplierRow } | { error: string } {
  const name = txt(raw.name, 160);
  if (!name) return { error: 'falta o nome (razão social) do fornecedor' };
  let doc = digits(raw.cnpj);
  // a planilha pode ter guardado o CNPJ como número e comido os zeros da frente
  if (doc.length >= 12 && doc.length < 14) doc = doc.padStart(14, '0');
  else if (doc.length >= 9 && doc.length < 11) doc = doc.padStart(11, '0');
  if (doc && !validDoc(doc)) return { error: `CNPJ/CPF inválido (${String(raw.cnpj ?? '').trim()})` };
  const email = txt(raw.email, 160)?.toLowerCase() ?? null;
  if (email && !EMAIL_RE.test(email)) return { error: `e-mail inválido (${email})` };
  let uf = txt(raw.uf, 30)?.toUpperCase() ?? null;
  if (uf && !UFS.has(uf)) uf = null;
  let city = txt(raw.city, 80);
  // "Salvador/BA" ou "Salvador - BA" na mesma coluna
  const m = city?.match(/^(.*?)\s*[-/]\s*([A-Za-z]{2})$/);
  if (m && UFS.has(m[2].toUpperCase())) {
    city = m[1];
    uf = uf ?? m[2].toUpperCase();
  }
  return {
    row: {
      name,
      trade_name: txt(raw.trade_name, 120),
      cnpj: doc || null,
      phone: txt(raw.phone, 60),
      email,
      contact: txt(raw.contact, 120),
      category: txt(raw.category, 160),
      city,
      uf,
      address: txt(raw.address, 200),
      notes: txt(raw.notes, 1000),
    },
  };
}

/** chave para achar o mesmo fornecedor sem CNPJ (pelo nome) */
export const nameKey = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(ltda|me|epp|eireli|s ?a|cia)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
