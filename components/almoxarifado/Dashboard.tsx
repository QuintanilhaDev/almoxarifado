'use client';
import { BarChart3, Boxes, Building2, ClipboardList, Eye, Inbox as InboxIcon, ListChecks, Lock, MailCheck, Receipt, ShoppingCart, UserRound, UsersRound } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccountSettings } from '../core/AccountSettings';
import { AppFrame, type FrameTab } from '../core/AppFrame';
import { api } from '../core/api';
import { TeamManager } from '../core/TeamManager';
import { ToastProvider, useToast } from '../core/Toasts';
import { useWarp } from '../core/Warp';
import { MaxAssistant } from '../max/MaxAssistant';
import { useRealtime } from '@/lib/realtime';
import { useMaxBus } from '@/lib/max/bus';
import { chime } from '@/lib/chime';
import { protocolLabel } from '@/lib/format';
import { canManageSector, hasLevel } from '@/lib/permissions';
import { getSector, sectorPath } from '@/lib/sectors';
import { useSession } from '@/lib/useSession';
import type { AuthorizedEmail, Posto, RequestRow, StockItem } from '@/lib/almoxarifado/types';
import { isLow } from '@/lib/almoxarifado/stockFormat';
import type { MaxHost } from '@/lib/max/types';
import { Inbox } from './Inbox';
import { Estoque } from './Estoque';
import { usePurchases } from '../compras/usePurchases';
import { STATUS_SPOKEN, purchaseLabel } from '@/lib/compras/types';
import { usePedidos } from '../pedidos/usePedidos';
import { maxEmit } from '@/lib/max/bus';
import { ORIGIN_LABEL, orderLabel, type MaterialOrder } from '@/lib/pedidos/types';
import type { PickItem } from '../pedidos/ui';
import type { PurchaseOrder } from '@/lib/compras/pc';
import dynamic from 'next/dynamic';
import { PanelSkeleton, usePreload } from '../core/lazy';

// abas que não são a primeira tela: o código chega quando a pessoa abre (ou com a página parada)
const loadForm = () => import('./FormEditor');
const loadEmails = () => import('./EmailsManager');
const loadPostos = () => import('./Postos');
const loadMetricas = () => import('./Metricas');
const loadPurchases = () => import('./ComprasAlmox');
const loadOrders = () => import('../pedidos/OrdersPanel');
const loadNotas = () => import('../notas/NotasPanel');
const FormEditor = dynamic(() => loadForm().then((m) => m.FormEditor), { loading: PanelSkeleton });
const EmailsManager = dynamic(() => loadEmails().then((m) => m.EmailsManager), { loading: PanelSkeleton });
const Postos = dynamic(() => loadPostos().then((m) => m.Postos), { loading: PanelSkeleton });
const Metricas = dynamic(() => loadMetricas().then((m) => m.Metricas), { loading: PanelSkeleton });
const ComprasAlmox = dynamic(() => loadPurchases().then((m) => m.ComprasAlmox), { loading: PanelSkeleton });
const OrdersPanel = dynamic(() => loadOrders().then((m) => m.OrdersPanel), { loading: PanelSkeleton });
const NotasPanel = dynamic(() => loadNotas().then((m) => m.NotasPanel), { loading: PanelSkeleton });
const PRELOAD = [loadOrders, loadMetricas, loadNotas, loadPostos, loadPurchases, loadForm, loadEmails];

const SLUG = 'almoxarifado';
type ModuleTab = 'solicitacoes' | 'pedidos' | 'estoque' | 'notas' | 'postos' | 'metricas' | 'formulario' | 'emails' | 'compras';
export type Tab = ModuleTab | 'equipe' | 'conta' | 'inicio';

const MODULE_TABS: (FrameTab & { id: ModuleTab; aliases: string[] })[] = [
  { id: 'solicitacoes', label: 'Solicitações', short: 'Solicit.', icon: InboxIcon, aliases: ['solicitacoes', 'pedidos', 'caixa de entrada', 'requisicoes'] },
  { id: 'pedidos', label: 'Pedidos de material', short: 'Pedidos', icon: ClipboardList, aliases: ['pedidos de material', 'pedidos da operacao', 'pedidos do rh', 'admissoes', 'trocas', 'entregas', 'reservas'] },
  { id: 'estoque', label: 'Estoque', short: 'Estoque', icon: Boxes, aliases: ['estoque', 'itens', 'inventario', 'produtos'] },
  { id: 'notas', label: 'Entradas (NF)', short: 'Entradas', icon: Receipt, aliases: ['entradas', 'notas fiscais', 'nota fiscal', 'notas', 'nf', 'xml', 'recebimento'] },
  { id: 'postos', label: 'Postos', short: 'Postos', icon: Building2, aliases: ['postos'] },
  { id: 'metricas', label: 'Métricas', short: 'Métricas', icon: BarChart3, aliases: ['metricas', 'relatorios', 'graficos'] },
  { id: 'formulario', label: 'Formulário', short: 'Formulário', icon: ListChecks, aliases: ['formulario', 'editor do formulario', 'perguntas'] },
  { id: 'emails', label: 'E-mails autorizados', short: 'E-mails', icon: MailCheck, aliases: ['emails', 'e-mails', 'emails autorizados', 'supervisores'] },
  { id: 'compras', label: 'Compras', short: 'Compras', icon: ShoppingCart, aliases: ['compras', 'pedidos de compra', 'solicitacoes de compra', 'aba compras'] },
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
  usePreload(PRELOAD);
  const { user, setUser, refresh, intro, endIntro, logout } = useSession(sectorPath(SLUG));
  const warp = useWarp();
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
  const [purchaseOpen, setPurchaseOpen] = useState<string | null>(null);
  const [poOpen, setPoOpen] = useState<string | null>(null);
  const [receivePO, setReceivePO] = useState<PurchaseOrder | null>(null);
  const [noteFocus, setNoteFocus] = useState<string | null>(null);
  const [purchasePrefill, setPurchasePrefill] = useState<string | null>(null);
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
  const setTabRef = useRef(setTab);
  setTabRef.current = setTab;

  /* ---------- compras (pedidos ao setor de Compras) ---------- */
  const purchases = usePurchases({
    onChange: (changes) => {
      // avisa quando Compras mexe em um pedido (quem mexeu aqui mesmo já viu)
      const others = changes.filter((c) => {
        const last = c.req.history[c.req.history.length - 1];
        return last && last.by !== userRef.current?.display_name && c.req.status !== 'cancelada';
      });
      if (!others.length) return;
      const c = others[0];
      const last = c.req.history[c.req.history.length - 1];
      toast(
        {
          kind: 'info',
          title: others.length > 1 ? `${others.length} solicitações de compra atualizadas` : `Compras ${c.from !== c.req.status ? `marcou ${purchaseLabel(c.req.number)} como ${STATUS_SPOKEN[c.req.status]}` : `respondeu ${purchaseLabel(c.req.number)}`}`,
          text: others.length > 1 ? undefined : last.note ? `“${last.note}” — ${last.by}` : last.by,
          action: { label: 'Ver', onClick: () => { setTabRef.current('compras'); setPurchaseOpen(c.req.id); } },
        },
        9000,
      );
    },
  });
  useMaxBus('compras:open', (p) => {
    setTabRef.current('compras');
    setPurchaseOpen(p.id);
  });
  const reloadPurchases = purchases.reload; // estável (useCallback sem dependências)
  const loadPurchases = useCallback(() => {
    if (permsRef.current.view('compras')) void reloadPurchases();
  }, [reloadPurchases]);

  /* ---------- pedidos de material (Operação e RH/DP) ---------- */
  const [orderOpen, setOrderOpen] = useState<string | null>(null);
  const announceOrders = useCallback(
    (list: MaterialOrder[]) => {
      if (!list.length || !permsRef.current.view('pedidos')) return;
      chime();
      const o = list[0];
      toast(
        {
          kind: 'info',
          title: list.length > 1 ? `${list.length} pedidos de material chegaram` : `Pedido ${orderLabel(o.number)} · ${ORIGIN_LABEL[o.origin]}${o.priority === 'urgente' ? ' · URGENTE' : ''}`,
          text: list.length > 1 ? undefined : `${o.collaborator_name ?? o.posto_name ?? o.requester} · ${o.items.length} ${o.items.length === 1 ? 'item' : 'itens'}`,
          action: { label: 'Ver', onClick: () => { setTabRef.current('pedidos'); setOrderOpen(o.id); } },
        },
        15000,
      );
      const who = o.collaborator_name ? ` de ${o.collaborator_name}` : o.posto_name ? ` do ${o.posto_name}` : '';
      maxEmit('max:announce', {
        text:
          list.length > 1
            ? `Almoxarifado, chegaram ${list.length} pedidos de material.`
            : `Almoxarifado, ${o.origin === 'rh_admissao' ? `o RH pediu o kit de admissão${who}` : o.origin === 'rh_troca' ? `a troca de fardamento${who} foi validada` : o.origin === 'rh_extra' ? `o RH pediu uma troca extraordinária${who}` : `a Operação encaminhou um pedido${who}`}${o.priority === 'urgente' ? '. É urgente' : ''}.`,
        tone: 'alert',
      });
    },
    [toast],
  );
  const pedidos = usePedidos('almox', {
    onNew: (fresh) => announceOrders(fresh.filter((o) => o.stage === 'encaminhado')),
    onChange: (changed) => announceOrders(changed.filter((c) => c.order.stage === 'encaminhado' && c.from.stage !== 'encaminhado').map((c) => c.order)),
  });
  const reloadPedidos = pedidos.reload;
  const loadPedidos = useCallback(() => {
    if (permsRef.current.view('pedidos')) void reloadPedidos();
  }, [reloadPedidos]);
  const pedidosDataRef = useRef(pedidos.data);
  pedidosDataRef.current = pedidos.data;
  useMaxBus('pedidos:open', (p) => {
    setTabRef.current('pedidos');
    const id = p.id ?? (p.number ? pedidosDataRef.current?.orders.find((o) => o.number === p.number)?.id : undefined);
    if (id) setOrderOpen(id);
  });

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
    loadPurchases();
    loadPedidos();
  }, [loadRequests, loadEmails, loadItems, loadPostos, loadPurchases, loadPedidos]);

  // carrega quando a pessoa (e o que ela pode ver) é conhecida ou muda
  useEffect(() => {
    if (user) loadAll();
  }, [user, perms.requests, perms.emails, perms.stock, perms, loadAll]);

  // O canal ao vivo é público: o aviso só serve para recarregar. Nada do que vem nele
  // (nome de quem fez, status…) é mostrado na tela; "by" só é comparado com o próprio nome.
  useRealtime(
    (ev, payload) => {
      const mine = Boolean(userRef.current?.display_name) && payload.by === userRef.current?.display_name;
      if (ev === 'request:new') loadRequests();
      if (ev === 'request:update') {
        loadRequests();
        setDetailVersion((v) => v + 1);
        if (payload.by && !mine && payload.status && permsRef.current.requests) toast({ kind: 'info', title: 'Uma solicitação foi atualizada' });
      }
      if (ev === 'emails:update') loadEmails();
      if (ev === 'form:update') setFormVersion((v) => ({ n: v.n + 1, by: mine ? userRef.current!.display_name : '' }));
      if (ev === 'admins:update') {
        refresh();
        setAdminsVersion((v) => v + 1);
      }
      if (ev === 'stock:update') {
        loadPedidos();
        loadItems();
        loadPostos();
        setStockVersion((v) => v + 1);
        if (payload.by && !mine && permsRef.current.stock) toast({ kind: 'info', title: 'O estoque foi atualizado' });
      }
      if (ev === 'purchase:new' || ev === 'purchase:update') {
        loadPurchases();
        loadPedidos();
      }
      if (ev === 'order:new' || ev === 'order:update') loadPedidos();
      if (ev === 'note:update') window.dispatchEvent(new Event('maxhub:notes'));
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
  const toSeparate = useMemo(() => (perms.view('pedidos') ? (pedidos.data?.orders ?? []).filter((o) => o.stage === 'encaminhado' && o.items.some((l) => l.reserved + l.delivered < l.qty && !l.purchase_id)).length : 0), [pedidos.data, perms]);
  const pickItems = useMemo<PickItem[] | null>(() => (items ? items.filter((i) => i.active !== false).map((i) => ({ id: i.id, code: i.code, name: i.name, size: i.size, unit: i.unit, available: Math.max(0, i.quantity - i.reserved) })) : null), [items]);
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
        badge: t.id === 'solicitacoes' ? newCount : t.id === 'estoque' ? lowCount : t.id === 'pedidos' ? toSeparate : 0,
        badgeTone: t.id === 'estoque' ? ('warn' as const) : undefined,
        badgeTitle: t.id === 'estoque' ? 'Itens com estoque baixo' : t.id === 'pedidos' ? 'Pedidos para separar' : undefined,
      })),
      ...(perms.manager ? [{ id: 'equipe', label: 'Equipe', short: 'Equipe', icon: UsersRound }] : []),
      { id: 'conta', label: 'Minha conta', short: 'Conta', icon: UserRound },
    ],
    [moduleTabs, newCount, lowCount, toSeparate, perms.manager, user],
  );

  const emailMap = useMemo(() => {
    const m = new Map<string, AuthorizedEmail>();
    (emails || []).forEach((e) => m.set(e.email, e));
    return m;
  }, [emails]);

  /* ---------- Max ---------- */
  const dataRef = useRef({ requests, items, postos, emails });
  const ordersRef = useRef(pedidos.data?.orders ?? null);
  ordersRef.current = pedidos.data?.orders ?? null;
  const purchasesRef = useRef(purchases.requests);
  purchasesRef.current = purchases.requests;
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
      navigate: (path, opts) => warp.go(path, opts),
      logout,
      almox: {
        requests: () => (permsRef.current.requests ? dataRef.current.requests : null),
        items: () => dataRef.current.items,
        postos: () => dataRef.current.postos,
        emailsCount: () => dataRef.current.emails?.length ?? null,
      },
      compras: { requests: () => (permsRef.current.view('compras') ? purchasesRef.current : null) },
      pedidos: { scope: 'almox', orders: () => (permsRef.current.view('pedidos') ? ordersRef.current : null) },
    }),
    [user, moduleTabs, perms.manager, current, setTab, can, logout, warp],
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
                    <span>Peça ao master do setor para liberar o acesso.</span>
                  </div>
                </div>
              </div>
            )}
            {current === 'solicitacoes' && (
              <Inbox requests={requests} setRequests={setRequests} reload={loadRequests} emailMap={emailMap} detailVersion={detailVersion} me={user} />
            )}
            {current === 'estoque' && (
              <Estoque
                items={items}
                postos={postos}
                reload={reloadStock}
                version={stockVersion}
                failed={stockFailed && items === null}
                onPurchase={perms.edit('compras') ? (id) => { setPurchasePrefill(id); setTab('compras'); } : undefined}
                canInventory={perms.manager}
              />
            )}
            {current === 'compras' && (
              <ComprasAlmox
                requests={purchases.requests}
                failed={purchases.failed}
                canEdit={perms.edit('compras')}
                canNotes={perms.edit('notas')}
                reload={purchases.reload}
                items={items}
                prefill={purchasePrefill}
                onPrefillUsed={() => setPurchasePrefill(null)}
                openId={purchaseOpen}
                setOpenId={setPurchaseOpen}
                toRelease={(pedidos.data?.orders ?? []).filter((o) => o.stage === 'encaminhado').length}
                onReceive={(o) => {
                  setReceivePO(o);
                  setTab('notas');
                }}
                onRelease={() => setTab('pedidos')}
                onNote={(id) => {
                  setNoteFocus(id);
                  setTab('notas');
                }}
                poOpen={poOpen}
                setPoOpen={setPoOpen}
                onBuy={(id) => setPurchasePrefill(id)}
              />
            )}
            {current === 'pedidos' && (
              <OrdersPanel scope="almox" user={user} data={pedidos.data} failed={pedidos.failed} setup={pedidos.setup} reload={pedidos.reload} canEdit={perms.edit('pedidos')} openId={orderOpen} setOpenId={setOrderOpen} stockItems={pickItems} />
            )}
            {current === 'notas' && (
              <NotasPanel
                mode="almox"
                canEdit={perms.edit('notas')}
                items={pickItems}
                onOrders={(id) => {
                  setTab('pedidos');
                  if (id) setOrderOpen(id);
                }}
                canTreat={Boolean(user.is_master) || hasLevel(user, 'compras', 'solicitacoes', 'edit') || hasLevel(user, 'compras', 'aprovacao', 'edit')}
                canAuthorize={Boolean(user.is_master) || hasLevel(user, 'compras', 'aprovacao', 'edit')}
                receive={receivePO}
                onReceiveUsed={() => setReceivePO(null)}
                onOrder={(id) => {
                  setPoOpen(id);
                  setTab('compras');
                }}
                focus={noteFocus}
                onFocusUsed={() => setNoteFocus(null)}
              />
            )}
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
