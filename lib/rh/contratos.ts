/**
 * Contratos (clientes) do RH: tipos e a ligação com os colaboradores.
 * O colaborador pertence ao contrato pelo campo "cliente" (nome do contrato ou um dos outros nomes)
 * ou, sem cliente, pelo posto ligado ao contrato.
 */
export interface Contrato {
  id: string;
  name: string;
  aliases: string[];
  cnpj: string | null;
  company: string | null;
  start_date: string | null;
  end_date: string | null;
  active: boolean;
  portaria_social: boolean;
  block_import: boolean;
  notes: string | null;
  updated_by?: string | null;
  updated_at?: string;
}
export const CONTRATO_COLS = 'id, name, aliases, cnpj, company, start_date, end_date, active, portaria_social, block_import, notes, updated_by, updated_at';

export const foldK = (s: unknown) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** índice: nome (e outros nomes) do contrato → contrato */
export function indiceContratos(cs: Contrato[]): Map<string, Contrato> {
  const m = new Map<string, Contrato>();
  for (const c of cs) {
    m.set(foldK(c.name), c);
    for (const a of c.aliases ?? []) if (foldK(a)) m.set(foldK(a), c);
  }
  return m;
}

/** o contrato de um colaborador: pelo cliente; sem cliente, pelo posto */
export function contratoDoColab(c: { client?: string | null; posto_id?: string | null }, idx: Map<string, Contrato>, postoContrato: Map<string, Contrato>): Contrato | null {
  const k = foldK(c.client);
  if (k && idx.has(k)) return idx.get(k)!;
  if (c.posto_id && postoContrato.has(c.posto_id)) return postoContrato.get(c.posto_id)!;
  return null;
}

/** sufixo do kit social: "AGENTE DE PORTARIA" num contrato de portaria social usa o kit "AGENTE DE PORTARIA SOCIAL" */
export const KIT_SOCIAL = 'SOCIAL';
