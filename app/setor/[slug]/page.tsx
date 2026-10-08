import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { Dashboard } from '@/components/almoxarifado/Dashboard';
import { SectorShell } from '@/components/setores/SectorShell';
import { introScript } from '@/components/core/AppFrame';
import { currentUser } from '@/lib/auth';
import { canOpenSector, homePath } from '@/lib/permissions';
import { getSector } from '@/lib/sectors';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const sector = getSector((await params).slug);
  return { title: sector ? `${sector.name} · Max Hub` : 'Max Hub' };
}

/** Ferramenta de cada setor. Só entra quem está alocado nele (ou é master geral). */
export default async function SectorPage({ params }: Props) {
  const { slug } = await params;
  const sector = getSector(slug);
  if (!sector) notFound();
  const user = await currentUser();
  if (!user) redirect('/');
  if (!canOpenSector(user, sector.slug)) redirect(homePath(user));
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: introScript }} />
      {sector.slug === 'almoxarifado' ? <Dashboard /> : <SectorShell slug={sector.slug} />}
    </>
  );
}
