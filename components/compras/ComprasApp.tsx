'use client';
import { BellRing, Building2, Inbox as InboxIcon, Lock, UserRound, UsersRound } from 'lucide-react';
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
import { Fornecedores } from './Fornecedores';
import type { Supplier } from '@/lib/compras/fornecedores';
import { usePurchases } from './usePurchases';

const SLUG = 'compras';
type Tab = 'solicitacoes' | 'fornecedores' | 'equipe' | 'conta' | 'inicio';
const VALID: Tab[] = ['solicitacoes', 'fornecedores', 'equipe', 'conta', 'inicio'];
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
  const sector = getSector(SLUG)!;
  const toast = useToast();
  const { user, setUser, refresh, intro, endIntro, logout } = useSession(sectorPath(SLUG));
  const [tab, setTab] = useHashTab<Tab>(VALID, 'solicitacoes');
  const warp = useWarp();
  const [teamVersion, setTeamVersion] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const manager = canManageSector(user, SLUG);
  const canView = hasLevel(user, SLUG, 'solicitacoes', 'view');
  const canEdit = hasLevel(user, SLUG, 'solicitacoes', 'edit');
  const canSup = hasLevel(user, SLUG, 'fornecedores', 'view');
  const canSupEdit = hasLevel(user, SLUG, 'fornecedores', 'edit');
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
  useEffect(() => {
    document.title = newCount ? `(${newCount}) Compras · Max Hub` : 'Compras · Max Hub';
  }, [newCount]);

  const tabs = useMemo<FrameTab[]>(
    () => [
      ...(canView
        ? [{ id: 'solicitacoes', label: 'Solicitações', short: 'Pedidos', icon: InboxIcon, badge: newCount, badgeTitle: 'Solicitações novas' }]
        : user && !canSup
          ? [{ id: 'inicio', label: 'Início', short: 'Início', icon: Lock }]
          : []),
      ...(canSup ? [{ id: 'fornecedores', label: 'Fornecedores', short: 'Fornec.', icon: Building2 }] : []),
      ...(manager ? [{ id: 'equipe', label: 'Equipe', short: 'Equipe', icon: UsersRound }] : []),
      { id: 'conta', label: 'Minha conta', short: 'Conta', icon: UserRound },
    ],
    [canView, canSup, manager, newCount, user],
  );
  const home: Tab = canView ? 'solicitacoes' : canSup ? 'fornecedores' : 'inicio';
  const current: Tab = !user
    ? tab
    : (tab === 'equipe' && !manager) || (tab === 'solicitacoes' && !canView) || (tab === 'fornecedores' && !canSup) || (tab === 'inicio' && home !== 'inicio')
      ? home
      : tab;

  const requestsRef = useRef(purchases.requests);
  requestsRef.current = purchases.requests;
  const host = useMemo<MaxHost>(
    () => ({
      scope: 'sector',
      sector,
      user,
      tabs: [
        ...(canView ? [{ id: 'solicitacoes', label: 'Solicitações', aliases: ['solicitacoes', 'pedidos', 'solicitacoes de compra', 'pedidos de compra', 'inicio'] }] : []),
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
    [sector, user, canView, canSup, canSupEdit, manager, current, setTab, logout, warp],
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
            {current === 'solicitacoes' && canView && (
              <PurchaseBoard mode="compras" requests={purchases.requests} failed={purchases.failed} canEdit={canEdit} reload={reload} openId={openId} setOpenId={setOpenId} />
            )}
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
