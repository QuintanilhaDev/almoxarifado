'use client';
import { ArrowUpRight, Briefcase, Crown, HandCoins, Package, ShieldCheck, TriangleAlert, UsersRound, type LucideIcon } from 'lucide-react';
import { greetingFor } from '@/lib/format';
import type { HubUser, HubUserRow } from '@/lib/permissions';
import { SECTORS, sectorPath, type SectorSlug } from '@/lib/sectors';
import { firstName } from '@/lib/max/clock';
import { listJoin } from '@/lib/max/text';
import { maxEmit } from '@/lib/max/bus';

const ICON: Record<SectorSlug, LucideIcon> = {
  almoxarifado: Package,
  rh: UsersRound,
  operacional: ShieldCheck,
  financeiro: HandCoins,
  comercial: Briefcase,
};

export function SectorsOverview({
  me,
  users,
  failed,
  retry,
  onSeeTeam,
}: {
  me: HubUser | null;
  users: HubUserRow[] | null;
  failed: string;
  retry: () => void;
  onSeeTeam: () => void;
}) {
  const active = (users ?? []).filter((u) => u.active);
  const unassigned = active.filter((u) => !u.is_master && !u.sector);
  const mastersCount = active.filter((u) => u.is_master).length;

  const seeTeam = (sector: string) => {
    onSeeTeam();
    maxEmit('hub:users', { sector });
  };

  return (
    <div className="section-scroll">
      <div className="section-pad hub-wide">
        <div className="section-head">
          <div>
            <h1>
              {greetingFor()}
              {me ? `, ${firstName(me.display_name)}` : ''}
            </h1>
            <p>Daqui você administra todos os setores do Max Hub: quem entra, em qual setor e com quais permissões.</p>
          </div>
        </div>

        {failed ? (
          <div className="rc-empty">
            {failed}{' '}
            <button className="btn btn-ghost btn-sm" onClick={retry}>
              Tentar de novo
            </button>
          </div>
        ) : null}

        <div className="hub-strip">
          <div>
            <strong>{users ? active.length : '–'}</strong>
            <span>pessoas com acesso</span>
          </div>
          <div>
            <strong>{SECTORS.length}</strong>
            <span>setores</span>
          </div>
          <div>
            <strong>{users ? mastersCount : '–'}</strong>
            <span>{mastersCount === 1 ? 'master geral' : 'masters gerais'}</span>
          </div>
        </div>

        {unassigned.length ? (
          <button className="hub-warn" onClick={() => seeTeam('none')}>
            <TriangleAlert size={18} />
            <span>
              <b>{unassigned.length === 1 ? '1 pessoa está sem setor' : `${unassigned.length} pessoas estão sem setor`}</b> e não{' '}
              {unassigned.length === 1 ? 'consegue' : 'conseguem'} usar nenhuma ferramenta:{' '}
              {listJoin(unassigned.slice(0, 3).map((u) => u.display_name))}
              {unassigned.length > 3 ? ' e outras' : ''}. Alocar agora
            </span>
          </button>
        ) : null}

        <div className="hub-grid">
          {SECTORS.map((s) => {
            const Icon = ICON[s.slug];
            const team = (users ?? []).filter((u) => u.sector === s.slug && !u.is_master);
            const masters = team.filter((u) => u.sector_role === 'master' && u.active);
            return (
              <article className="hub-card" key={s.slug}>
                <header>
                  <span className="hub-card-icon">
                    <Icon size={20} />
                  </span>
                  <span className={`badge ${s.ready ? 'mint' : 'gray'}`}>{s.ready ? 'Em uso' : 'Em preparação'}</span>
                </header>
                <h2>{s.name}</h2>
                <p>{s.description}</p>
                <dl>
                  <div>
                    <dt>Equipe</dt>
                    <dd>{users ? (team.length === 1 ? '1 pessoa' : `${team.length} pessoas`) : '…'}</dd>
                  </div>
                  <div>
                    <dt>Master do setor</dt>
                    <dd className={masters.length ? '' : 'is-missing'}>
                      {masters.length ? (
                        <>
                          <Crown size={13} /> {listJoin(masters.map((u) => firstName(u.display_name)))}
                        </>
                      ) : (
                        'não definido'
                      )}
                    </dd>
                  </div>
                </dl>
                <footer>
                  <a className="btn btn-primary btn-sm" href={sectorPath(s.slug)}>
                    Abrir ferramenta <ArrowUpRight size={15} />
                  </a>
                  <button className="btn btn-ghost btn-sm" onClick={() => seeTeam(s.slug)}>
                    Ver equipe
                  </button>
                </footer>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
