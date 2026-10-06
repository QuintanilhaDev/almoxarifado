'use client';
import { Eye, EyeOff, LogOut, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AdminUser } from '@/lib/types';
import { useToast } from '../Toasts';
import { ApiError, api } from './api';

export function AccountSettings({
  user,
  setUser,
  onLogout,
}: {
  user: AdminUser | null;
  setUser: (u: AdminUser) => void;
  onLogout: () => void;
}) {
  const toast = useToast();
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (user) {
      setDisplayName(user.display_name);
      setUsername(user.username);
    }
  }, [user]);

  const credentialsChanged = Boolean(user) && (username.trim().toLowerCase() !== user!.username || next.length > 0);
  const changed = Boolean(user) && (displayName.trim() !== user!.display_name || credentialsChanged);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!displayName.trim()) errs.display_name = 'Digite seu nome.';
    if (!/^[a-z0-9._-]{3,30}$/.test(username.trim().toLowerCase()))
      errs.username = 'De 3 a 30 caracteres: letras, números, ponto, hífen ou _. Sem espaços.';
    if (next && next.length < 6) errs.new_password = 'Use pelo menos 6 caracteres.';
    if (next && next !== confirm) errs.confirm = 'As senhas não são iguais.';
    if (credentialsChanged && !current) errs.current_password = 'Digite sua senha atual para confirmar.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const j = await api<{ user: AdminUser }>('/api/admin/account', {
        method: 'PATCH',
        json: {
          display_name: displayName.trim(),
          username: username.trim().toLowerCase(),
          current_password: current,
          new_password: next || undefined,
        },
      });
      setUser(j.user);
      setCurrent('');
      setNext('');
      setConfirm('');
      toast({ kind: 'success', title: 'Conta atualizada', text: next ? 'Use a nova senha no próximo login.' : undefined });
    } catch (err) {
      const field = err instanceof ApiError ? String(err.data.field || '') : '';
      if (field) setErrors({ [field]: (err as Error).message });
      else toast({ kind: 'error', title: 'Não foi possível salvar', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const err = (k: string) => (errors[k] ? <div className="field-error">{errors[k]}</div> : null);

  return (
    <div className="section-scroll">
      <div className="section-pad" style={{ maxWidth: 720 }}>
        <div className="section-head">
          <div>
            <h1>Minha conta</h1>
            <p>Altere como seu nome aparece, seu usuário de login e sua senha.</p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onLogout}>
            <LogOut size={15} /> Sair
          </button>
        </div>

        <form className="account-grid" onSubmit={save} noValidate>
          <div className="panel">
            <h2>Perfil</h2>
            <p>O nome é usado na saudação e aparece em quem resolveu cada solicitação.</p>
            <div className="form-grid">
              <div className={errors.display_name ? 'has-error' : ''}>
                <label className="label" htmlFor="ac-name">
                  Nome
                </label>
                <input id="ac-name" className="input" value={displayName} maxLength={40} onChange={(e) => setDisplayName(e.target.value)} />
                {err('display_name')}
              </div>
              <div className={errors.username ? 'has-error' : ''}>
                <label className="label" htmlFor="ac-user">
                  Usuário de login
                </label>
                <input
                  id="ac-user"
                  className="input"
                  value={username}
                  autoCapitalize="none"
                  spellCheck={false}
                  maxLength={30}
                  onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s/g, ''))}
                />
                {err('username')}
              </div>
            </div>
          </div>

          <div className="panel">
            <h2>Senha</h2>
            <p>Deixe em branco para manter a senha atual.</p>
            <div className="form-grid">
              <div className={`full${errors.new_password ? ' has-error' : ''}`}>
                <label className="label" htmlFor="ac-new">
                  Nova senha
                </label>
                <div className="pass-wrap">
                  <input
                    id="ac-new"
                    className="input"
                    type={show ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={next}
                    onChange={(e) => setNext(e.target.value)}
                  />
                  <button type="button" className="icon-btn" onClick={() => setShow((s) => !s)} aria-label={show ? 'Esconder senhas' : 'Mostrar senhas'}>
                    {show ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {err('new_password')}
              </div>
              <div className={`full${errors.confirm ? ' has-error' : ''}`}>
                <label className="label" htmlFor="ac-confirm">
                  Repita a nova senha
                </label>
                <input
                  id="ac-confirm"
                  className="input"
                  type={show ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
                {err('confirm')}
              </div>
            </div>
          </div>

          {credentialsChanged ? (
            <div className={`panel${errors.current_password ? ' has-error' : ''}`}>
              <label className="label" htmlFor="ac-current">
                Senha atual
              </label>
              <span className="help">Necessária para trocar o usuário ou a senha.</span>
              <input
                id="ac-current"
                className="input"
                type={show ? 'text' : 'password'}
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
              {err('current_password')}
            </div>
          ) : null}

          <div className="panel-foot" style={{ marginTop: 0 }}>
            <button className="btn btn-primary" type="submit" disabled={!changed || busy}>
              {busy ? <span className="spinner" /> : <Save size={17} />} Salvar alterações
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
