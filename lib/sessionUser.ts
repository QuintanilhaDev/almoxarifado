import 'server-only';
import { currentUser as cookieUser } from './auth';
import type { HubUser } from './permissions';

/**
 * Pessoa logada, conferindo também a impressão da senha do token: trocou a senha,
 * as sessões antigas caem. Tokens emitidos antes da impressão existir (sem "pwf")
 * continuam valendo até expirar. Acesso desativado = sem sessão (já vem do auth).
 */
export async function sessionUser(): Promise<HubUser | null> {
  // a conferência da senha agora fica no próprio currentUser (vale também para as páginas)
  return cookieUser();
}
