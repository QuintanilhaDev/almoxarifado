'use client';
import { AnimatePresence } from 'framer-motion';
import { Crown, Save, SlidersHorizontal, UsersRound } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { initials } from '@/lib/format';
import { sanitizePermissions, type HubUser, type HubUserRow, type Permissions } from '@/lib/permissions';
import { getSector } from '@/lib/sectors';
import { ApiError, api } from './api';
import { PermissionsEditor, permissionSummary } from './PermissionsEditor';
import { Sheet } from './Sheet';
import { useToast } from './Toasts';

/**
 * Aba "Equipe" de cada setor. O master do setor (e o master geral) vê quem está no setor
 * e ajusta as permissões de cada membro. Criar pessoas e trocar setor é no painel master.
 */
export function TeamManager({ slug, me, version }: { slug: string; me: HubUser | null; version: number }) {
  const toast = useToast();
  const sector = getSector(slug);
  const [users, setUsers] = useState<HubUserRow[] | null>(null);
  const [failed, setFailed] = useState('');
  const [editing, setEditing] = useState<HubUserRow | null>(null);

  const load = useCallback(async () => {
    try {
      const j = await api<{ users: HubUserRow[] }>(`/api/setor/${slug}/equipe`);
      setUsers(j.users);
      setFailed('');
    } catch (e) {
      setFailed((e as Error).message);
    }
  }, [slug]);
  useEffect(() => {
    load();
  }, [load, version]);

  if (!sector) return null;
  const masters = (users ?? []).filter((u) => u.sector_role === 'master');
  const members = (users ?? []).filter((u) => u.sector_role !== 'master');

  return (
    <div className="section-scroll">
      <div className="section-pad" style={{ maxWidth: 860 }}>
        <div className="section-head">
          <div>
            <h1>Equipe</h1>
            <p>
              Quem trabalha em {sector.name} e o que cada pessoa pode ver e alterar aqui.
              {me?.is_master ? (
                <>
                  {' '}
                  Para criar pessoas ou trocar de setor, use o <a href="/hub#usuarios">painel master</a>.
                </>
              ) : (
                ' Novos acessos e trocas de setor são feitos pelo master geral.'
              )}
            </p>
          </div>
        </div>

        {failed ? (
          <div className="rc-empty">
            {failed}{' '}
            <button className="btn btn-ghost btn-sm" onClick={load}>
              Tentar de novo
            </button>
          </div>
        ) : !users ? (
          <div className="rc-empty">
            <span className="spinner" /> Carregando…
          </div>
        ) : users.length === 0 ? (
          <div className="empty">
            <span className="empty-icon">
              <UsersRound size={24} />
            </span>
            <strong>Ninguém alocado em {sector.name} ainda</strong>
            <span>O master geral aloca as pessoas pelo painel master, em Usuários.</span>
          </div>
        ) : (
          <div className="users-list">
            {[...masters, ...members].map((u) => {
              const isMaster = u.sector_role === 'master';
              return (
                <div className={`user-row${u.active ? '' : ' is-off'}`} key={u.id}>
                  <span className="me-avatar">{initials(u.display_name)}</span>
                  <div className="user-main">
                    <b>
                      {u.display_name}
                      {isMaster ? (
                        <span className="badge lilac">
                          <Crown size={12} /> master do setor
                        </span>
                      ) : null}
                      {u.id === me?.id ? <span className="badge gray">você</span> : null}
                      {!u.active ? <span className="badge gray">desativado</span> : null}
                    </b>
                    <small>
                      @{u.username} · {isMaster ? 'Acesso total à ferramenta e às permissões' : permissionSummary(slug, u.permissions)}
                    </small>
                  </div>
                  {!isMaster && sector.modules.length ? (
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditing(u)}>
                      <SlidersHorizontal size={15} /> Permissões
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
        {users && users.length > 0 && !sector.modules.length ? (
          <p className="perm-none" style={{ marginTop: 18 }}>
            A ferramenta de {sector.name} ainda não tem módulos. Quando ganhar funções, as permissões de cada pessoa aparecem aqui.
          </p>
        ) : null}
      </div>

      <AnimatePresence>
        {editing ? (
          <PermissionSheet
            key={editing.id}
            slug={slug}
            user={editing}
            onClose={() => setEditing(null)}
            onSaved={(u) => {
              setUsers((list) => (list ? list.map((x) => (x.id === u.id ? u : x)) : list));
              setEditing(null);
              toast({ kind: 'success', title: 'Permissões salvas', text: `Já valem para ${u.display_name}.` });
            }}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function PermissionSheet({ slug, user, onClose, onSaved }: { slug: string; user: HubUserRow; onClose: () => void; onSaved: (u: HubUserRow) => void }) {
  const [perms, setPerms] = useState<Permissions>(() => sanitizePermissions(slug, user.permissions));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const j = await api<{ user: HubUserRow }>(`/api/setor/${slug}/equipe/${user.id}`, { method: 'PATCH', json: { permissions: perms } });
      onSaved(j.user);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível salvar.');
      setBusy(false);
    }
  };
  return (
    <Sheet title={`Permissões de ${user.display_name}`} lead={`@${user.username} · vale assim que você salvar, sem a pessoa precisar entrar de novo.`} onClose={() => !busy && onClose()} wide>
      <PermissionsEditor sector={slug} value={perms} onChange={setPerms} disabled={busy} />
      {error ? <div className="field-error">{error}</div> : null}
      <div className="modal-actions" style={{ marginTop: 20 }}>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
          Cancelar
        </button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>
          {busy ? <span className="spinner" /> : <Save size={17} />} Salvar permissões
        </button>
      </div>
    </Sheet>
  );
}
