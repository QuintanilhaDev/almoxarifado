import type { Metadata } from 'next';
import { RequestForm } from '@/components/RequestForm';

export const metadata: Metadata = { title: 'Nova solicitação · Almoxarifado' };

export default function SolicitacaoPage() {
  return <RequestForm />;
}
