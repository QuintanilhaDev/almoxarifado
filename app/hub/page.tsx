import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { HubPanel } from '@/components/hub/HubPanel';
import { introScript } from '@/components/core/AppFrame';
import { currentUser } from '@/lib/auth';
import { homePath } from '@/lib/permissions';

export const metadata: Metadata = { title: 'Painel master · Max Hub' };
export const dynamic = 'force-dynamic';

export default async function HubPage() {
  const user = await currentUser();
  if (!user) redirect('/');
  if (!user.is_master) redirect(homePath(user));
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: introScript }} />
      <HubPanel />
    </>
  );
}
