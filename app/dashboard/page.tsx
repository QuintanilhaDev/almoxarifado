import { redirect } from 'next/navigation';

/** Endereço antigo do painel do almoxarifado. */
export default function DashboardPage() {
  redirect('/setor/almoxarifado');
}
