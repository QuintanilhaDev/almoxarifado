'use client';
import { LogOut, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Brand } from '../core/Brand';
import { INTRO_FLAG } from '../core/AppFrame';
import { firstName } from '@/lib/max/clock';

export function NoSector({ name }: { name: string }) {
  const [intro, setIntro] = useState(false);
  useEffect(() => {
    try {
      if (sessionStorage.getItem(INTRO_FLAG) || document.documentElement.classList.contains('intro')) {
        sessionStorage.removeItem(INTRO_FLAG);
        setIntro(true);
      }
    } catch {
      /* ignore */
    }
  }, []);
  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    window.location.href = '/';
  };
  return (
    <main className="center-page">
      <div className="center-card">
        <Brand />
        <h1>Quase lá, {firstName(name) || name}</h1>
        <p>Seu acesso existe, mas ainda não foi alocado em nenhum setor. Peça ao administrador do Max Hub para definir o seu setor e depois atualize esta página.</p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            <RefreshCw size={16} /> Atualizar
          </button>
          <button className="btn btn-ghost" onClick={logout}>
            <LogOut size={16} /> Sair
          </button>
        </div>
      </div>
      <div
        className={`intro-overlay${intro ? ' play' : ''}`}
        aria-hidden
        onAnimationEnd={() => {
          document.documentElement.classList.remove('intro');
          setIntro(false);
        }}
      />
    </main>
  );
}
