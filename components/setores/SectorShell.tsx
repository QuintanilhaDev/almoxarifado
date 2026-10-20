'use client';
import { CalendarClock, ClipboardList, Fingerprint, Hammer, LayoutDashboard, Lock, Receipt, Sparkles, UserRound, Users, UsersRound } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccountSettings } from '../core/AccountSettings';
import { AppFrame, type FrameTab } from '../core/AppFrame';
import { TeamManager } from '../core/TeamManager';
import { ToastProvider, useToast } from '../core/Toasts';
import { useWarp } from '../core/Warp';
import { MaxAssistant } from '../max/MaxAssistant';
import { OrdersPanel } from '../pedidos/OrdersPanel';
import { usePedidos } from '../pedidos/usePedidos';
import dynamic from 'next/dynamic';
import { PanelSkeleton, usePreload } from '../core/lazy';

const loadNotas = () => import('../notas/NotasPanel');
const loadColab = () => import('../rh/Colaboradores');
const loadTroca = () => import('../rh/TrocaAnual');
const loadPontos = () => import('../pontos/PontosPanel');
const PontosPanel = dynamic(() => loadPontos().then((m) => m.PontosPanel), { loading: PanelSkeleton });
const NotasPanel = dynamic(() => loadNotas().then((m) => m.NotasPanel), { loading: PanelSkeleton });
const Colaboradores = dynamic(() => loadColab().then((m) => m.Colaboradores), { loading: PanelSkeleton });
const TrocaAnual = dynamic(() => loadTroca().then((m) => m.TrocaAnual), { loading: PanelSkeleton });
import { chime } from '@/lib/chime';
import { maxEmit, useMaxBus } from '@/lib/max/bus';
import { canManageSector, hasLevel } from '@/lib/permissions';
import { canPontos } from '@/lib/pontos/types';
import { useRealtime } from '@/lib/realtime';
import { getSector, sectorPath } from '@/lib/sectors';
import { useHashTab, useSession } from '@/lib/useSession';
import { ORIGIN_LABEL, orderLabel, type MaterialOrder } from '@/lib/pedidos/types';
import type { OrderScope } from '@/lib/pedidos/access';
import type { MaxHost } from '@/lib/max/types';

type ToolTab = 'pedidos' | 'colaboradores' | 'trocas' | 'notas';
type Tab = ToolTab | 'pontos' | 'inicio' | 'equipe' | 'conta';
const VALID: Tab[] = ['pedidos', 'colaboradores', 'trocas', 'notas', 'pontos', 'inicio', 'equipe', 'conta'];

/** Abas de ferramenta de cada setor (Projeto 3). Cada aba aparece só para quem tem o módulo. */
const TOOLS: Record<string, { id: ToolTab; label: string; short: string; icon: typeof ClipboardList; module: string; aliases: string[]; also?: string }[]> = {
  rh: [
    { id: 'pedidos', label: 'Pedidos', short: 'Pedidos', icon: ClipboardList, module: 'pedidos', aliases: ['pedidos', 'admissoes', 'admissao', 'pedidos de material', 'kits'] },
    { id: 'colaboradores', label: 'Colaboradores', short: 'Pessoas', icon: Users, module: 'colaboradores', aliases: ['colaboradores', 'funcionarios', 'pessoas', 'cadastro', 'kits por funcao'] },
    { id: 'trocas', label: 'Troca anual', short: 'Trocas', icon: CalendarClock, module: 'pedidos', also: 'colaboradores', aliases: ['troca anual', 'trocas', 'troca de fardamento', 'troca'] },
  ],
  operacional: [{ id: 'pedidos', label: 'Pedidos de material', short: 'Pedidos', icon: ClipboardList, module: 'pedidos', aliases: ['pedidos', 'pedidos de material', 'solicitacoes', 'trocas para validar'] }],
  financeiro: [{ id: 'notas', label: 'Notas e vencimentos', short: 'Notas', icon: Receipt, module: 'notas', aliases: ['notas', 'notas fiscais', 'vencimentos', 'parcelas', 'boletos'] }],
};
const SCOPE: Record<string, OrderScope | undefined> = { rh: 'rh', operacional: 'operacao' };

/**
 * Tela de um setor: moldura, Equipe, Minha conta e a Max, mais as ferramentas que o setor já tem
 * (RH: pedidos, colaboradores e troca anual; Operacional: pedidos; Financeiro: notas).
 */
export function SectorShell({ slug }: { slug: string }) {
  return (
    <ToastProvider>
      <Shell slug={slug} />
    </ToastProvider>
  );
}

function Shell({ slug }: { slug: string }) {
  usePreload(slug === 'rh' ? [loadColab, loadTroca] : slug === 'financeiro' ? [loadNotas] : []);
  const sector = getSector(slug)!;
  const toast = useToast();
  const { user, setUser, refresh, intro, endIntro, logout } = useSession(sectorPath(slug));
  const tools = useMemo(() => (TOOLS[slug] ?? []).filter((t) => hasLevel(user, slug, t.module, 'view') || (t.also ? hasLevel(user, slug, t.also, 'view') : false)), [slug, user]);
  // aba Pontos: só para quem foi liberado pelo nome de usuário (a Evelyn)
  const pontos = canPontos(user);
  const first: Tab = tools[0]?.id ?? (pontos ? 'pontos' : 'inicio');
  const [tab, setTab] = useHashTab<Tab>(VALID, first);
  const warp = useWarp();
  const [teamVersion, setTeamVersion] = useState(0);
  const [collabVersion, setCollabVersion] = useState(0);
  const [openOrder, setOpenOrder] = useState<string | null>(null);
  const manager = canManageSector(user, slug);
  const scope = SCOPE[slug];
  const canOrders = Boolean(scope) && hasLevel(user, slug, 'pedidos', 'view');
  const canOrdersRef = useRef(canOrders);
  canOrdersRef.current = canOrders;
  const userRef = useRef(user);
  userRef.current = user;
  const setTabRef = useRef(setTab);
  setTabRef.current = setTab;

  // pedidos: avisos de pedido novo (Operação) e de entregas (RH)
  const pedidos = usePedidos(scope ?? 'almox', {
    onNew: (fresh) => {
      if (slug !== 'operacional') return;
      const mine = fresh.filter((o) => o.stage === 'solicitado' || o.stage === 'validacao');
      if (!mine.length) return;
      chime();
      const o = mine[0];
      toast(
        {
          kind: 'info',
          title: mine.length > 1 ? `${mine.length} pedidos esperando a Operação` : o.stage === 'validacao' ? `Troca ${orderLabel(o.number)} para validar` : `Novo pedido ${orderLabel(o.number)} para conferir`,
          text: mine.length > 1 ? undefined : `${o.collaborator_name ?? o.posto_name ?? ''} · ${ORIGIN_LABEL[o.origin]}`,
          action: { label: 'Ver', onClick: () => { setTabRef.current('pedidos'); setOpenOrder(o.id); } },
        },
        15000,
      );
      maxEmit('max:announce', {
        text: mine.length > 1 ? `Operação, ${mine.length} pedidos de material esperando conferência.` : o.stage === 'validacao' ? `Operação, o RH abriu a troca de fardamento de ${o.collaborator_name ?? 'um colaborador'}. Falta validar.` : `Operação, chegou um pedido de material${o.posto_name ? ` do ${o.posto_name}` : ''} para conferir.`,
        tone: 'alert',
      });
    },
    onChange: (changed) => {
      const me = userRef.current?.display_name;
      const done = changed.filter((c) => c.order.stage === 'concluido' && c.from.stage !== 'concluido');
      const partial = changed.filter((c) => c.order.items.reduce((t, l) => t + l.delivered, 0) > c.from.items.reduce((t, l) => t + l.delivered, 0) && c.order.stage !== 'concluido');
      const returned = changed.filter((c) => c.from.stage === 'encaminhado' && (c.order.stage === 'solicitado' || c.order.stage === 'validacao'));
      const show = (o: MaterialOrder, title: string) => toast({ kind: 'info', title, text: o.collaborator_name ?? o.posto_name ?? undefined, action: { label: 'Ver', onClick: () => { setTabRef.current('pedidos'); setOpenOrder(o.id); } } }, 10000);
      if (done[0]) show(done[0].order, `Pedido ${orderLabel(done[0].order.number)} entregue por completo`);
      else if (partial[0]) show(partial[0].order, `Entrega parcial no pedido ${orderLabel(partial[0].order.number)}`);
      if (returned[0] && returned[0].order.history[returned[0].order.history.length - 1]?.by !== me) {
        chime();
        show(returned[0].order, `O Almoxarifado devolveu o pedido ${orderLabel(returned[0].order.number)} para correção`);
      }
    },
  });
  const reloadOrders = pedidos.reload;
  const pedidosRef = useRef(pedidos.data);
  pedidosRef.current = pedidos.data;
  useMaxBus('pedidos:open', (p) => {
    if (!canOrdersRef.current) return;
    setTabRef.current('pedidos');
    const id = p.id ?? (p.number ? pedidosRef.current?.orders.find((o) => o.number === p.number)?.id : undefined);
    if (id) setOpenOrder(id);
  });
  useEffect(() => {
    if (user && canOrders) void reloadOrders();
  }, [user, canOrders, reloadOrders]);

  useRealtime(
    (ev) => {
      if (ev === 'admins:update') {
        refresh();
        setTeamVersion((v) => v + 1);
      }
      if ((ev === 'order:new' || ev === 'order:update' || ev === 'purchase:update' || ev === 'stock:update') && canOrdersRef.current) void reloadOrders();
      if (ev === 'collab:update' || ev === 'order:update' || ev === 'order:new') setCollabVersion((v) => v + 1);
      if (ev === 'note:update') window.dispatchEvent(new Event('maxhub:notes'));
    },
    () => {
      refresh();
      if (canOrdersRef.current) void reloadOrders();
    },
    canOrders ? 10000 : 30000,
  );

  const waiting = useMemo(() => {
    if (!pedidos.data || !scope) return 0;
    return pedidos.data.orders.filter((o) => (scope === 'operacao' ? o.stage === 'solicitado' || o.stage === 'validacao' : false)).length;
  }, [pedidos.data, scope]);

  const tabs = useMemo<FrameTab[]>(
    () => [
      ...(tools.length ? tools.map((t) => ({ id: t.id, label: t.label, short: t.short, icon: t.icon, badge: t.id === 'pedidos' ? waiting : 0, badgeTitle: 'Esperando a Operação' })) : pontos ? [] : [{ id: 'inicio', label: 'Início', short: 'Início', icon: user && (TOOLS[slug] ?? []).length ? Lock : LayoutDashboard }]),
      ...(pontos ? [{ id: 'pontos', label: 'Pontos', short: 'Pontos', icon: Fingerprint }] : []),
      ...(manager ? [{ id: 'equipe', label: 'Equipe', short: 'Equipe', icon: UsersRound }] : []),
      { id: 'conta', label: 'Minha conta', short: 'Conta', icon: UserRound },
    ],
    [tools, manager, waiting, user, slug, pontos],
  );
  const allowed = (t: Tab) => (t === 'conta' ? true : t === 'equipe' ? manager : t === 'pontos' ? pontos : t === 'inicio' ? tools.length === 0 && !pontos : tools.some((x) => x.id === t));
  const current: Tab = !user ? tab : allowed(tab) ? tab : first;

  const ordersRef = useRef(pedidos.data?.orders ?? null);
  ordersRef.current = pedidos.data?.orders ?? null;
  const host = useMemo<MaxHost>(
    () => ({
      scope: 'sector',
      sector,
      user,
      tabs: [
        ...tools.map((t) => ({ id: t.id, label: t.label, aliases: t.aliases })),
        ...(tools.length || pontos ? [] : [{ id: 'inicio', label: 'Início', aliases: ['inicio', 'pagina inicial', 'tela inicial', 'home'] }]),
        ...(pontos ? [{ id: 'pontos', label: 'Pontos', aliases: ['pontos', 'ponto', 'espelho', 'espelho de ponto', 'registro de ponto', 'batidas', 'apuracao', 'apuracao de ponto', 'relatorio de ponto'] }] : []),
        ...(manager ? [{ id: 'equipe', label: 'Equipe', aliases: ['equipe', 'permissoes', 'time', 'pessoas'] }] : []),
        { id: 'conta', label: 'Minha conta', aliases: ['conta', 'minha conta', 'perfil', 'senha', 'minha senha'] },
      ],
      tab: current,
      goTab: (id) => setTab(id as Tab),
      can: (m, level = 'view') => hasLevel(user, slug, m, level),
      navigate: (path, opts) => warp.go(path, opts),
      logout,
      ...(scope ? { pedidos: { scope, orders: () => (canOrdersRef.current ? ordersRef.current : null) } } : {}),
    }),
    [sector, user, tools, manager, current, setTab, logout, warp, slug, scope, pontos],
  );

  const edit = useCallback((m: string) => hasLevel(user, slug, m, 'edit'), [user, slug]);
  const tool = tools.find((t) => t.id === current);
  const readOnly = Boolean(user && tool && !edit(tool.module) && !(tool.also && edit(tool.also)));

  return (
    <>
      <AppFrame sub={sector.name} tabs={tabs} tab={current} onTab={(t) => setTab(t as Tab)} user={user} onLogout={logout} intro={intro} onIntroEnd={endIntro}>
        {!user ? (
          <div className="rc-empty" style={{ margin: 'auto' }}>
            <span className="spinner" /> Carregando…
          </div>
        ) : (
          <div className={`module${readOnly ? ' is-readonly' : ''}`}>
            {current === 'inicio' && (
              <div className="section-scroll">
                <div className="section-pad" style={{ maxWidth: 860 }}>
                  <div className="section-head">
                    <div>
                      <h1>{sector.name}</h1>
                      <p>{sector.description}</p>
                    </div>
                  </div>
                  {(TOOLS[slug] ?? []).length ? (
                    <div className="blank-tool">
                      <span className="empty-icon">
                        <Lock size={24} />
                      </span>
                      <strong>Você ainda não tem acesso às ferramentas do setor</strong>
                      <span>Peça ao master do setor para liberar o acesso.</span>
                    </div>
                  ) : (
                    <>
                      <div className="blank-tool">
                        <span className="empty-icon">
                          <Hammer size={24} />
                        </span>
                        <strong>Ferramenta em preparação</strong>
                        <span>Este é o espaço do setor {sector.name} no Max Hub. As funções ainda não foram criadas: quando entrarem, aparecem aqui e no menu ao lado.</span>
                      </div>
                      <div className="blank-tip">
                        <Sparkles size={18} />
                        <p>
                          A Max já está por aqui, no canto inferior direito. Clique na esfera, espere ficar verde e diga <b>“Max, que dia é hoje?”</b> ou <b>“Max, abrir minha conta”</b>.
                        </p>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
            {current === 'pedidos' && scope ? (
              <OrdersPanel scope={scope} user={user} data={pedidos.data} failed={pedidos.failed} setup={pedidos.setup} reload={pedidos.reload} canEdit={edit('pedidos')} openId={openOrder} setOpenId={setOpenOrder} />
            ) : null}
            {current === 'colaboradores' && <Colaboradores canEdit={edit('colaboradores')} version={collabVersion} />}
            {current === 'trocas' && <TrocaAnual canEdit={edit('pedidos')} isMaster={manager} version={collabVersion} onOpened={() => void reloadOrders()} />}
            {current === 'notas' && <NotasPanel mode="financeiro" canEdit={false} />}
            {current === 'pontos' && pontos && <PontosPanel />}
            {current === 'equipe' && manager && <TeamManager slug={slug} me={user} version={teamVersion} />}
            {current === 'conta' && <AccountSettings user={user} setUser={setUser} onLogout={logout} />}
          </div>
        )}
      </AppFrame>
      <MaxAssistant host={host} />
    </>
  );
}
