'use client';
import { BellRing, Building2, Gauge, Inbox as InboxIcon, Lock, Scale, ShoppingBag, UserRound, UsersRound } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AccountSettings } from '../core/AccountSettings';
import { AppFrame, type FrameTab } from '../core/AppFrame';
import { TeamManager } from '../core/TeamManager';
import { ToastProvider, useToast } from '../core/Toasts';
import { useWarp } from '../core/Warp';
import { MaxAssistant } from '../max/MaxAssistant';
import { chime } from '@/lib/chime';
import { maxEmit, useMaxBus } from '@/lib/max/bus';
import { canManageSector, hasLevel } from '@/lib/permissions';
import { useRealtime } from '@/lib/realtime';
import { getSector, sectorPath } from '@/lib/sectors';
import { useHashTab, useSession } from '@/lib/useSession';
import { itemsSummary, purchaseLabel, type PurchaseRequest } from '@/lib/compras/types';
import type { MaxHost } from '@/lib/max/types';
import { PurchaseBoard } from './PurchaseBoard';
import dynamic from 'next/dynamic';
import { PanelSkeleton, usePreload } from '../core/lazy';
import type { Supplier } from '@/lib/compras/fornecedores';
import { usePurchases } from './usePurchases';
import { usePC } from './pcui';
import type { DirectDraft } from './PedidosCompra';
import { brl, poLabel } from '@/lib/compras/pc';

const loadSuppliers = () => import('./Fornecedores');
const Fornecedores = dynamic(() => loadSuppliers().then((m) => m.Fornecedores), { loading: PanelSkeleton });
const loadQuotes = () => import('./Cotacoes');
const Cotacoes = dynamic(() => loadQuotes().then((m) => m.Cotacoes), { loading: PanelSkeleton });
const NewQuoteSheet = dynamic(() => loadQuotes().then((m) => m.NewQuoteSheet));
const loadOrders = () => import('./PedidosCompra');
const PedidosCompra = dynamic(() => loadOrders().then((m) => m.PedidosCompra), { loading: PanelSkeleton });
const loadPainel = () => import('./PainelCompras');
const PainelCompras = dynamic(() => loadPainel().then((m) => m.PainelCompras), { loading: PanelSkeleton });

const SLUG = 'compras';
type Tab = 'painel' | 'solicitacoes' | 'cotacoes' | 'pedidos-compra' | 'fornecedores' | 'equipe' | 'conta' | 'inicio';
const VALID: Tab[] = ['painel', 'solicitacoes', 'cotacoes', 'pedidos-compra', 'fornecedores', 'equipe', 'conta', 'inicio'];
/** sem o Realtime (rede bloqueada), a lista ainda se atualiza sozinha neste intervalo */
const POLL_MS = 8000;

/** O que a Max fala quando chega pedido novo. */
export function announcement(fresh: PurchaseRequest[]): string {
  if (fresh.length > 1) {
    const urgent = fresh.filter((r) => r.priority === 'urgente').length;
    return `Equipe de Compras, chegaram ${fresh.length} novas solicitações de compra do Almoxarifado${urgent ? `, ${urgent === 1 ? 'uma delas urgente' : `${urgent} urgentes`}` : ''}.`;
  }
  const r = fresh[0];
  const n = r.items.length;
  return `Equipe de Compras, ${r.requested_by} do Almoxarifado enviou uma nova solicitação de compra, número ${r.number}, com ${n === 1 ? 'um item' : `${n} itens`}${r.priority === 'urgente' ? '. É urgente' : ''}.`;
}

/** Ferramenta do setor Compras: recebe e atende as solicitações de compra do Almoxarifado. */
export function ComprasApp() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}

function Shell() {
  usePreload([loadSuppliers, loadQuotes, loadOrders, loadPainel]);
  const sector = getSector(SLUG)!;
  const toast = useToast();
  const { user, setUser, refresh, intro, endIntro, logout } = useSession(sectorPath(SLUG));
  const [tab, setTab] = useHashTab<Tab>(VALID, 'painel');
  const warp = useWarp();
  const [teamVersion, setTeamVersion] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const manager = canManageSector(user, SLUG);
  const canView = hasLevel(user, SLUG, 'solicitacoes', 'view');
  const canEdit = hasLevel(user, SLUG, 'solicitacoes', 'edit');
  const canSup = hasLevel(user, SLUG, 'fornecedores', 'view');
  const canSupEdit = hasLevel(user, SLUG, 'fornecedores', 'edit');
  const canApprove = Boolean(user?.is_master) || hasLevel(user, SLUG, 'aprovacao', 'edit');
  const seesPC = canView || canApprove;
  const pc = usePC(Boolean(user) && seesPC);
  const [quoteId, setQuoteId] = useState<string | null>(null);
  const [poId, setPoId] = useState<string | null>(null);
  const [direct, setDirect] = useState<DirectDraft | null>(null);
  const [newQuote, setNewQuote] = useState<string[] | null>(null);
  const suppliersRef = useRef<Supplier[] | null>(null);
  const canViewRef = useRef(canView);
  canViewRef.current = canView;
  const setTabRef = useRef(setTab);
  setTabRef.current = setTab;

  const purchases = usePurchases({
    onNew: (all) => {
      // criado e cancelado entre duas consultas: não há o que anunciar
      const fresh = all.filter((r) => r.status !== 'cancelada');
      if (!canViewRef.current || !fresh.length) return;
      chime();
      const r = fresh[0];
      toast(
        {
          kind: 'info',
          title: fresh.length > 1 ? `${fresh.length} novas solicitações de compra` : `Nova solicitação de compra ${purchaseLabel(r.number)}${r.priority === 'urgente' ? ' · URGENTE' : ''}`,
          text: fresh.length > 1 ? 'do Almoxarifado' : `${r.requested_by} (Almoxarifado): ${itemsSummary(r.items)}`,
          action: {
            label: 'Ver',
            onClick: () => {
              setTabRef.current('solicitacoes');
              setOpenId(r.id);
            },
          },
        },
        15000,
      );
      // a Max avisa em voz alta e pisca em amarelo enquanto fala
      maxEmit('max:announce', { text: announcement(fresh), tone: 'alert' });
    },
    onChange: (changes) => {
      // o Almoxarifado cancelou um pedido
      const cancelled = changes.filter((c) => c.req.status === 'cancelada' && c.from !== 'cancelada');
      if (cancelled.length) {
        const c = cancelled[0].req;
        toast({ kind: 'info', title: `O Almoxarifado cancelou a solicitação ${purchaseLabel(c.number)}`, text: c.history[c.history.length - 1]?.by });
      }
    },
  });
  const reload = purchases.reload;

  useEffect(() => {
    if (user && canView) void reload();
  }, [user, canView, reload]);

  useRealtime(
    (ev) => {
      if (ev === 'purchase:new' || ev === 'purchase:update') {
        if (canViewRef.current) void reload();
      }
      if (ev === 'admins:update') {
        refresh();
        setTeamVersion((v) => v + 1);
      }
    },
    () => {
      refresh();
      if (canViewRef.current) void reload();
    },
    POLL_MS,
  );

  // o navegador só deixa tocar som e falar depois do primeiro clique/toque na página
  const [needsTap, setNeedsTap] = useState(false);
  useEffect(() => {
    const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
    if (!ua || ua.hasBeenActive) return;
    setNeedsTap(true);
    const t = setInterval(() => {
      if (ua.hasBeenActive) {
        setNeedsTap(false);
        clearInterval(t);
      }
    }, 400);
    return () => clearInterval(t);
  }, []);

  const newCount = useMemo(() => (purchases.requests ?? []).filter((r) => r.status === 'nova').length, [purchases.requests]);
  const toApprove = useMemo(() => (canApprove ? (pc.orders ?? []).filter((o) => o.status === 'aguardando_aprovacao').length : 0), [pc.orders, canApprove]);
  const openQuotes = useMemo(() => (pc.quotes ?? []).filter((q) => q.status === 'aberta').length, [pc.quotes]);
  // chegou pedido para aprovar: avisa quem aprova (com a voz da Max)
  const seenAwait = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!canApprove || !pc.orders) return;
    const now = pc.orders.filter((o) => o.status === 'aguardando_aprovacao' && o.created_by !== user?.display_name);
    if (seenAwait.current) {
      const fresh = now.filter((o) => !seenAwait.current!.has(o.id));
      if (fresh.length) {
        const o = fresh[0];
        chime();
        toast({ kind: 'info', title: fresh.length > 1 ? `${fresh.length} pedidos de compra para aprovar` : `Pedido de compra ${poLabel(o.number)} para aprovar`, text: `${o.supplier_name} · ${brl(o.total)}`, action: { label: 'Ver', onClick: () => go.order(o.id) } }, 15000);
        maxEmit('max:announce', { text: fresh.length > 1 ? `Chegaram ${fresh.length} pedidos de compra para aprovar.` : `O pedido de compra ${o.number}, da ${o.supplier_name}, está esperando a sua aprovação.`, tone: 'alert' });
      }
    }
    seenAwait.current = new Set(now.map((o) => o.id));
  }, [pc.orders, canApprove, user?.display_name]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    document.title = newCount ? `(${newCount}) Compras · Max Hub` : 'Compras · Max Hub';
  }, [newCount]);

  const tabs = useMemo<FrameTab[]>(
    () => [
      ...(seesPC ? [{ id: 'painel', label: 'Painel', short: 'Painel', icon: Gauge, badge: toApprove, badgeTitle: 'Pedidos para aprovar' }] : []),
      ...(canView
        ? [
            { id: 'solicitacoes', label: 'Solicitações', short: 'Pedidos', icon: InboxIcon, badge: newCount, badgeTitle: 'Solicitações novas' },
            { id: 'cotacoes', label: 'Cotações', short: 'Cotações', icon: Scale, badge: openQuotes, badgeTitle: 'Cotações abertas' },
          ]
        : user && !canSup && !canApprove
          ? [{ id: 'inicio', label: 'Início', short: 'Início', icon: Lock }]
          : []),
      ...(seesPC ? [{ id: 'pedidos-compra', label: 'Pedidos de compra', short: 'Compras', icon: ShoppingBag }] : []),
      ...(canSup ? [{ id: 'fornecedores', label: 'Fornecedores', short: 'Fornec.', icon: Building2 }] : []),
      ...(manager ? [{ id: 'equipe', label: 'Equipe', short: 'Equipe', icon: UsersRound }] : []),
      { id: 'conta', label: 'Minha conta', short: 'Conta', icon: UserRound },
    ],
    [canView, canSup, manager, newCount, user, seesPC, toApprove, openQuotes, canApprove],
  );
  const home: Tab = seesPC ? 'painel' : canSup ? 'fornecedores' : 'inicio';
  const current: Tab = !user
    ? tab
    : (tab === 'equipe' && !manager) ||
        ((tab === 'solicitacoes' || tab === 'cotacoes') && !canView) ||
        ((tab === 'painel' || tab === 'pedidos-compra') && !seesPC) ||
        (tab === 'fornecedores' && !canSup) ||
        (tab === 'inicio' && home !== 'inicio')
      ? home
      : tab;
  const go = {
    quote: (id: string) => {
      setTab('cotacoes');
      setQuoteId(id);
    },
    order: (id: string) => {
      setTab('pedidos-compra');
      setPoId(id);
    },
    request: (id: string) => {
      setTab('solicitacoes');
      setOpenId(id);
    },
    newQuote: (ids: string[]) => setNewQuote(ids),
    direct: (d: DirectDraft) => {
      setTab('pedidos-compra');
      setDirect(d);
    },
  };
  const reloadAll = () => {
    void reload();
    void pc.reload();
  };

  const requestsRef = useRef(purchases.requests);
  requestsRef.current = purchases.requests;
  const host = useMemo<MaxHost>(
    () => ({
      scope: 'sector',
      sector,
      user,
      tabs: [
        ...(seesPC ? [{ id: 'painel', label: 'Painel', aliases: ['painel', 'inicio', 'resumo', 'painel de compras', 'o que tenho para fazer', 'pendencias'] }] : []),
        ...(canView ? [{ id: 'solicitacoes', label: 'Solicitações', aliases: ['solicitacoes', 'solicitacoes de compra', 'fila', 'requisicoes', 'requisicoes de compra'] }] : []),
        ...(canView ? [{ id: 'cotacoes', label: 'Cotações', aliases: ['cotacoes', 'cotacao', 'mapa', 'mapa comparativo', 'propostas', 'orcamentos'] }] : []),
        ...(seesPC ? [{ id: 'pedidos-compra', label: 'Pedidos de compra', aliases: ['pedidos de compra', 'pedidos', 'ordens de compra', 'oc', 'pc', 'aprovacoes', 'aprovar pedidos'] }] : []),
        ...(canSup ? [{ id: 'fornecedores', label: 'Fornecedores', aliases: ['fornecedores', 'fornecedor', 'cadastro de fornecedores', 'lista de fornecedores'] }] : []),
        ...(manager ? [{ id: 'equipe', label: 'Equipe', aliases: ['equipe', 'permissoes', 'time', 'pessoas'] }] : []),
        { id: 'conta', label: 'Minha conta', aliases: ['conta', 'minha conta', 'perfil', 'senha', 'minha senha'] },
      ],
      tab: current,
      goTab: (id) => setTab(id as Tab),
      can: (m, level = 'view') => hasLevel(user, SLUG, m, level),
      navigate: (path, opts) => warp.go(path, opts),
      logout,
      compras: { requests: () => (canViewRef.current ? requestsRef.current : null) },
      fornecedores: canSup ? { list: () => suppliersRef.current, canEdit: canSupEdit } : undefined,
    }),
    [sector, user, canView, canSup, canSupEdit, manager, current, setTab, logout, warp, seesPC],
  );

  // a Max pede para abrir uma solicitação ("abrir a solicitação de compra 3")
  useMaxBus('compras:open', (p) => {
    setTabRef.current('solicitacoes');
    setOpenId(p.id);
  });

  return (
    <>
      <AppFrame sub={sector.name} tabs={tabs} tab={current} onTab={(t) => setTab(t as Tab)} user={user} onLogout={logout} intro={intro} onIntroEnd={endIntro}>
        {!user ? (
          <div className="rc-empty" style={{ margin: 'auto' }}>
            <span className="spinner" /> Carregando…
          </div>
        ) : (
          <div className={`module${(canView && !canEdit && current === 'solicitacoes') || (canSup && !canSupEdit && current === 'fornecedores') ? ' is-readonly' : ''}`}>
            {canView && !canEdit && current === 'solicitacoes' ? (
              <div className="readonly-note" role="note">
                Você está só visualizando as solicitações. Para mudar o andamento, peça a permissão de edição ao master do setor.
              </div>
            ) : null}
            {current === 'inicio' && (
              <div className="section-scroll">
                <div className="section-pad">
                  <div className="blank-tool">
                    <span className="empty-icon">
                      <Lock size={24} />
                    </span>
                    <strong>Você ainda não tem acesso às solicitações de compra</strong>
                    <span>Peça ao master do setor Compras para liberar o acesso.</span>
                  </div>
                </div>
              </div>
            )}
            {needsTap && canView ? (
              <div className="sound-note" role="note">
                <BellRing size={15} /> Clique em qualquer lugar da tela para ligar os avisos com som e a voz da Max.
              </div>
            ) : null}
            {pc.setup && seesPC && (current === 'painel' || current === 'cotacoes' || current === 'pedidos-compra') ? (
              <div className="section-pad wide">
                <div className="banner">{pc.failed}</div>
              </div>
            ) : null}
            {current === 'painel' && seesPC && !pc.setup && <PainelCompras canEdit={canEdit} canApprove={canApprove} config={pc.config} reloadAll={reloadAll} go={go} />}
            {current === 'solicitacoes' && canView && (
              <PurchaseBoard
                mode="compras"
                requests={purchases.requests}
                failed={purchases.failed}
                canEdit={canEdit}
                reload={reload}
                openId={openId}
                setOpenId={setOpenId}
                onQuote={(id) => setNewQuote([id])}
                onDirect={(d) => go.direct(d)}
              />
            )}
            {current === 'cotacoes' && canView && !pc.setup && (
              <Cotacoes
                quotes={pc.quotes}
                requests={purchases.requests}
                config={pc.config?.config ?? null}
                canEdit={canEdit}
                reload={reloadAll}
                openId={quoteId}
                setOpenId={setQuoteId}
                onOrders={(os) => {
                  setQuoteId(null);
                  if (os[0]) go.order(os[0].id);
                }}
              />
            )}
            {current === 'pedidos-compra' && seesPC && !pc.setup && (
              <PedidosCompra
                mode="compras"
                orders={pc.orders}
                config={pc.config?.config ?? null}
                canEdit={canEdit}
                canApprove={canApprove}
                me={user.display_name}
                reload={reloadAll}
                openId={poId}
                setOpenId={setPoId}
                direct={direct}
                setDirect={setDirect}
              />
            )}
            {newQuote ? (
              <NewQuoteSheet
                requests={purchases.requests ?? []}
                preselect={newQuote}
                onClose={() => setNewQuote(null)}
                onDone={(q) => {
                  setNewQuote(null);
                  reloadAll();
                  go.quote(q.id);
                }}
              />
            ) : null}
            {current === 'fornecedores' && canSup && (
              <Fornecedores
                canEdit={canSupEdit}
                onList={(l) => {
                  suppliersRef.current = l;
                }}
              />
            )}
            {current === 'equipe' && manager && <TeamManager slug={SLUG} me={user} version={teamVersion} />}
            {current === 'conta' && <AccountSettings user={user} setUser={setUser} onLogout={logout} />}
          </div>
        )}
      </AppFrame>
      <MaxAssistant host={host} />
    </>
  );
}
