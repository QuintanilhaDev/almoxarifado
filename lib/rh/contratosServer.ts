import 'server-only';
import { db } from '../supabaseAdmin';
import { requireUser } from '../access';
import { AccessError, fail } from '../http';
import { hasLevel } from '../permissions';
import { fetchAll } from '../almoxarifado/stockData';
import { colabAccess } from '../pedidos/access';
import type { RoleKit } from '../pedidos/rh';
import { normalize } from '../max/text';

const roleKey = (r: string | null | undefined) => normalize(String(r ?? '')).trim();
import { CONTRATO_COLS, KIT_SOCIAL, contratoDoColab, foldK, indiceContratos, type Contrato } from './contratos';

export const CONTRATOS_SETUP = 'O cadastro de contratos ainda não foi ativado no banco. Rode o arquivo supabase/contratos_e_devolucoes.sql no SQL Editor do Supabase.';
export const contratosFail = () => fail(CONTRATOS_SETUP, 409, { setup: true });

let cache: { ok: boolean; at: number } | null = null;
export async function temContratos(): Promise<boolean> {
  if (cache && (cache.ok || Date.now() - cache.at < 60_000)) return cache.ok;
  const a = await db().from('contracts').select('id').limit(1);
  const b = a.error ? a : await db().from('postos').select('contract_id').limit(1);
  cache = { ok: !a.error && !b.error, at: Date.now() };
  return cache.ok;
}

export async function carregarContratos(): Promise<Contrato[]> {
  if (!(await temContratos())) return [];
  const cs = await fetchAll<Contrato>('contracts', CONTRATO_COLS, { column: 'name_key', tiebreak: 'id' });
  return cs.map((c) => ({ ...c, aliases: c.aliases ?? [] }));
}

/** contratos + posto → contrato, prontos para achar o contrato de cada colaborador */
export async function mapaContratos(): Promise<{ contratos: Contrato[]; doColab: (c: { client?: string | null; posto_id?: string | null }) => Contrato | null }> {
  const contratos = await carregarContratos();
  const idx = indiceContratos(contratos);
  const porId = new Map(contratos.map((c) => [c.id, c]));
  const postoContrato = new Map<string, Contrato>();
  if (contratos.length) {
    const ps = await fetchAll<{ id: string; contract_id: string | null }>('postos', 'id, contract_id', { column: 'id' });
    for (const p of ps) if (p.contract_id && porId.has(p.contract_id)) postoContrato.set(p.id, porId.get(p.contract_id)!);
  }
  return { contratos, doColab: (c) => contratoDoColab(c, idx, postoContrato) };
}

/** o kit do colaborador: num contrato de portaria social, "<função> SOCIAL" (se existir); senão o da função */
export function kitDoColab(kits: RoleKit[], role: string | null | undefined, contrato: Contrato | null): RoleKit | null {
  const k = roleKey(role);
  if (!k) return null;
  if (contrato?.portaria_social) {
    const social = kits.find((x) => roleKey(x.role) === roleKey(`${role} ${KIT_SOCIAL}`));
    if (social) return social;
  }
  return kits.find((x) => roleKey(x.role) === k) ?? null;
}

/** nomes (normalizados) de cliente cuja importação deve ser ignorada */
export async function clientesBloqueados(): Promise<Set<string>> {
  const s = new Set<string>();
  for (const c of await carregarContratos()) {
    if (!c.block_import) continue;
    s.add(foldK(c.name));
    for (const a of c.aliases) if (foldK(a)) s.add(foldK(a));
  }
  return s;
}

/** o cadastro de postos fica com o RH (quem edita Colaboradores) e o master geral */
export async function requirePostoCadastro() {
  const user = await requireUser();
  if (!colabAccess(user, 'edit')) throw new AccessError(403, 'O cadastro de postos fica com o RH (Recursos Humanos › Contratos).');
  return user;
}
/** ver os postos: Almoxarifado (postos, estoque, solicitações) ou RH */
export async function requirePostoVer() {
  const user = await requireUser();
  const almox = ['postos', 'estoque', 'solicitacoes'].some((m) => hasLevel(user, 'almoxarifado', m, 'view'));
  if (!almox && !colabAccess(user)) throw new AccessError(403, 'Você não tem acesso aos postos.');
  return user;
}
