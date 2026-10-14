'use client';
import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { currentTheme, toggleTheme, type Theme } from '@/lib/theme';

/** Botão de modo claro / escuro (a troca é a onda que sai do canto inferior direito). */
export function ThemeToggle({ className = 'icon-btn' }: { className?: string }) {
  const [theme, setThemeState] = useState<Theme>('dark');
  useEffect(() => {
    setThemeState(currentTheme());
    const on = (e: Event) => setThemeState((e as CustomEvent<Theme>).detail);
    window.addEventListener('maxhub:theme', on);
    return () => window.removeEventListener('maxhub:theme', on);
  }, []);
  const light = theme === 'light';
  return (
    <button
      type="button"
      className={`${className} theme-btn${light ? ' is-light' : ''}`}
      onClick={() => void toggleTheme()}
      aria-label={light ? 'Mudar para o modo escuro' : 'Mudar para o modo claro'}
      title={light ? 'Modo escuro' : 'Modo claro'}
      data-max="tema"
    >
      <span className="theme-ico">
        <Sun size={18} className="ti-sun" />
        <Moon size={18} className="ti-moon" />
      </span>
    </button>
  );
}
