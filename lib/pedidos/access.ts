import { hasLevel, type HubUser } from '../permissions';
import { isRhOrigin, type MaterialOrder, type OrderOrigin } from './types';

/** Painel de pedidos (Projeto 3, seção 14): cada área vê a sua parte, a Gestão (master) vê tudo. */
export type OrderScope = 'almox' | 'operacao' | 'rh';
type U = HubUser | null | undefined;

export const almoxOrders = (u: U, lvl: 'view' | 'edit' = 'view') => hasLevel(u, 'almoxarifado', 'pedidos', lvl);
export const opOrders = (u: U, lvl: 'view' | 'edit' = 'view') => hasLevel(u, 'operacional', 'pedidos', lvl);
export const rhOrders = (u: U, lvl: 'view' | 'edit' = 'view') => hasLevel(u, 'rh', 'pedidos', lvl);
export const colabAccess = (u: U, lvl: 'view' | 'edit' = 'view') => hasLevel(u, 'rh', 'colaboradores', lvl);
export const notesAccess = (u: U, lvl: 'view' | 'edit' = 'view') => hasLevel(u, 'almoxarifado', 'notas', lvl);
export const financeNotes = (u: U) => hasLevel(u, 'financeiro', 'notas', 'view') || notesAccess(u);

export function scopeAllowed(u: U, scope: OrderScope): boolean {
  return scope === 'almox' ? almoxOrders(u) : scope === 'operacao' ? opOrders(u) : rhOrders(u);
}
/** quais origens cada painel mostra */
export function originsOf(scope: OrderScope): OrderOrigin[] | null {
  return scope === 'operacao' ? ['operacao'] : scope === 'rh' ? ['rh_admissao', 'rh_troca', 'rh_extra'] : null;
}
/** pode ver este pedido em algum painel? */
export function canSeeOrder(u: U, o: Pick<MaterialOrder, 'origin'>): boolean {
  if (!u) return false;
  if (u.is_master || almoxOrders(u)) return true;
  if (o.origin === 'operacao' && opOrders(u)) return true;
  if (isRhOrigin(o.origin) && rhOrders(u)) return true;
  // a troca anual é validada pela Operação
  if (o.origin === 'rh_troca' && opOrders(u)) return true;
  return false;
}
