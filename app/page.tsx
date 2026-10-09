import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LoginScreen } from '@/components/login/LoginScreen';
import { currentUser } from '@/lib/auth';
import { homePath, type HubUser } from '@/lib/permissions';

export const metadata: Metadata = { title: 'Entrar · Max Hub' };
export const dynamic = 'force-dynamic';

/** Endereço principal do Max Hub: o login. Quem já entrou vai direto para a sua tela. */
export default async function Home() {
  let user: HubUser | null = null;
  try {
    user = await currentUser();
  } catch {
    user = null; // banco fora do ar: mostra o login mesmo assim
  }
  if (user) redirect(homePath(user));
  return <LoginScreen />;
}
