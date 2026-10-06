import type { Metadata } from 'next';
import { LoginScreen } from '@/components/LoginScreen';

export const metadata: Metadata = { title: 'Entrar · Almoxarifado' };

export default function LoginPage() {
  return <LoginScreen />;
}
