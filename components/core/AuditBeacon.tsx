'use client';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { auditLog, watchFetch } from '@/lib/auditClient';

const INSIDE = /^\/(hub|setor|sem-setor|dashboard)(\/|$)/;

/** Conta para a Auditoria as telas e abas que a pessoa abre e as alterações que faz. */
export function AuditBeacon() {
  const pathname = usePathname();
  const lastScreen = useRef('');

  useEffect(() => {
    if (INSIDE.test(pathname ?? '')) watchFetch();
  }, [pathname]);

  useEffect(() => {
    if (!INSIDE.test(pathname ?? '')) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const report = () => {
      if (t) clearTimeout(t);
      // espera a tela montar para ler o nome da aba e do setor
      t = setTimeout(() => {
        const tab = document.querySelector('.nav-item.is-active span:not(.nav-count):not(.nav-bg)')?.textContent?.trim();
        const where = document.querySelector('.side .brand small, .brand small')?.textContent?.trim();
        const label = [tab, where && where !== tab ? where : null].filter(Boolean).join(' · ');
        if (!label || label === lastScreen.current) return;
        lastScreen.current = label;
        auditLog({ kind: 'tela', action: `Abriu ${label}` });
      }, 700);
    };
    report();
    window.addEventListener('hashchange', report);
    // troca de aba sem mudar o endereço: confere a aba ativa de tempos em tempos (barato)
    let lastTab: Element | null = null;
    const poll = setInterval(() => {
      const tab = document.querySelector('.nav-item.is-active');
      if (tab && tab !== lastTab) {
        lastTab = tab;
        report();
      }
    }, 800);
    return () => {
      if (t) clearTimeout(t);
      clearInterval(poll);
      window.removeEventListener('hashchange', report);
    };
  }, [pathname]);

  return null;
}
