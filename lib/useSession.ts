'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/components/core/api';
import { INTRO_FLAG } from '@/components/core/AppFrame';
import type { HubUser } from './permissions';

/**
 * Pessoa logada + utilidades comuns às telas: transição de entrada, sair e
 * redirecionar se o acesso mudou (trocaram o setor, tiraram o master, desativaram).
 */
export function useSession(here: string) {
  const [user, setUser] = useState<HubUser | null>(null);
  const [intro, setIntro] = useState(false);
  const hereRef = useRef(here);
  hereRef.current = here;

  const refresh = useCallback(async () => {
    try {
      const j = await api<{ user: HubUser; home: string }>('/api/auth/me');
      // só troca o estado se algo mudou de verdade (evita recarregar as telas à toa)
      setUser((cur) => (cur && JSON.stringify(cur) === JSON.stringify(j.user) ? cur : j.user));
      // a pessoa não pode mais ficar nesta página? leva para a casa dela
      const p = hereRef.current;
      const allowed = p === '/hub' ? j.user.is_master : p.startsWith('/setor/') ? j.user.is_master || '/setor/' + j.user.sector === p : true;
      if (!allowed) window.location.replace(j.home);
    } catch {
      /* 401 já redireciona para o login; outros erros mantêm a tela */
    }
  }, []);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(INTRO_FLAG) || document.documentElement.classList.contains('intro')) {
        sessionStorage.removeItem(INTRO_FLAG);
        setIntro(true);
      }
    } catch {
      /* ignore */
    }
    refresh();
  }, [refresh]);

  const endIntro = useCallback(() => {
    document.documentElement.classList.remove('intro');
    setIntro(false);
  }, []);

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    window.location.href = '/';
  }, []);

  return { user, setUser, refresh, intro, endIntro, logout };
}

/** Aba atual guardada no # do endereço (permite voltar e compartilhar o link). */
export function useHashTab<T extends string>(valid: readonly T[], fallback: T): [T, (t: T) => void] {
  const [tab, setTabState] = useState<T>(fallback);
  const validRef = useRef(valid);
  validRef.current = valid;
  useEffect(() => {
    const read = () => {
      const h = window.location.hash.replace('#', '') as T;
      if (validRef.current.includes(h)) setTabState(h);
    };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);
  const setTab = useCallback((t: T) => {
    setTabState(t);
    history.replaceState(null, '', '#' + t);
  }, []);
  return [tab, setTab];
}
