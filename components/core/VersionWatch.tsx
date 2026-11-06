'use client';
import { RefreshCw, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

const MINE = process.env.NEXT_PUBLIC_BUILD_VERSION || 'dev';
const EVERY = 45_000;
const QUIET = 25_000; // sem mexer na tela há tanto tempo, pode recarregar sozinho

/** Algo aberto ou sendo digitado: recarregar agora faria a pessoa perder o que estava fazendo. */
function busy(lastInput: number): boolean {
  if (document.querySelector('.overlay, [role="dialog"], [aria-modal="true"]')) return true;
  const a = document.activeElement as HTMLElement | null;
  if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return true;
  return Date.now() - lastInput < QUIET;
}

/**
 * Atualização automática do site: compara a versão desta tela com a publicada
 * (/version.json, arquivo estático) e, quando sai uma nova, recarrega sozinho assim que a
 * pessoa não estiver no meio de algo (nenhuma janela aberta nem campo em edição).
 * Enquanto isso, mostra um aviso com o botão "Atualizar agora".
 */
export function VersionWatch() {
  const [nova, setNova] = useState(false);
  const [hidden, setHidden] = useState(false);
  const lastInput = useRef(0);
  const novaRef = useRef(false);

  useEffect(() => {
    if (MINE === 'dev') return;
    let stop = false;
    const reload = () => {
      try {
        sessionStorage.setItem('maxhub:reloaded', String(Date.now()));
      } catch {
        /* ok */
      }
      window.location.reload();
    };
    // acabou de recarregar e a versão ainda não bate (cache no caminho): não entra em laço, só avisa
    const recente = () => {
      try {
        return Date.now() - Number(sessionStorage.getItem('maxhub:reloaded') || 0) < 120_000;
      } catch {
        return false;
      }
    };
    const tryApply = () => {
      if (!novaRef.current || recente()) return;
      if (document.visibilityState === 'hidden' || !busy(lastInput.current)) reload();
    };
    const check = async () => {
      if (stop || novaRef.current) return tryApply();
      try {
        const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!r.ok) return;
        const { version } = (await r.json()) as { version?: string };
        if (version && version !== MINE) {
          novaRef.current = true;
          setNova(true);
          tryApply();
        }
      } catch {
        /* sem internet: tenta na próxima */
      }
    };
    const mark = () => {
      lastInput.current = Date.now();
    };
    const onVis = () => {
      if (document.visibilityState === 'visible') check();
      else tryApply();
    };
    // arquivo de uma versão antiga que já saiu do ar: recarrega uma vez
    const onChunk = (e: ErrorEvent | PromiseRejectionEvent) => {
      const msg = String((e as PromiseRejectionEvent).reason?.message ?? (e as ErrorEvent).message ?? '');
      const name = String((e as PromiseRejectionEvent).reason?.name ?? '');
      if (!/ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed/i.test(`${name} ${msg}`)) return;
      let last = 0;
      try {
        last = Number(sessionStorage.getItem('maxhub:reloaded') || 0);
      } catch {
        /* ok */
      }
      if (Date.now() - last > 60_000) reload();
    };
    const first = setTimeout(check, 8000);
    const iv = setInterval(check, EVERY);
    const apply = setInterval(tryApply, 5000);
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', check);
    window.addEventListener('online', check);
    window.addEventListener('keydown', mark, true);
    window.addEventListener('pointerdown', mark, true);
    window.addEventListener('input', mark, true);
    window.addEventListener('error', onChunk);
    window.addEventListener('unhandledrejection', onChunk);
    return () => {
      stop = true;
      clearTimeout(first);
      clearInterval(iv);
      clearInterval(apply);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', check);
      window.removeEventListener('online', check);
      window.removeEventListener('keydown', mark, true);
      window.removeEventListener('pointerdown', mark, true);
      window.removeEventListener('input', mark, true);
      window.removeEventListener('error', onChunk);
      window.removeEventListener('unhandledrejection', onChunk);
    };
  }, []);

  if (!nova || hidden) return null;
  return (
    <div className="version-bar" role="status" data-no-tilt>
      <RefreshCw size={16} />
      <span>Saiu uma versão nova do Max Hub. A tela se atualiza sozinha quando você terminar o que está fazendo.</span>
      <button className="btn btn-primary btn-sm" onClick={() => window.location.reload()}>
        Atualizar agora
      </button>
      <button className="icon-btn" aria-label="Fechar aviso" onClick={() => setHidden(true)}>
        <X size={16} />
      </button>
    </div>
  );
}
