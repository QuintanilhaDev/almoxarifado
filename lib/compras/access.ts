import { hasLevel, type HubUser } from '../permissions';

/**
 * Quem enxerga e o que pode fazer com as solicitações de compra.
 *  - Compras (módulo "Solicitações" do setor Compras): vê tudo, muda status e responde.
 *  - Almoxarifado (módulo "Compras" do setor Almoxarifado): vê os pedidos, cria e cancela os que ainda estão novos.
 *  - Master geral: os dois lados.
 */
export const comprasView = (u: HubUser | null | undefined) => hasLevel(u, 'compras', 'solicitacoes', 'view');
export const comprasEdit = (u: HubUser | null | undefined) => hasLevel(u, 'compras', 'solicitacoes', 'edit');
export const almoxView = (u: HubUser | null | undefined) => hasLevel(u, 'almoxarifado', 'compras', 'view');
export const almoxEdit = (u: HubUser | null | undefined) => hasLevel(u, 'almoxarifado', 'compras', 'edit');
export const canSeePurchases = (u: HubUser | null | undefined) => comprasView(u) || almoxView(u);
