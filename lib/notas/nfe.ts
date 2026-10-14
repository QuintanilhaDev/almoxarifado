import { XMLParser } from 'fast-xml-parser';

/**
 * Leitura do XML da NF-e (modelo 55): tudo o que o Projeto 3 pede para a entrada da nota
 * vem do próprio arquivo — fornecedor, número, chave, itens, descontos, frete, parcelas.
 */
export interface NfeItem {
  code: string;
  description: string;
  ncm: string | null;
  unit: string;
  qty: number;
  unit_value: number;
  total: number;
  discount: number;
  freight: number;
  insurance: number;
  other: number;
  ipi: number;
  /** custo de cada unidade para o estoque: (valor − desconto + frete + seguro + outras + IPI) ÷ quantidade */
  unit_cost: number;
}
export interface NfeData {
  access_key: string | null;
  number: string;
  series: string | null;
  issue_date: string | null;
  supplier: { name: string; cnpj: string | null };
  company: { name: string | null; cnpj: string | null };
  items: NfeItem[];
  totals: { products: number; discount: number; freight: number; insurance: number; other: number; ipi: number; taxes: number; total: number };
  installments: { n: string; due: string | null; value: number }[];
  payment: string | null;
}

export class NfeError extends Error {}

const num = (v: unknown) => {
  const n = Number(String(v ?? '0').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const txt = (v: unknown) => (v === undefined || v === null ? null : String(v).trim() || null);
const list = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const digits = (s: string | null) => (s ? s.replace(/\D/g, '') || null : null);

const PAY: Record<string, string> = {
  '01': 'Dinheiro', '02': 'Cheque', '03': 'Cartão de crédito', '04': 'Cartão de débito', '05': 'Crédito loja',
  '10': 'Vale alimentação', '11': 'Vale refeição', '12': 'Vale presente', '13': 'Vale combustível',
  '15': 'Boleto bancário', '16': 'Depósito bancário', '17': 'PIX', '18': 'Transferência', '19': 'Fidelidade',
  '90': 'Sem pagamento', '99': 'Outros',
};

/* eslint-disable @typescript-eslint/no-explicit-any */
export function parseNfe(xml: string): NfeData {
  if (!xml || xml.length > 5_000_000) throw new NfeError('Arquivo XML vazio ou grande demais.');
  let doc: any;
  try {
    doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', removeNSPrefix: true, parseTagValue: false, trimValues: true }).parse(xml);
  } catch {
    throw new NfeError('Não consegui ler esse XML. Confira se é o arquivo da nota fiscal (NF-e).');
  }
  const inf = doc?.nfeProc?.NFe?.infNFe ?? doc?.NFe?.infNFe ?? doc?.enviNFe?.NFe?.infNFe;
  if (!inf) throw new NfeError('Esse XML não é de uma NF-e (não encontrei a tag infNFe).');
  const ide = inf.ide ?? {};
  const emit = inf.emit ?? {};
  const dest = inf.dest ?? {};
  const tot = inf.total?.ICMSTot ?? {};
  const keyRaw = txt(inf['@Id'])?.replace(/^NFe/, '') ?? txt(doc?.nfeProc?.protNFe?.infProt?.chNFe);
  const key = keyRaw && /^\d{44}$/.test(keyRaw) ? keyRaw : null;
  const items: NfeItem[] = list<any>(inf.det).map((d) => {
    const p = d.prod ?? {};
    const qty = num(p.qCom);
    const total = num(p.vProd);
    const discount = num(p.vDesc);
    const freight = num(p.vFrete);
    const insurance = num(p.vSeg);
    const other = num(p.vOutro);
    const ipi = num(d.imposto?.IPI?.IPITrib?.vIPI);
    const cost = qty > 0 ? (total - discount + freight + insurance + other + ipi) / qty : 0;
    return {
      code: txt(p.cProd) ?? '',
      description: txt(p.xProd) ?? 'Item sem descrição',
      ncm: txt(p.NCM),
      unit: txt(p.uCom) ?? 'UN',
      qty,
      unit_value: num(p.vUnCom),
      total,
      discount,
      freight,
      insurance,
      other,
      ipi,
      unit_cost: round(cost, 4),
    };
  });
  if (!items.length) throw new NfeError('A nota não tem itens.');
  const dups = list<any>(inf.cobr?.dup).map((d, i) => ({ n: txt(d.nDup) ?? String(i + 1).padStart(3, '0'), due: txt(d.dVenc), value: num(d.vDup) }));
  const pay = list<any>(inf.pag?.detPag)[0];
  const issue = txt(ide.dhEmi) ?? txt(ide.dEmi);
  return {
    access_key: key,
    number: String(Number(txt(ide.nNF) ?? '0') || txt(ide.nNF) || ''),
    series: txt(ide.serie),
    issue_date: issue ? issue.slice(0, 10) : null,
    supplier: { name: txt(emit.xNome) ?? txt(emit.xFant) ?? 'Fornecedor', cnpj: digits(txt(emit.CNPJ) ?? txt(emit.CPF)) },
    company: { name: txt(dest.xNome), cnpj: digits(txt(dest.CNPJ) ?? txt(dest.CPF)) },
    items,
    totals: {
      products: num(tot.vProd),
      discount: num(tot.vDesc),
      freight: num(tot.vFrete),
      insurance: num(tot.vSeg),
      other: num(tot.vOutro),
      ipi: num(tot.vIPI),
      taxes: num(tot.vTotTrib),
      total: num(tot.vNF),
    },
    installments: dups.length ? dups : pay ? [{ n: '001', due: issue ? issue.slice(0, 10) : null, value: num(pay.vPag) }] : [],
    payment: pay ? PAY[String(pay.tPag ?? '').padStart(2, '0')] ?? null : null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Chave de acesso: 44 dígitos com dígito verificador (módulo 11). */
export function validAccessKey(k: string): boolean {
  if (!/^\d{44}$/.test(k)) return false;
  let w = 2;
  let s = 0;
  for (let i = 42; i >= 0; i--) {
    s += Number(k[i]) * w;
    w = w === 9 ? 2 : w + 1;
  }
  const dv = s % 11 < 2 ? 0 : 11 - (s % 11);
  return dv === Number(k[43]);
}
