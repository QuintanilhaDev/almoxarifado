'use client';
import { AnimatePresence } from 'framer-motion';
import { Crown, Eye, EyeOff, Save, Search, SearchX, Trash2, UserPlus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ApiError, api } from '../core/api';
import { ConfirmModal } from '../core/Modal';
import { PermissionsEditor, permissionSummary } from '../core/PermissionsEditor';
import { Sheet } from '../core/Sheet';
import { useToast } from '../core/Toasts';
import { formatDateTime, initials, timeAgo } from '@/lib/format';
import { USERNAME_HELP, USERNAME_RE, fullPermissions, sanitizePermissions, type HubUser, type HubUserRow, type Permissions, type SectorRole } from '@/lib/permissions';
import { SECTORS, getSector } from '@/lib/sectors';
import { useMaxBus } from '@/lib/max/bus';
import { normalize } from '@/lib/max/text';

type Filter = 'todos' | 'masters' | 'none' | string;
interface Draft {
  name?: string;
  sector?: string;
  master?: boolean;
}

/** Cadastro de usuários do Max Hub (só master geral). */
export function UsersAdmin({
  me,
  users,
  setUsers,
  failed,
  reload,
}: {
  me: HubUser | null;
  users: HubUserRow[] | null;
  setUsers: React.Dispatch<React.SetStateAction<HubUserRow[] | null>>;
  failed: string;
  reload: () => Promise<void>;
}) {
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('todos');
  const [creating, setCreating] = useState<Draft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  // pedidos da Max: "criar usuário", "quem está no RH", "em que setor está a Juliana"
  useMaxBus('hub:users', (p) => {
    if (p.create) {
      setEditingId(null);
      setCreating(p.create);
    }
    if (p.sector !== undefined) {
      setFilter(p.sector);
      setQuery('');
    }
    if (p.query !== undefined) {
      setFilter('todos');
      setQuery(p.query);
    }
  });

  const list = users ?? [];
  const counts = useMemo(() => {
    const c: Record<string, number> = { todos: list.length, masters: 0, none: 0 };
    for (const s of SECTORS) c[s.slug] = 0;
    for (const u of list) {
      if (u.is_master) c.masters++;
      else if (u.sector && c[u.sector] !== undefined) c[u.sector]++;
      else c.none++;
    }
    return c;
  }, [list]);

  const shown = useMemo(() => {
    const q = normalize(query);
    return list
      .filter((u) => {
        if (filter === 'masters' && !u.is_master) return false;
        if (filter === 'none' && (u.is_master || u.sector)) return false;
        if (filter !== 'todos' && filter !== 'masters' && filter !== 'none' && (u.is_master || u.sector !== filter)) return false;
        if (!q) return true;
        return normalize(`${u.display_name} ${u.username} ${getSector(u.sector)?.name ?? ''}`).includes(q);
      })
      .sort((a, b) => Number(b.is_master) - Number(a.is_master) || Number(b.active) - Number(a.active) || a.display_name.localeCompare(b.display_name, 'pt-BR'));
  }, [list, filter, query]);

  const editing = editingId ? list.find((u) => u.id === editingId) ?? null : null;
  const chips: { id: Filter; label: string }[] = [
    { id: 'todos', label: 'Todos' },
    { id: 'masters', label: 'Masters gerais' },
    ...SECTORS.map((s) => ({ id: s.slug as Filter, label: s.short })),
    ...(counts.none ? [{ id: 'none' as Filter, label: 'Sem setor' }] : []),
  ];

  return (
    <div className="section-scroll">
      <div className="section-pad hub-wide">
        <div className="section-head">
          <div>
            <h1>Usuários</h1>
            <p>Crie acessos, aloque cada pessoa no setor dela e defina quem é master. A mudança vale na hora, sem a pessoa precisar entrar de novo.</p>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => setCreating({})}>
            <UserPlus size={16} /> Novo usuário
          </button>
        </div>

        <div className="users-tools">
          <div className="search">
            <Search size={17} />
            <input className="input" placeholder="Buscar por nome, usuário ou setor" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar usuários" />
          </div>
          <div className="filter-chips" role="tablist" aria-label="Filtrar usuários">
            {chips.map((c) => (
              <button key={c.id} role="tab" aria-selected={filter === c.id} className={filter === c.id ? 'is-active' : ''} onClick={() => setFilter(c.id)}>
                {c.label} <span>{counts[c.id] ?? 0}</span>
              </button>
            ))}
          </div>
        </div>

        {failed && !users ? (
          <div className="rc-empty">
            {failed}{' '}
            <button className="btn btn-ghost btn-sm" onClick={reload}>
              Tentar de novo
            </button>
          </div>
        ) : !users ? (
          <div className="rc-empty">
            <span className="spinner" /> Carregando…
          </div>
        ) : shown.length === 0 ? (
          <div className="empty">
            <span className="empty-icon">
              <SearchX size={24} />
            </span>
            <strong>Ninguém por aqui</strong>
            <span>{query ? 'Nenhum usuário combina com a busca.' : 'Nenhum usuário neste filtro. Use “Novo usuário” para criar um acesso.'}</span>
          </div>
        ) : (
          <div className="users-list">
            {shown.map((u) => {
              const s = getSector(u.sector);
              return (
                <button className={`user-row is-button${u.active ? '' : ' is-off'}`} key={u.id} onClick={() => setEditingId(u.id)} aria-label={`Editar ${u.display_name}`}>
                  <span className="me-avatar">{initials(u.display_name)}</span>
                  <div className="user-main">
                    <b>
                      {u.display_name}
                      {u.is_master ? (
                        <span className="badge lilac">
                          <Crown size={12} /> master geral
                        </span>
                      ) : u.sector_role === 'master' && s ? (
                        <span className="badge lilac">
                          <Crown size={12} /> master do setor
                        </span>
                      ) : null}
                      {u.id === me?.id ? <span className="badge gray">você</span> : null}
                      {!u.active ? <span className="badge gray">desativado</span> : null}
                    </b>
                    <small>
                      @{u.username} · {u.is_master ? 'Todos os setores' : s ? s.name : 'Sem setor'}
                      {!u.is_master && s && u.sector_role !== 'master' && s.modules.length ? ` · ${permissionSummary(u.sector, u.permissions)}` : ''}
                    </small>
                  </div>
                  <span className="user-when">{u.last_login_at ? `entrou ${timeAgo(u.last_login_at) === 'agora' ? 'agora' : 'há ' + timeAgo(u.last_login_at)}` : 'nunca entrou'}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <AnimatePresence>
        {creating ? (
          <UserSheet
            key="new"
            me={me}
            draft={creating}
            onClose={() => setCreating(null)}
            onSaved={(u) => {
              setCreating(null);
              setUsers((l) => (l ? [...l, u] : [u]));
              toast({ kind: 'success', title: 'Usuário criado', text: `@${u.username} já pode entrar.` });
            }}
          />
        ) : null}
        {editing ? (
          <UserSheet
            key={editing.id}
            me={me}
            user={editing}
            onClose={() => setEditingId(null)}
            onSaved={(u) => {
              setEditingId(null);
              setUsers((l) => (l ? l.map((x) => (x.id === u.id ? u : x)) : l));
              toast({ kind: 'success', title: 'Usuário atualizado', text: u.display_name });
            }}
            onDeleted={(id) => {
              setEditingId(null);
              setUsers((l) => (l ? l.filter((x) => x.id !== id) : l));
              toast({ kind: 'success', title: 'Usuário excluído' });
            }}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function titleCase(s: string) {
  return s.replace(/\S+/g, (w) => w[0].toUpperCase() + w.slice(1));
}

function suggestUsername(name: string): string {
  const parts = normalize(name).replace(/[^a-z0-9 ]/g, '').split(' ').filter(Boolean);
  if (!parts.length) return '';
  const base = parts.length > 1 ? `${parts[0]}.${parts[parts.length - 1]}` : parts[0];
  return base.slice(0, 30);
}

function UserSheet({
  me,
  user,
  draft,
  onClose,
  onSaved,
  onDeleted,
}: {
  me: HubUser | null;
  user?: HubUserRow;
  draft?: Draft;
  onClose: () => void;
  onSaved: (u: HubUserRow) => void;
  onDeleted?: (id: string) => void;
}) {
  const isNew = !user;
  const self = Boolean(user && user.id === me?.id);
  const [name, setName] = useState(user?.display_name ?? (draft?.name ? titleCase(draft.name) : ''));
  const [username, setUsername] = useState(user?.username ?? (draft?.name ? suggestUsername(draft.name) : ''));
  const [userTouched, setUserTouched] = useState(Boolean(user));
  const [pass, setPass] = useState('');
  const [show, setShow] = useState(false);
  const [kind, setKind] = useState<'setor' | 'master'>(user ? (user.is_master ? 'master' : 'setor') : draft?.master ? 'master' : 'setor');
  const [sector, setSector] = useState<string>(user?.sector ?? draft?.sector ?? '');
  const [role, setRole] = useState<SectorRole>(user?.sector_role ?? 'member');
  const [perms, setPerms] = useState<Permissions>(() => (user?.sector ? sanitizePermissions(user.sector, user.permissions) : fullPermissions(draft?.sector ?? '', 'view')));
  const [active, setActive] = useState(user?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const def = getSector(sector);

  const changeSector = (slug: string) => {
    setSector(slug);
    // permissões são por setor: ao trocar, recomeça só visualizando
    setPerms(slug && slug === user?.sector ? sanitizePermissions(slug, user.permissions) : fullPermissions(slug, 'view'));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.display_name = 'Digite o nome da pessoa.';
    if (!USERNAME_RE.test(username)) errs.username = USERNAME_HELP;
    if (isNew || pass) {
      if (pass.length < 6) errs.password = 'Use pelo menos 6 caracteres.';
      else if (new TextEncoder().encode(pass).length > 72) errs.password = 'No máximo 72 caracteres.';
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    const alloc = {
      is_master: kind === 'master',
      sector: kind === 'master' ? null : sector || null,
      sector_role: kind === 'master' || !sector ? 'member' : role,
      permissions: kind === 'master' || !sector ? {} : perms,
    };
    try {
      const j = isNew
        ? await api<{ user: HubUserRow }>('/api/hub/users', { method: 'POST', json: { display_name: name.trim(), username, password: pass, ...alloc } })
        : await api<{ user: HubUserRow }>(`/api/hub/users/${user!.id}`, {
            method: 'PATCH',
            json: { display_name: name.trim(), username, ...(pass ? { new_password: pass } : {}), ...alloc, ...(self ? {} : { active }) },
          });
      onSaved(j.user);
    } catch (err) {
      const field = err instanceof ApiError ? String(err.data.field || '') : '';
      const key = field === 'new_password' ? 'password' : field || 'form';
      setErrors({ [key]: (err as Error).message });
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!user) return;
    setBusy(true);
    try {
      await api(`/api/hub/users/${user.id}`, { method: 'DELETE' });
      onDeleted?.(user.id);
    } catch (err) {
      setConfirmDelete(false);
      setErrors({ form: (err as Error).message });
      setBusy(false);
    }
  };

  const err = (k: string) => (errors[k] ? <div className="field-error">{errors[k]}</div> : null);

  return (
    <>
      <Sheet
        title={isNew ? 'Novo usuário' : user!.display_name}
        lead={isNew ? 'A pessoa entra com o usuário e a senha definidos aqui e vai direto para o setor dela.' : `@${user!.username} · criado em ${formatDateTime(user!.created_at)}`}
        onClose={() => !busy && !confirmDelete && onClose()}
        wide
      >
        <form onSubmit={submit} noValidate className="user-form">
          <div className="form-grid">
            <div className={errors.display_name ? 'has-error' : ''}>
              <label className="label" htmlFor="hu-name">
                Nome
              </label>
              <input
                id="hu-name"
                className="input"
                maxLength={40}
                value={name}
                autoFocus={isNew}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!userTouched) setUsername(suggestUsername(e.target.value));
                }}
              />
              {err('display_name')}
            </div>
            <div className={errors.username ? 'has-error' : ''}>
              <label className="label" htmlFor="hu-user">
                Usuário de login
              </label>
              <input
                id="hu-user"
                className="input"
                maxLength={30}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="off"
                value={username}
                onChange={(e) => {
                  setUserTouched(true);
                  setUsername(e.target.value.toLowerCase().replace(/\s/g, ''));
                }}
              />
              {err('username')}
            </div>
            <div className={`full${errors.password ? ' has-error' : ''}`}>
              <label className="label" htmlFor="hu-pass">
                {isNew ? 'Senha' : 'Nova senha'}
              </label>
              {!isNew ? <span className="help">Deixe em branco para manter a senha atual.</span> : null}
              <div className="pass-wrap">
                <input id="hu-pass" className="input" type={show ? 'text' : 'password'} autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} />
                <button type="button" className="icon-btn" onClick={() => setShow((s) => !s)} aria-label={show ? 'Esconder senha' : 'Mostrar senha'}>
                  {show ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {err('password')}
            </div>
          </div>

          <fieldset className="user-kind">
            <legend className="label">Tipo de acesso</legend>
            <div className="kind-opts">
              <label className={kind === 'setor' ? 'is-active' : ''}>
                <input type="radio" name="hu-kind" checked={kind === 'setor'} disabled={self} onChange={() => setKind('setor')} />
                <b>Usuário de setor</b>
                <small>Entra e vai direto para a ferramenta do setor em que está alocado.</small>
              </label>
              <label className={kind === 'master' ? 'is-active' : ''}>
                <input type="radio" name="hu-kind" checked={kind === 'master'} disabled={self} onChange={() => setKind('master')} />
                <b>
                  <Crown size={14} /> Master geral
                </b>
                <small>Acessa este painel, todos os setores e o cadastro de usuários.</small>
              </label>
            </div>
            {self ? <span className="help" style={{ marginTop: 8 }}>Você não pode tirar o seu próprio acesso master. Outro master geral pode fazer isso.</span> : null}
            {errors.is_master ? <div className="field-error">{errors.is_master}</div> : null}
          </fieldset>

          {kind === 'setor' ? (
            <>
              <div className="form-grid">
                <div className={errors.sector ? 'has-error' : ''}>
                  <label className="label" htmlFor="hu-sector">
                    Setor
                  </label>
                  <select id="hu-sector" className="select" value={sector} onChange={(e) => changeSector(e.target.value)}>
                    <option value="">Sem setor (ainda não acessa nada)</option>
                    {SECTORS.map((s) => (
                      <option key={s.slug} value={s.slug}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  {err('sector')}
                </div>
                {sector ? (
                  <div>
                    <label className="label" htmlFor="hu-role">
                      Papel no setor
                    </label>
                    <select id="hu-role" className="select" value={role} onChange={(e) => setRole(e.target.value as SectorRole)}>
                      <option value="member">Membro (permissões abaixo)</option>
                      <option value="master">Master do setor (acesso total)</option>
                    </select>
                  </div>
                ) : null}
              </div>
              {sector && role === 'master' ? (
                <p className="perm-none">
                  Como master de {def?.name}, a pessoa tem acesso total à ferramenta do setor e define as permissões dos outros membros na aba Equipe.
                </p>
              ) : null}
              {sector && role === 'member' ? (
                <div>
                  <span className="label">Permissões em {def?.name}</span>
                  <PermissionsEditor sector={sector} value={perms} onChange={setPerms} disabled={busy} />
                </div>
              ) : null}
            </>
          ) : null}

          {!isNew ? (
            <label className={`switch-row${self ? ' is-disabled' : ''}`}>
              <input type="checkbox" checked={active} disabled={self} onChange={(e) => setActive(e.target.checked)} />
              <span>
                <b>Acesso ativo</b>
                <small>{self ? 'Você não pode desativar o seu próprio acesso.' : 'Desmarque para bloquear a entrada sem apagar o usuário. Vale na hora.'}</small>
              </span>
            </label>
          ) : null}
          {errors.active ? <div className="field-error">{errors.active}</div> : null}
          {errors.form ? <div className="field-error">{errors.form}</div> : null}

          <div className="modal-actions user-actions">
            {!isNew && !self ? (
              <button type="button" className="btn btn-danger btn-sm" style={{ marginRight: 'auto' }} onClick={() => setConfirmDelete(true)} disabled={busy}>
                <Trash2 size={15} /> Excluir
              </button>
            ) : null}
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? <span className="spinner" /> : isNew ? <UserPlus size={17} /> : <Save size={17} />} {isNew ? 'Criar usuário' : 'Salvar'}
            </button>
          </div>
        </form>
      </Sheet>
      <ConfirmModal
        open={confirmDelete}
        title={`Excluir ${user?.display_name ?? ''}?`}
        text="O acesso é apagado e a pessoa não entra mais. O que ela registrou (solicitações, movimentações) continua no histórico com o nome dela. Para só bloquear, desmarque “Acesso ativo”."
        confirmLabel="Excluir usuário"
        danger
        busy={busy}
        onConfirm={remove}
        onClose={() => !busy && setConfirmDelete(false)}
      />
    </>
  );
}
