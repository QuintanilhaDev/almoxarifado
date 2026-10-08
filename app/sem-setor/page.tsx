import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { NoSector } from '@/components/setores/NoSector';
import { introScript } from '@/components/core/AppFrame';
import { currentUser } from '@/lib/auth';
import { homePath } from '@/lib/permissions';

export const metadata: Metadata = { title: 'Aguardando setor · Max Hub' };
export const dynamic = 'force-dynamic';

/** Quem entrou mas ainda não foi alocado em nenhum setor. */
export default async function NoSectorPage() {
  const user = await currentUser();
  if (!user) redirect('/');
  const home = homePath(user);
  if (home !== '/sem-setor') redirect(home);
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: introScript }} />
      <NoSector name={user.display_name} />
    </>
  );
}
