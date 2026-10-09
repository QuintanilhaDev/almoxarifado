'use client';
import { Hammer, LayoutDashboard, Sparkles, UserRound, UsersRound } from 'lucide-react';
import { useMemo, useState } from 'react';
import { AccountSettings } from '../core/AccountSettings';
import { AppFrame, type FrameTab } from '../core/AppFrame';
import { TeamManager } from '../core/TeamManager';
import { ToastProvider } from '../core/Toasts';
import { useWarp } from '../core/Warp';
import { MaxAssistant } from '../max/MaxAssistant';
import { canManageSector } from '@/lib/permissions';
import { useRealtime } from '@/lib/realtime';
import { getSector, sectorPath } from '@/lib/sectors';
import { useHashTab, useSession } from '@/lib/useSession';
import type { MaxHost } from '@/lib/max/types';

type Tab = 'inicio' | 'equipe' | 'conta';
const VALID: Tab[] = ['inicio', 'equipe', 'conta'];

/**
 * Tela padrão de um setor que ainda não tem ferramenta própria.
 * Já traz a moldura, a aba Equipe (permissões), Minha conta e a Max.
 * Quando o setor ganhar funções, as abas novas entram aqui.
 */
export function SectorShell({ slug }: { slug: string }) {
  return (
    <ToastProvider>
      <Shell slug={slug} />
    </ToastProvider>
  );
}

function Shell({ slug }: { slug: string }) {
  const sector = getSector(slug)!;
  const { user, setUser, refresh, intro, endIntro, logout } = useSession(sectorPath(slug));
  const [tab, setTab] = useHashTab<Tab>(VALID, 'inicio');
  const warp = useWarp();
  const [teamVersion, setTeamVersion] = useState(0);
  const manager = canManageSector(user, slug);

  useRealtime(
    (ev) => {
      if (ev === 'admins:update') {
        refresh();
        setTeamVersion((v) => v + 1);
      }
    },
    refresh,
    30000,
  );

  const tabs = useMemo<FrameTab[]>(
    () => [
      { id: 'inicio', label: 'Início', short: 'Início', icon: LayoutDashboard },
      ...(manager ? [{ id: 'equipe', label: 'Equipe', short: 'Equipe', icon: UsersRound }] : []),
      { id: 'conta', label: 'Minha conta', short: 'Conta', icon: UserRound },
    ],
    [manager],
  );
  const current: Tab = tab === 'equipe' && user && !manager ? 'inicio' : tab;

  const host = useMemo<MaxHost>(
    () => ({
      scope: 'sector',
      sector,
      user,
      tabs: [
        { id: 'inicio', label: 'Início', aliases: ['inicio', 'pagina inicial', 'tela inicial', 'home'] },
        ...(manager ? [{ id: 'equipe', label: 'Equipe', aliases: ['equipe', 'permissoes', 'time', 'pessoas'] }] : []),
        { id: 'conta', label: 'Minha conta', aliases: ['conta', 'minha conta', 'perfil', 'senha', 'minha senha'] },
      ],
      tab: current,
      goTab: (id) => setTab(id as Tab),
      can: () => false,
      navigate: (path, opts) => warp.go(path, opts),
      logout,
    }),
    [sector, user, manager, current, setTab, logout, warp],
  );

  return (
    <>
      <AppFrame sub={sector.name} tabs={tabs} tab={current} onTab={(t) => setTab(t as Tab)} user={user} onLogout={logout} intro={intro} onIntroEnd={endIntro}>
        {current === 'inicio' && (
          <div className="section-scroll">
            <div className="section-pad" style={{ maxWidth: 860 }}>
              <div className="section-head">
                <div>
                  <h1>{sector.name}</h1>
                  <p>{sector.description}</p>
                </div>
              </div>
              <div className="blank-tool">
                <span className="empty-icon">
                  <Hammer size={24} />
                </span>
                <strong>Ferramenta em preparação</strong>
                <span>
                  Este é o espaço do setor {sector.name} no Max Hub. As funções ainda não foram criadas: quando entrarem, aparecem aqui e no menu ao lado.
                </span>
              </div>
              <div className="blank-tip">
                <Sparkles size={18} />
                <p>
                  A Max já está por aqui, no canto inferior direito. Clique na esfera, espere ficar verde e diga <b>“Max, que dia é hoje?”</b> ou{' '}
                  <b>“Max, abrir minha conta”</b>.
                </p>
              </div>
            </div>
          </div>
        )}
        {current === 'equipe' && manager && <TeamManager slug={slug} me={user} version={teamVersion} />}
        {current === 'conta' && <AccountSettings user={user} setUser={setUser} onLogout={logout} />}
      </AppFrame>
      <MaxAssistant host={host} />
    </>
  );
}
