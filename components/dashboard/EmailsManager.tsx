'use client';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, MailPlus, Search, Trash2, UserCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { formatDateTime, initials } from '@/lib/format';
import type { AuthorizedEmail, FormField } from '@/lib/types';
import { useToast } from '../Toasts';
import { api } from './api';

export function EmailsManager({
  emails,
  reload,
  setEmails,
}: {
  emails: AuthorizedEmail[] | null;
  reload: () => Promise<void>;
  setEmails: React.Dispatch<React.SetStateAction<AuthorizedEmail[] | null>>;
}) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [posto, setPosto] = useState('');
  const [postos, setPostos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [armed, setArmed] = useState<string | null>(null);

  useEffect(() => {
    api<{ fields: FormField[] }>('/api/form')
      .then((j) => setPostos(j.fields.find((f) => f.system === 'posto')?.options || []))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 3500);
    return () => clearTimeout(t);
  }, [armed]);

  const count = useMemo(() => text.split(/[\s,;]+/).filter(Boolean).length, [text]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!text.trim()) {
      setError('Digite pelo menos um e-mail.');
      return;
    }
    setBusy(true);
    try {
      const j = await api<{ added: number; duplicates: number; invalid: string[] }>('/api/admin/emails', {
        method: 'POST',
        json: { emails: text, supervisor_name: name, posto },
      });
      const parts = [];
      if (j.duplicates) parts.push(`${j.duplicates} já estava${j.duplicates > 1 ? 'm' : ''} na lista`);
      if (j.invalid.length) parts.push(`ignorado${j.invalid.length > 1 ? 's' : ''}: ${j.invalid.join(', ')}`);
      toast({
        kind: j.added ? 'success' : 'info',
        title: j.added ? `${j.added} e-mail${j.added > 1 ? 's' : ''} autorizado${j.added > 1 ? 's' : ''}` : 'Nenhum e-mail novo',
        text: parts.join('. ') || undefined,
      });
      setText('');
      setName('');
      setPosto('');
      reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (item: AuthorizedEmail) => {
    if (armed !== item.id) {
      setArmed(item.id);
      return;
    }
    setArmed(null);
    setEmails((l) => (l ? l.filter((x) => x.id !== item.id) : l));
    try {
      await api(`/api/admin/emails?id=${item.id}`, { method: 'DELETE' });
      toast({ kind: 'success', title: 'Autorização removida', text: item.email });
    } catch (err) {
      toast({ kind: 'error', title: 'Não foi possível remover', text: (err as Error).message });
      reload();
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (emails || []).filter(
      (e) => !q || [e.email, e.supervisor_name, e.posto].join(' ').toLowerCase().includes(q),
    );
  }, [emails, query]);

  return (
    <div className="section-scroll">
      <div className="section-pad">
        <div className="section-head">
          <div>
            <h1>E-mails autorizados</h1>
            <p>Só os e-mails desta lista conseguem enviar o formulário. Cadastre os supervisores de cada posto.</p>
          </div>
        </div>

        <form className="panel email-form" onSubmit={add} noValidate>
          <div className="full">
            <label className="label" htmlFor="em-text">
              E-mail executivo
            </label>
            <span className="help">Para cadastrar vários de uma vez, cole um por linha ou separados por vírgula.</span>
            <textarea
              id="em-text"
              className="textarea"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setError('');
              }}
              placeholder="supervisor@empresa.com.br"
              autoCapitalize="none"
              spellCheck={false}
            />
          </div>
          <div>
            <label className="label" htmlFor="em-name">
              Nome do supervisor <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(opcional)</span>
            </label>
            <input id="em-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </div>
          <div>
            <label className="label" htmlFor="em-posto">
              Posto <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(opcional)</span>
            </label>
            <div className="select-wrap">
              <select id="em-posto" className="select" value={posto} onChange={(e) => setPosto(e.target.value)}>
                <option value="">Sem posto definido</option>
                {postos.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <ChevronDown size={18} />
            </div>
          </div>
          <div className="email-form-foot">
            <small style={{ color: error ? 'var(--danger)' : undefined }}>
              {error || (count > 1 ? `${count} e-mails para cadastrar` : '\u00a0')}
            </small>
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? <span className="spinner" /> : <MailPlus size={18} />} Autorizar
            </button>
          </div>
        </form>

        <div className="email-list-head">
          <h2>{emails ? `${emails.length} autorizado${emails.length === 1 ? '' : 's'}` : 'Autorizados'}</h2>
          <div className="search">
            <Search size={17} />
            <input className="input" placeholder="Buscar" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar e-mails" />
          </div>
        </div>

        {emails === null ? (
          [0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 52, marginBottom: 10 }} />)
        ) : filtered.length === 0 ? (
          <div className="empty">
            <span className="empty-icon">
              <UserCheck size={24} />
            </span>
            <strong>{query ? 'Nada encontrado' : 'Nenhum e-mail autorizado ainda'}</strong>
            <span>{query ? 'Tente outro termo.' : 'Cadastre o primeiro supervisor no campo acima.'}</span>
          </div>
        ) : (
          <div>
            <AnimatePresence initial={false}>
              {filtered.map((e) => (
                <motion.div
                  key={e.id}
                  className="email-row"
                  layout="position"
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: 30, transition: { duration: 0.2 } }}
                >
                  <span className="me-avatar">{initials(e.supervisor_name || e.email)}</span>
                  <div style={{ minWidth: 0 }}>
                    <b>{e.email}</b>
                    <small>
                      {[e.supervisor_name, e.posto].filter(Boolean).join(', ') || 'Sem nome ou posto'}
                      {e.created_by ? `. Cadastrado por ${e.created_by} em ${formatDateTime(e.created_at)}` : ''}
                    </small>
                  </div>
                  <button
                    className={armed === e.id ? 'btn btn-danger btn-sm' : 'icon-btn'}
                    onClick={() => remove(e)}
                    aria-label={`Remover ${e.email}`}
                  >
                    <Trash2 size={16} />
                    {armed === e.id ? 'Confirmar' : null}
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
