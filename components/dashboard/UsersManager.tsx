'use client';
import { Crown, Eye, EyeOff, KeyRound, Save, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { formatDateTime } from '@/lib/format';
import type { AdminListItem, AdminUser } from '@/lib/types';
import { useToast } from '../Toasts';
import { ApiError, api } from './api';
import { Sheet } from './StockModals';

export function UsersManager({ me, version }: { me: AdminUser | null; version: number }) {
  const toast = useToast();
  const [users, setUsers] = useState<AdminListItem[] | null>(null);
  const [failed, setFailed] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminListItem | null>(null);

  const load = useCallback(async () => {
    try {
      const j = await api<{ users: AdminListItem[] }>('/api/admin/users');
      setUsers(j.users);
      setFailed('');
    } catch (e) {
      setFailed((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load, version]);

  return (
    <div className="section-scroll">
      <div className="section-pad" style={{ maxWidth: 820 }}>
        <div className="section-head">
          <div>
            <h1>Usuários</h1>
            <p>Crie acessos para a equipe e troque senhas. Só o usuário master vê esta área.</p>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
            <UserPlus size={16} /> Novo usuário
          </button>
        </div>

        {failed ? (
          <div className="rc-empty">
            {failed} <button className="btn btn-ghost btn-sm" onClick={load}>Tentar de novo</button>
          </div>
        ) : !users ? (
          <div className="rc-empty">
            <span className="spinner" /> Carregando…
          </div>
        ) : (
          <div className="users-list">
            {users.map((u) => (
              <div className="user-row" key={u.id}>
                <div className="user-main">
                  <b>
                    {u.display_name} {u.is_master ? <Crown size={14} className="user-crown" aria-label="Master" /> : null}
                    {u.id === me?.id ? <span className="badge gray">você</span> : null}
                  </b>
                  <small>
                    @{u.username} · criado em {formatDateTime(u.created_at)}
                  </small>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => setEditing(u)}>
                  <KeyRound size={15} /> Trocar senha
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {creating ? (
        <CreateUser
          onClose={() => setCreating(false)}
          onDone={(u) => {
            setCreating(false);
            toast({ kind: 'success', title: 'Usuário criado', text: `@${u.username} já pode entrar.` });
            load();
          }}
        />
      ) : null}
      {editing ? (
        <PasswordSheet
          user={editing}
          self={editing.id === me?.id}
          onClose={() => setEditing(null)}
          onDone={() => {
            toast({
              kind: 'success',
              title: 'Senha alterada',
              text: editing.id === me?.id ? 'Use a nova senha no próximo login.' : `Avise ${editing.display_name} da nova senha.`,
            });
            setEditing(null);
          }}
        />
      ) : null}
    </div>
  );
}

function PassFields({ pass, setPass, again, setAgain, show, setShow, errors }: {
  pass: string;
  setPass: (v: string) => void;
  again: string;
  setAgain: (v: string) => void;
  show: boolean;
  setShow: (f: (s: boolean) => boolean) => void;
  errors: Record<string, string>;
}) {
  return (
    <>
      <div className={errors.password ? 'has-error' : ''}>
        <label className="label" htmlFor="um-pass">
          Senha
        </label>
        <div className="pass-wrap">
          <input id="um-pass" className="input" type={show ? 'text' : 'password'} autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} />
          <button type="button" className="icon-btn" onClick={() => setShow((s) => !s)} aria-label={show ? 'Esconder senhas' : 'Mostrar senhas'}>
            {show ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
        {errors.password ? <div className="field-error">{errors.password}</div> : null}
      </div>
      <div className={errors.again ? 'has-error' : ''} style={{ marginTop: 12 }}>
        <label className="label" htmlFor="um-again">
          Repita a senha
        </label>
        <input id="um-again" className="input" type={show ? 'text' : 'password'} autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
        {errors.again ? <div className="field-error">{errors.again}</div> : null}
      </div>
    </>
  );
}

function checkPass(pass: string, again: string, errs: Record<string, string>) {
  if (pass.length < 6) errs.password = 'Use pelo menos 6 caracteres.';
  else if (new TextEncoder().encode(pass).length > 72) errs.password = 'No máximo 72 caracteres.';
  else if (pass !== again) errs.again = 'As senhas não são iguais.';
}

function CreateUser({ onClose, onDone }: { onClose: () => void; onDone: (u: AdminListItem) => void }) {
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [pass, setPass] = useState('');
  const [again, setAgain] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.display_name = 'Digite o nome da pessoa.';
    if (!/^[a-z0-9._-]{3,30}$/.test(username)) errs.username = 'De 3 a 30 caracteres: letras minúsculas, números, ponto, hífen ou _.';
    checkPass(pass, again, errs);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const j = await api<{ user: AdminListItem }>('/api/admin/users', {
        method: 'POST',
        json: { display_name: name.trim(), username, password: pass },
      });
      onDone(j.user);
    } catch (err) {
      const field = err instanceof ApiError ? String(err.data.field || '') : '';
      setErrors({ [field === 'password' ? 'password' : field || 'form']: (err as Error).message });
      setBusy(false);
    }
  };

  return (
    <Sheet title="Novo usuário" lead="A pessoa entra com o usuário e a senha que você definir aqui." onClose={() => !busy && onClose()}>
      <form onSubmit={submit} noValidate>
        <div className={errors.display_name ? 'has-error' : ''}>
          <label className="label" htmlFor="um-name">
            Nome
          </label>
          <input id="um-name" className="input" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          {errors.display_name ? <div className="field-error">{errors.display_name}</div> : null}
        </div>
        <div className={errors.username ? 'has-error' : ''} style={{ marginTop: 12 }}>
          <label className="label" htmlFor="um-user">
            Usuário de login
          </label>
          <input
            id="um-user"
            className="input"
            maxLength={30}
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s/g, ''))}
          />
          {errors.username ? <div className="field-error">{errors.username}</div> : null}
        </div>
        <div style={{ marginTop: 12 }}>
          <PassFields pass={pass} setPass={setPass} again={again} setAgain={setAgain} show={show} setShow={setShow} errors={errors} />
        </div>
        {errors.form ? <div className="field-error" style={{ marginTop: 10 }}>{errors.form}</div> : null}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? <span className="spinner" /> : <UserPlus size={17} />} Criar usuário
          </button>
        </div>
      </form>
    </Sheet>
  );
}

function PasswordSheet({ user, self, onClose, onDone }: { user: AdminListItem; self: boolean; onClose: () => void; onDone: () => void }) {
  const [pass, setPass] = useState('');
  const [again, setAgain] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    checkPass(pass, again, errs);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await api(`/api/admin/users/${user.id}`, { method: 'PATCH', json: { new_password: pass } });
      onDone();
    } catch (err) {
      setErrors({ password: (err as Error).message });
      setBusy(false);
    }
  };

  return (
    <Sheet
      title={self ? 'Trocar a minha senha' : `Nova senha de ${user.display_name}`}
      lead={self ? 'Vale a partir do próximo login.' : `@${user.username} usará a nova senha no próximo login.`}
      onClose={() => !busy && onClose()}
    >
      <form onSubmit={submit} noValidate>
        <PassFields pass={pass} setPass={setPass} again={again} setAgain={setAgain} show={show} setShow={setShow} errors={errors} />
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? <span className="spinner" /> : <Save size={17} />} Salvar senha
          </button>
        </div>
      </form>
    </Sheet>
  );
}
