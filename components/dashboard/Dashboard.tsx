'use client';
import { AnimatePresence, motion } from 'framer-motion';
import { Boxes, Building2, Inbox as InboxIcon, ListChecks, LogOut, MailCheck, UserRound } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Brand } from '../Brand';
import { ToastProvider, useToast } from '../Toasts';
import { useRealtime } from '@/lib/realtime';
import { chime } from '@/lib/chime';
import { initials, protocolLabel } from '@/lib/format';
import type { AdminUser, AuthorizedEmail, Posto, RequestRow, StockItem } from '@/lib/types';
import { isLow } from '@/lib/stockFormat';
import { api } from './api';
import { Inbox } from './Inbox';
import { FormEditor } from './FormEditor';
import { EmailsManager } from './EmailsManager';
import { AccountSettings } from './AccountSettings';
import { Estoque } from './Estoque';
import { Postos } from './Postos';

export type Tab = 'solicitacoes' | 'estoque' | 'postos' | 'formulario' | 'emails' | 'conta';
const TABS: { id: Tab; label: string; short: string; icon: typeof InboxIcon }[] = [
  { id: 'solicitacoes', label: 'Solicitações', short: 'Pedidos', icon: InboxIcon },
  { id: 'estoque', label: 'Estoque', short: 'Estoque', icon: Boxes },
  { id: 'postos', label: 'Postos', short: 'Postos', icon: Building2 },
  { id: 'formulario', label: 'Formulário', short: 'Formulário', icon: ListChecks },
  { id: 'emails', label: 'E-mails autorizados', short: 'E-mails', icon: MailCheck },
  { id: 'conta', label: 'Minha conta', short: 'Conta', icon: UserRound },
];
const INTRO_FLAG = 'almox:intro';

export function Dashboard() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}

function Shell() {
  const toast = useToast();
  const [user, setUser] = useState<AdminUser | null>(null);
  const [tab, setTabState] = useState<Tab>('solicitacoes');
  const [requests, setRequests] = useState<RequestRow[] | null>(null);
  const [emails, setEmails] = useState<AuthorizedEmail[] | null>(null);
  const [items, setItems] = useState<StockItem[] | null>(null);
  const [postos, setPostos] = useState<Posto[] | null>(null);
  const [stockFailed, setStockFailed] = useState(false);
  const [stockVersion, setStockVersion] = useState(0);
  const [formVersion, setFormVersion] = useState({ n: 0, by: '' });
  const [detailVersion, setDetailVersion] = useState(0);
  const [intro, setIntro] = useState(false);
  const knownIds = useRef<Set<string> | null>(null);
  const userRef = useRef<AdminUser | null>(null);
  userRef.current = user;

  useEffect(() => {
    try {
      if (sessionStorage.getItem(INTRO_FLAG) || document.documentElement.classList.contains('intro')) {
        sessionStorage.removeItem(INTRO_FLAG);
        setIntro(true);
      }
    } catch {
      /* ignore */
    }
    const fromHash = window.location.hash.replace('#', '') as Tab;
    if (TABS.some((t) => t.id === fromHash)) setTabState(fromHash);
    api<{ user: AdminUser }>('/api/auth/me')
      .then((j) => setUser(j.user))
      .catch(() => undefined);
  }, []);

  const setTab = (t: Tab) => {
    setTabState(t);
    history.replaceState(null, '', '#' + t);
  };

  const loadRequests = useCallback(async () => {
    try {
      const j = await api<{ requests: RequestRow[] }>('/api/admin/requests');
      setRequests(j.requests);
      if (knownIds.current) {
        const fresh = j.requests.filter((r) => !knownIds.current!.has(r.id));
        if (fresh.length) {
          chime();
          const r = fresh[0];
          toast({
            kind: 'info',
            title: fresh.length > 1 ? `${fresh.length} novas solicitações` : `Nova solicitação ${protocolLabel(r.protocol)}`,
            text: fresh.length > 1 ? undefined : `${r.collaborator || 'Colaborador'}${r.posto ? ' de ' + r.posto : ''}`,
          });
        }
      }
      knownIds.current = new Set(j.requests.map((r) => r.id));
    } catch {
      /* mantém a lista atual */
    }
  }, [toast]);

  const loadEmails = useCallback(async () => {
    try {
      const j = await api<{ emails: AuthorizedEmail[] }>('/api/admin/emails');
      setEmails(j.emails);
    } catch {
      /* ignore */
    }
  }, []);

  const loadItems = useCallback(async () => {
    try {
      const j = await api<{ items: StockItem[] }>('/api/admin/stock');
      setItems(j.items);
      setStockFailed(false);
    } catch {
      setStockFailed(true);
    }
  }, []);

  const loadPostos = useCallback(async () => {
    try {
      const j = await api<{ postos: Posto[] }>('/api/admin/postos');
      setPostos(j.postos);
    } catch {
      setStockFailed(true);
    }
  }, []);

  /** Recarrega estoque e postos e avisa as gavetas abertas para atualizarem também. */
  const reloadStock = useCallback(async () => {
    await Promise.all([loadItems(), loadPostos()]);
    setStockVersion((v) => v + 1);
  }, [loadItems, loadPostos]);

  const loadMe = useCallback(async () => {
    try {
      const j = await api<{ user: AdminUser }>('/api/auth/me');
      setUser(j.user);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    loadRequests();
    loadEmails();
    loadItems();
    loadPostos();
  }, [loadRequests, loadEmails, loadItems, loadPostos]);

  useRealtime(
    (ev, payload) => {
      if (ev === 'request:new') loadRequests();
      if (ev === 'request:update') {
        loadRequests();
        setDetailVersion((v) => v + 1);
        const by = String(payload.by || '');
        if (by && by !== userRef.current?.display_name && payload.status) {
          toast({ kind: 'info', title: `${by} atualizou uma solicitação` });
        }
      }
      if (ev === 'emails:update') loadEmails();
      if (ev === 'form:update') setFormVersion((v) => ({ n: v.n + 1, by: String(payload.by || '') }));
      if (ev === 'admins:update') loadMe();
      if (ev === 'stock:update') {
        loadItems();
        loadPostos();
        setStockVersion((v) => v + 1);
        const by = String(payload.by || '');
        if (by && by !== userRef.current?.display_name) toast({ kind: 'info', title: `${by} atualizou o estoque` });
      }
      if (ev === 'postos:update') {
        loadPostos();
        setStockVersion((v) => v + 1);
      }
    },
    () => {
      loadRequests();
      loadEmails();
      loadItems();
      loadPostos();
    },
    12000,
  );

  const lowCount = useMemo(() => (items || []).filter(isLow).length, [items]);
  const newCount = useMemo(() => (requests || []).filter((r) => r.status === 'nova').length, [requests]);
  useEffect(() => {
    document.title = newCount ? `(${newCount}) Painel · Almoxarifado` : 'Painel · Almoxarifado';
  }, [newCount]);

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    window.location.href = '/login';
  };

  const emailMap = useMemo(() => {
    const m = new Map<string, AuthorizedEmail>();
    (emails || []).forEach((e) => m.set(e.email, e));
    return m;
  }, [emails]);

  return (
    <div className="dash">
      <aside className="side">
        <Brand sub="Painel da equipe" />
        <nav className="nav">
          {TABS.map((t) => (
            <button key={t.id} className={`nav-item${tab === t.id ? ' is-active' : ''}`} onClick={() => setTab(t.id)}>
              {tab === t.id ? (
                <motion.span layoutId="nav-bg" className="nav-bg" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />
              ) : null}
              <t.icon size={19} />
              <span>{t.label}</span>
              {t.id === 'solicitacoes' && newCount > 0 ? <span className="nav-count">{newCount}</span> : null}
              {t.id === 'estoque' && lowCount > 0 ? <span className="nav-count warn" title="Itens com estoque baixo">{lowCount}</span> : null}
            </button>
          ))}
        </nav>
        <div className="side-foot">
          <span className="me-avatar">{initials(user?.display_name)}</span>
          <div className="me-name" style={{ flex: 1 }}>
            {user?.display_name || '…'}
            <small>
              <span className="live-dot">
                <i /> Ao vivo
              </span>
            </small>
          </div>
          <button className="icon-btn" onClick={logout} aria-label="Sair" title="Sair">
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      <header className="mobile-top">
        <Brand />
        <span className="live-dot">
          <i /> Ao vivo
        </span>
      </header>

      <main className="main">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            {tab === 'solicitacoes' && (
              <Inbox
                requests={requests}
                setRequests={setRequests}
                reload={loadRequests}
                emailMap={emailMap}
                detailVersion={detailVersion}
                me={user}
              />
            )}
            {tab === 'estoque' && (
              <Estoque items={items} postos={postos} reload={reloadStock} version={stockVersion} failed={stockFailed && items === null} />
            )}
            {tab === 'postos' && (
              <Postos postos={postos} items={items} reload={reloadStock} version={stockVersion} failed={stockFailed && postos === null} />
            )}
            {tab === 'formulario' && <FormEditor version={formVersion} me={user} />}
            {tab === 'emails' && <EmailsManager emails={emails} reload={loadEmails} setEmails={setEmails} />}
            {tab === 'conta' && <AccountSettings user={user} setUser={setUser} onLogout={logout} />}
          </motion.div>
        </AnimatePresence>
      </main>

      <nav className="tabbar">
        {TABS.map((t) => (
          <button key={t.id} className={`tab${tab === t.id ? ' is-active' : ''}`} onClick={() => setTab(t.id)}>
            {tab === t.id ? (
              <motion.span layoutId="tab-bg" className="nav-bg" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />
            ) : null}
            <t.icon size={20} />
            <span>{t.short}</span>
            {t.id === 'solicitacoes' && newCount > 0 ? <span className="nav-count">{newCount}</span> : null}
            {t.id === 'estoque' && lowCount > 0 ? <span className="nav-count warn">{lowCount}</span> : null}
          </button>
        ))}
      </nav>

      <div
        className={`intro-overlay${intro ? ' play' : ''}`}
        aria-hidden
        onAnimationEnd={() => {
          document.documentElement.classList.remove('intro');
          setIntro(false);
        }}
      />
    </div>
  );
}
