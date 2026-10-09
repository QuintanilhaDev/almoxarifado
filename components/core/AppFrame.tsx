'use client';
import { useWarp } from './Warp';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, LogOut, type LucideIcon } from 'lucide-react';
import { useEffect } from 'react';
import { initials } from '@/lib/format';
import type { HubUser } from '@/lib/permissions';
import { Brand } from './Brand';

export interface FrameTab {
  id: string;
  label: string;
  /** rótulo curto da barra do celular */
  short: string;
  icon: LucideIcon;
  badge?: number;
  badgeTone?: 'warn';
  badgeTitle?: string;
}

export const INTRO_FLAG = 'maxhub:intro';

/** Marca a página antes de o React carregar, para a transição do login continuar lilás sem "piscar". */
export const introScript = `try{if(sessionStorage.getItem('${INTRO_FLAG}'))document.documentElement.classList.add('intro')}catch(e){}`;

/**
 * Moldura padrão de todas as ferramentas do Max Hub: menu lateral no computador,
 * topo e barra de abas no celular, rodapé com a pessoa logada.
 */
export function AppFrame({
  sub,
  tabs,
  tab,
  onTab,
  user,
  onLogout,
  intro,
  onIntroEnd,
  children,
}: {
  /** linha pequena sob a marca (nome do setor ou "Painel master") */
  sub: string;
  tabs: FrameTab[];
  tab: string;
  onTab: (id: string) => void;
  user: HubUser | null;
  onLogout: () => void;
  intro?: boolean;
  onIntroEnd?: () => void;
  children: React.ReactNode;
}) {
  // no celular a barra de abas rola: mantém a aba ativa à vista
  useEffect(() => {
    document.querySelector('.tabbar .tab.is-active')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [tab, tabs.length]);

  const role = user?.is_master ? 'Master geral' : user?.sector_role === 'master' ? 'Master do setor' : null;
  // master geral visitando a ferramenta de um setor: atalho de volta
  const backToHub = Boolean(user?.is_master) && sub !== 'Painel master';
  const warp = useWarp();
  const backClick = (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    warp.go('/hub');
  };

  return (
    <div className="dash">
      <aside className="side">
        <Brand sub={sub} />
        {backToHub ? (
          <a className="side-back" href="/hub" onClick={backClick}>
            <ArrowLeft size={15} /> Painel master
          </a>
        ) : null}
        <nav className="nav" aria-label="Seções">
          {tabs.map((t) => (
            <button key={t.id} className={`nav-item${tab === t.id ? ' is-active' : ''}`} onClick={() => onTab(t.id)} aria-current={tab === t.id ? 'page' : undefined}>
              {tab === t.id ? <motion.span layoutId="nav-bg" className="nav-bg" transition={{ type: 'spring', stiffness: 500, damping: 38 }} /> : null}
              <t.icon size={19} />
              <span>{t.label}</span>
              {t.badge ? (
                <span className={`nav-count${t.badgeTone ? ' ' + t.badgeTone : ''}`} title={t.badgeTitle}>
                  {t.badge}
                </span>
              ) : null}
            </button>
          ))}
        </nav>
        <div className="side-foot">
          <span className="me-avatar">{initials(user?.display_name)}</span>
          <div className="me-name" style={{ flex: 1 }}>
            {user?.display_name || '…'}
            <small>{role ?? (user ? '@' + user.username : ' ')}</small>
          </div>
          <button className="icon-btn" onClick={onLogout} aria-label="Sair" title="Sair">
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      <header className="mobile-top">
        <Brand sub={sub} />
        <div className="mobile-top-actions">
          {backToHub ? (
            <a className="icon-btn" href="/hub" onClick={backClick} aria-label="Voltar ao painel master" title="Painel master">
              <ArrowLeft size={18} />
            </a>
          ) : null}
          <button className="icon-btn" onClick={onLogout} aria-label="Sair" title="Sair">
            <LogOut size={18} />
          </button>
        </div>
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
            {children}
          </motion.div>
        </AnimatePresence>
      </main>

      <nav className="tabbar" aria-label="Seções" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(58px, 1fr))` }}>
        {tabs.map((t) => (
          <button key={t.id} className={`tab${tab === t.id ? ' is-active' : ''}`} onClick={() => onTab(t.id)} aria-current={tab === t.id ? 'page' : undefined}>
            {tab === t.id ? <motion.span layoutId="tab-bg" className="nav-bg" transition={{ type: 'spring', stiffness: 500, damping: 38 }} /> : null}
            <t.icon size={20} />
            <span>{t.short}</span>
            {t.badge ? <span className={`nav-count${t.badgeTone ? ' ' + t.badgeTone : ''}`}>{t.badge}</span> : null}
          </button>
        ))}
      </nav>

      <div className={`intro-overlay${intro ? ' play' : ''}`} aria-hidden onAnimationEnd={onIntroEnd} />
    </div>
  );
}
