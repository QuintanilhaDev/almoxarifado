import { redirect } from 'next/navigation';

/** Endereço antigo: o login agora é a página principal. */
export default function LoginPage() {
  redirect('/');
}
