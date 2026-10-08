'use client';
import { BarChart3, Boxes, Building2, Eye, Inbox as InboxIcon, ListChecks, Lock, MailCheck, UserRound, UsersRound } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccountSettings } from '../core/AccountSettings';
import { AppFrame, type FrameTab } from '../core/AppFrame';
import { api } from '../core/api';
import { TeamManager } from '../core/TeamManager';
import { ToastProvider, useToast } from '../core/Toasts';
import { MaxAssistant } from '../max/MaxAssistant';
import { useRealtime } from '@/lib/realtime';
import { chime } from '@/lib/chime';
import { protocolLabel } from '@/lib/format';
import { canManageSector, hasLevel } from '@/lib/permissions';
import { getSector, sectorPath } from '@/lib/sectors';
import { useSession } from '@/lib/useSession';
import type { AuthorizedEmail, Posto, RequestRow, StockItem } from '@/lib/almoxarifado/types';
import { isLow } from '@/lib/almoxarifado/stockFormat';
import type { MaxHost } from '@/lib/max/types';
import { Inbox } from './Inbox';
import { FormEditor } from './FormEditor';
import { EmailsManager } from './EmailsManager';
import { Estoque } from './Estoque';
import { Postos } from './Postos';
import { Metricas } from './Metricas';

const SLUG = 'almoxarifado';
type ModuleTab = 'solicitacoes' | 'estoque' | 'postos' | 'metricas' | 'formulario' | 'emails';
export type Tab = ModuleTab | 'equipe' | 'conta' | 'inicio';

const MODULE_TABS: (FrameTab & { id: ModuleTab; aliases: string[] })[] = [
  { id: 'solicitacoes', label: 'Solicitações', short: 'Pedidos', icon: InboxIcon, aliases: ['solicitacoes', 'pedidos', 'caixa de entrada', 'requisicoes'] },
  { id: 'estoque', label: 'Estoque', short: 'Estoque', icon: Boxes, aliases: ['estoque', 'itens', 'inventario', 'produtos'] },
  { id: 'postos', label: 'Postos', short: 'Postos', icon: Building2, aliases: ['postos'] },
  { id: 'metricas', label: 'Métricas', short: 'Métricas', icon: BarChart3, aliases: ['metricas', 'relatorios', 'graficos'] },
  { id: 'formulario', label: 'Formulário', short: 'Formulário', icon: ListChecks, aliases: ['formulario', 'editor do formulario', 'perguntas'] },
  { id: 'emails', label: 'E-mails autorizados', short: 'E-mails', icon: MailCheck, aliases: ['emails', 'e-mails', 'emails autorizados', 'supervisores'] },
];
const ALL_TABS: Tab[] = [...MODULE_TABS.map((t) => t.id), 'equipe', 'conta', 'inicio'];

export function Dashboard() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}

function Shell() {
  const toast = useToast();
  const { user, setUser, refresh, intro, endIntro, logout } = useSession(sectorPath(SLUG));
  const [tab, setTabState] = useState<Tab | null>(null);
  const [requests, setRequests] = useState<RequestRow[] | null>(null);
  const [emails, setEmails] = useState<AuthorizedEmail[] | null>(null);
  const [items, setItems] = useState<StockItem[] | null>(null);
  const [postos, setPostos] = useState<Posto[] | null>(null);
  const [stockFailed, setStockFailed] = useState(false);
  const [stockVersion, setStockVersion] = useState(0);
  const [formVersion, setFormVersion] = useState({ n: 0, by: '' });
  const [detailVersion, setDetailVersion] = useState(0);
  const [adminsVersion, setAdminsVersion] = useState(0);
  const knownIds = useRef<Set<string> | null>(null);
  const userRef = useRef(user);
  userRef.current = user;

  /* ---------- permissões desta pessoa ---------- */
  const can = useCallback((m: string, level: 'view' | 'edit' = 'view') => hasLevel(userRef.current, SLUG, m, level), []);
  const perms = useMemo(() => {
    const view = (m: string) => hasLevel(user, SLUG, m, 'view');
    const edit = (m: string) => hasLevel(user, SLUG, m, 'edit');
    return {
      view,
      edit,
      requests: view('solicitacoes'),
      emails: view('emails') || view('solicitacoes'),
      stock: view('estoque') || view('postos') || view('solicitacoes'),
      manager: canManageSector(user, SLUG),
    };
  }, [user]);
  const permsRef = useRef(perms);
  permsRef.current = perms;

  const moduleTabs = useMemo(() => MODULE_TABS.filter((t) => perms.view(t.id)), [perms]);
  const firstTab: Tab = moduleTabs[0]?.id ?? 'inicio';

  // aba inicial: a do endereço (#estoque), se a pessoa puder vê-la
  useEffect(() => {
    if (!user) return;
    setTabState((cur) => {
      const wanted = (cur ?? (window.location.hash.replace('#', '') as Tab)) || firstTab;
      const allowed =
        ALL_TABS.includes(wanted) &&
        (wanted === 'conta' || (wanted === 'equipe' ? perms.manager : wanted === 'inicio' ? moduleTabs.length === 0 : perms.view(wanted)));
      return allowed ? wanted : firstTab;
    });
  }, [user, perms, moduleTabs.length, firstTab]);

  const setTab = useCallback((t: Tab) => {
    setTabState(t);
    history.replaceState(null, '', '#' + t);
  }, []);

  /* ---------- dados ---------- */
  const loadRequests = useCallback(async () => {
    if (!permsRef.current.requests) return;
    try {
      const j = await api<{ requests: RequestRow[] }>('/api/almoxarifado/requests');
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
    if (!permsRef.current.emails) return;
    try {
      const j = await api<{ emails: AuthorizedEmail[] }>('/api/almoxarifado/emails');
      setEmails(j.emails);
    } catch {
      /* ignore */
    }
  }, []);

  const loadItems = useCallback(async () => {
    if (!permsRef.current.stock) return;
    try {
      const j = await api<{ items: StockItem[] }>('/api/almoxarifado/stock');
      setItems(j.items);
      setStockFailed(false);
    } catch {
      setStockFailed(true);
    }
  }, []);

  const loadPostos = useCallback(async () => {
    if (!permsRef.current.stock) return;
    try {
      const j = await api<{ postos: Posto[] }>('/api/almoxarifado/postos');
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

  const loadAll = useCallback(() => {
    loadRequests();
    loadEmails();
    loadItems();
    loadPostos();
  }, [loadRequests, loadEmails, loadItems, loadPostos]);

  // carrega quando a pessoa (e o que ela pode ver) é conhecida ou muda
  useEffect(() => {
    if (user) loadAll();
  }, [user, perms.requests, perms.emails, perms.stock, loadAll]);

  useRealtime(
    (ev, payload) => {
      if (ev === 'request:new') loadRequests();
      if (ev === 'request:update') {
        loadRequests();
        setDetailVersion((v) => v + 1);
        const by = String(payload.by || '');
        if (by && by !== userRef.current?.display_name && payload.status && permsRef.current.requests) {
          toast({ kind: 'info', title: `${by} atualizou uma solicitação` });
        }
      }
      if (ev === 'emails:update') loadEmails();
      if (ev === 'form:update') setFormVersion((v) => ({ n: v.n + 1, by: String(payload.by || '') }));
      if (ev === 'admins:update') {
        refresh();
        setAdminsVersion((v) => v + 1);
      }
      if (ev === 'stock:update') {
        loadItems();
        loadPostos();
        setStockVersion((v) => v + 1);
        const by = String(payload.by || '');
        if (by && by !== userRef.current?.display_name && permsRef.current.stock) toast({ kind: 'info', title: `${by} atualizou o estoque` });
      }
      if (ev === 'postos:update') {
        loadPostos();
        setStockVersion((v) => v + 1);
      }
    },
    () => {
      loadAll();
      refresh();
    },
    12000,
  );

  const lowCount = useMemo(() => (perms.view('estoque') ? (items || []).filter(isLow).length : 0), [items, perms]);
  const newCount = useMemo(() => (perms.requests ? (requests || []).filter((r) => r.status === 'nova').length : 0), [requests, perms]);
  useEffect(() => {
    document.title = newCount ? `(${newCount}) Almoxarifado · Max Hub` : 'Almoxarifado · Max Hub';
  }, [newCount]);

  const tabs = useMemo<FrameTab[]>(
    () => [
      ...(moduleTabs.length === 0 && user ? [{ id: 'inicio', label: 'Início', short: 'Início', icon: Lock }] : []),
      ...moduleTabs.map((t) => ({
        id: t.id,
        label: t.label,
        short: t.short,
        icon: t.icon,
        badge: t.id === 'solicitacoes' ? newCount : t.id === 'estoque' ? lowCount : 0,
        badgeTone: t.id === 'estoque' ? ('warn' as const) : undefined,
        badgeTitle: t.id === 'estoque' ? 'Itens com estoque baixo' : undefined,
      })),
      ...(perms.manager ? [{ id: 'equipe', label: 'Equipe', short: 'Equipe', icon: UsersRound }] : []),
      { id: 'conta', label: 'Minha conta', short: 'Conta', icon: UserRound },
    ],
    [moduleTabs, newCount, lowCount, perms.manager, user],
  );

  const emailMap = useMemo(() => {
    const m = new Map<string, AuthorizedEmail>();
    (emails || []).forEach((e) => m.set(e.email, e));
    return m;
  }, [emails]);

  /* ---------- Max ---------- */
  const dataRef = useRef({ requests, items, postos, emails });
  dataRef.current = { requests, items, postos, emails };
  const current: Tab = tab ?? firstTab;
  const host = useMemo<MaxHost>(
    () => ({
      scope: 'sector',
      sector: getSector(SLUG),
      user,
      tabs: [
        ...moduleTabs.map((t) => ({ id: t.id, label: t.label, aliases: t.aliases })),
        ...(perms.manager ? [{ id: 'equipe', label: 'Equipe', aliases: ['equipe', 'permissoes', 'time'] }] : []),
        { id: 'conta', label: 'Minha conta', aliases: ['conta', 'minha conta', 'perfil', 'senha', 'minha senha'] },
      ],
      tab: current,
      goTab: (id) => setTab(id as Tab),
      can,
      navigate: (path) => {
        window.location.href = path;
      },
      logout,
      almox: {
        requests: () => (permsRef.current.requests ? dataRef.current.requests : null),
        items: () => dataRef.current.items,
        postos: () => dataRef.current.postos,
        emailsCount: () => dataRef.current.emails?.length ?? null,
      },
    }),
    [user, moduleTabs, perms.manager, current, setTab, can, logout],
  );

  const readOnly = (m: ModuleTab) => !perms.edit(m);
  const moduleLabel = MODULE_TABS.find((t) => t.id === current)?.label;
  // Métricas é só leitura para todo mundo: não precisa do aviso
  const showReadOnly = Boolean(user) && moduleLabel !== undefined && current !== 'metricas' && readOnly(current as ModuleTab);

  return (
    <>
      <AppFrame sub="Almoxarifado" tabs={tabs} tab={current} onTab={(t) => setTab(t as Tab)} user={user} onLogout={logout} intro={intro} onIntroEnd={endIntro}>
        {!user || tab === null ? (
          <div className="rc-empty" style={{ margin: 'auto' }}>
            <span className="spinner" /> Carregando…
          </div>
        ) : (
          <div className={`module${showReadOnly ? ' is-readonly' : ''}`}>
            {showReadOnly ? (
              <div className="readonly-note" role="note">
                <Eye size={15} /> Você está só visualizando {moduleLabel}. Para alterar, peça a permissão de edição ao master do setor.
              </div>
            ) : null}
            {current === 'inicio' && (
              <div className="section-scroll">
                <div className="section-pad">
                  <div className="blank-tool">
                    <span className="empty-icon">
                      <Lock size={24} />
                    </span>
                    <strong>Você ainda não tem acesso a nenhuma parte do Almoxarifado</strong>
                    <span>Peça ao master do setor para liberar as telas que você precisa. Assim que ele salvar, elas aparecem aqui sozinhas.</span>
                  </div>
                </div>
              </div>
            )}
            {current === 'solicitacoes' && (
              <Inbox requests={requests} setRequests={setRequests} reload={loadRequests} emailMap={emailMap} detailVersion={detailVersion} me={user} />
            )}
            {current === 'estoque' && <Estoque items={items} postos={postos} reload={reloadStock} version={stockVersion} failed={stockFailed && items === null} />}
            {current === 'postos' && <Postos postos={postos} items={items} reload={reloadStock} version={stockVersion} failed={stockFailed && postos === null} />}
            {current === 'metricas' && <Metricas version={stockVersion + detailVersion} />}
            {current === 'formulario' && <FormEditor version={formVersion} me={user} />}
            {current === 'emails' && <EmailsManager emails={emails} reload={loadEmails} setEmails={setEmails} />}
            {current === 'equipe' && perms.manager && <TeamManager slug={SLUG} me={user} version={adminsVersion} />}
            {current === 'conta' && <AccountSettings user={user} setUser={setUser} onLogout={logout} />}
          </div>
        )}
      </AppFrame>
      <MaxAssistant host={host} />
    </>
  );
}
