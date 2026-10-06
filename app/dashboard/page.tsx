import type { Metadata } from 'next';
import { Dashboard } from '@/components/dashboard/Dashboard';

export const metadata: Metadata = { title: 'Painel · Almoxarifado' };

// Marca a página antes de o React carregar, para a transição do login
// continuar lilás sem "piscar" o painel.
const introScript = `try{if(sessionStorage.getItem('almox:intro'))document.documentElement.classList.add('intro')}catch(e){}`;

export default function DashboardPage() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: introScript }} />
      <Dashboard />
    </>
  );
}
