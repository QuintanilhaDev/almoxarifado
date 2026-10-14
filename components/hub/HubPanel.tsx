'use client';
import { BarChart3, Brain, Building, UserRound, UsersRound } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccountSettings } from '../core/AccountSettings';
import { AppFrame, type FrameTab } from '../core/AppFrame';
import { api } from '../core/api';
import { ToastProvider } from '../core/Toasts';
import { MaxAssistant } from '../max/MaxAssistant';
import type { HubUserRow } from '@/lib/permissions';
import type { Posto, RequestRow, StockItem } from '@/lib/almoxarifado/types';
import { useRealtime } from '@/lib/realtime';
import { useHashTab, useSession } from '@/lib/useSession';
import type { MaxHost } from '@/lib/max/types';
import { SectorsOverview } from './SectorsOverview';
import dynamic from 'next/dynamic';
import { PanelSkeleton, usePreload } from '../core/lazy';
import { loadAlmox, loadCompras, loadShell } from '../setores/SectorApp';

const loadUsers = () => import('./UsersAdmin');
const loadLearning = () => import('./MaxLearning');
const loadGestao = () => import('./Gestao');
const UsersAdmin = dynamic(() => loadUsers().then((m) => m.UsersAdmin), { loading: PanelSkeleton });
const MaxLearning = dynamic(() => loadLearning().then((m) => m.MaxLearning), { loading: PanelSkeleton });
const Gestao = dynamic(() => loadGestao().then((m) => m.Gestao), { loading: PanelSkeleton });
// no painel master, o código das telas e dos setores chega com a página parada
const PRELOAD = [loadGestao, loadUsers, loadAlmox, loadShell, loadCompras, loadLearning];
import { useWarp } from '../core/Warp';
import './hub.css';

type Tab = 'setores' | 'gestao' | 'usuarios' | 'max' | 'conta';
const VALID: Tab[] = ['setores', 'gestao', 'usuarios', 'max', 'conta'];
const TABS: FrameTab[] = [
  { id: 'setores', label: 'Setores', short: 'Setores', icon: Building },
  { id: 'gestao', label: 'Gestão', short: 'Gestão', icon: BarChart3 },
  { id: 'usuarios', label: 'Usuários', short: 'Usuários', icon: UsersRound },
  { id: 'max', label: 'Aprendizado da Max', short: 'Max', icon: Brain },
  { id: 'conta', label: 'Minha conta', short: 'Conta', icon: UserRound },
];

/** Painel do master geral: todos os setores e todos os usuários. */
export function HubPanel() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}

function Shell() {
  usePreload(PRELOAD);
  const { user, setUser, refresh, intro, endIntro, logout } = useSession('/hub');
  const [tab, setTab] = useHashTab<Tab>(VALID, 'setores');
  const warp = useWarp();
  const [users, setUsers] = useState<HubUserRow[] | null>(null);
  const [failed, setFailed] = useState('');
  const usersRef = useRef<HubUserRow[] | null>(null);
  usersRef.current = users;

  const loadUsers = useCallback(async () => {
    try {
      const j = await api<{ users: HubUserRow[] }>('/api/hub/users');
      setUsers(j.users);
      setFailed('');
    } catch (e) {
      setFailed((e as Error).message);
    }
  }, []);
  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  // dados do almoxarifado, para a Max responder daqui mesmo ("métricas do almoxarifado", "estoque baixo"…)
  const almoxRef = useRef<{ requests: RequestRow[] | null; items: StockItem[] | null; postos: Posto[] | null; emails: number | null }>({ requests: null, items: null, postos: null, emails: null });
  const loadAlmox = useCallback(async () => {
    const get = async <T,>(url: string): Promise<T | null> => {
      try {
        const r = await fetch(url, { cache: 'no-store' });
        return r.ok ? ((await r.json()) as T) : null;
      } catch {
        return null;
      }
    };
    const [rq, it, po, em] = await Promise.all([
      get<{ requests: RequestRow[] }>('/api/almoxarifado/requests'),
      get<{ items: StockItem[] }>('/api/almoxarifado/stock'),
      get<{ postos: Posto[] }>('/api/almoxarifado/postos'),
      get<{ emails: unknown[] }>('/api/almoxarifado/emails'),
    ]);
    const cur = almoxRef.current;
    almoxRef.current = { requests: rq?.requests ?? cur.requests, items: it?.items ?? cur.items, postos: po?.postos ?? cur.postos, emails: em?.emails.length ?? cur.emails };
  }, []);
  useEffect(() => {
    loadAlmox();
  }, [loadAlmox]);

  const [gestaoVersion, setGestaoVersion] = useState(0);
  const gestaoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useRealtime(
    (ev) => {
      if (ev === 'admins:update') {
        refresh();
        loadUsers();
      }
      // os números da Gestão se atualizam sozinhos (com um respiro para juntar vários avisos)
      if (['order:new', 'order:update', 'stock:update', 'purchase:new', 'purchase:update', 'note:update'].includes(ev)) {
        if (gestaoTimer.current) clearTimeout(gestaoTimer.current);
        gestaoTimer.current = setTimeout(() => setGestaoVersion((v) => v + 1), 2500);
      }
    },
    () => {
      refresh();
      loadUsers();
      loadAlmox();
    },
    30000,
  );

  const host = useMemo<MaxHost>(
    () => ({
      scope: 'hub',
      sector: null,
      user,
      tabs: [
        { id: 'setores', label: 'Setores', aliases: ['setores', 'visao geral', 'inicio', 'pagina inicial'] },
        { id: 'gestao', label: 'Gestão', aliases: ['gestao', 'indicadores', 'painel da gestao', 'relatorios', 'dashboard'] },
        { id: 'usuarios', label: 'Usuários', aliases: ['usuarios', 'pessoas', 'cadastro de usuarios', 'acessos'] },
        { id: 'max', label: 'Aprendizado da Max', aliases: ['aprendizado', 'aprendizado da max', 'memoria da max', 'o que voce aprendeu'] },
        { id: 'conta', label: 'Minha conta', aliases: ['conta', 'minha conta', 'perfil', 'senha', 'minha senha'] },
      ],
      tab,
      // pedidos sobre outro setor chegam com abas que não existem aqui: ignora
      goTab: (id) => {
        if (VALID.includes(id as Tab)) setTab(id as Tab);
      },
      can: () => true,
      navigate: (path, opts) => warp.go(path, opts),
      logout,
      hub: { users: () => usersRef.current },
      almox: {
        requests: () => almoxRef.current.requests,
        items: () => almoxRef.current.items,
        postos: () => almoxRef.current.postos,
        emailsCount: () => almoxRef.current.emails,
      },
    }),
    [user, tab, setTab, logout, warp],
  );

  return (
    <>
      <AppFrame sub="Painel master" tabs={TABS} tab={tab} onTab={(t) => setTab(t as Tab)} user={user} onLogout={logout} intro={intro} onIntroEnd={endIntro}>
        {tab === 'setores' && <SectorsOverview me={user} users={users} failed={failed} retry={loadUsers} onSeeTeam={() => setTab('usuarios')} />}
        {tab === 'gestao' && <Gestao version={gestaoVersion} />}
        {tab === 'usuarios' && <UsersAdmin me={user} users={users} setUsers={setUsers} failed={failed} reload={loadUsers} />}
        {tab === 'max' && <MaxLearning />}
        {tab === 'conta' && <AccountSettings user={user} setUser={setUser} onLogout={logout} />}
      </AppFrame>
      <MaxAssistant host={host} />
    </>
  );
}
