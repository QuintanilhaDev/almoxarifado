'use client';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { MaxOrb } from '../max/MaxOrb';
import { loadVoices, speak } from '@/lib/voice';
import { getSector } from '@/lib/sectors';
import './warp.css';

/**
 * Troca de tela "pela Max": a esfera sai do canto, cresce no meio da tela, anuncia
 * ("Abrindo o setor Almoxarifado"), toma a tela inteira e revela a ferramenta escolhida.
 * A navegação acontece por baixo, na mesma página (sem recarregar o site).
 */
interface WarpOptions {
  /** a Max já está falando a frase (pedido por voz): aqui só acontece a animação */
  spoken?: boolean;
}
interface WarpApi {
  go: (path: string, opts?: WarpOptions) => void;
}
const Ctx = createContext<WarpApi>({
  go: (path) => {
    window.location.href = path;
  },
});
export const useWarp = () => useContext(Ctx);

/** Caminhos que usam a animação (o resto navega normalmente). */
export function warpLabel(path: string): { lead: string; name: string } | null {
  const clean = path.split(/[?#]/)[0];
  if (clean === '/hub') return { lead: 'Voltando ao', name: 'Painel master' };
  const m = clean.match(/^\/setor\/([a-z-]+)$/);
  const sector = m ? getSector(m[1]) : null;
  return sector ? { lead: 'Abrindo o setor', name: sector.name } : null;
}

type Phase = 'rise' | 'flood' | 'reveal';
interface Run {
  id: number;
  path: string;
  lead: string;
  name: string;
  phase: Phase;
  /** de onde a esfera sai: deslocamento do centro do botão da Max até o meio da tela, e o tamanho dela lá */
  from: { x: number; y: number; size: number };
  big: number;
}

/** a esfera é desenhada neste tamanho e ampliada por transformação (leve para qualquer computador) */
const ORB = 280;
const RISE_MS = 1500;
const FLOOD_MS = 720;
const REVEAL_MS = 620;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const voiceOn = () => {
  try {
    return localStorage.getItem('maxhub:voz') !== 'off';
  } catch {
    return true;
  }
};
const stillSpeaking = () => {
  try {
    return typeof window !== 'undefined' && 'speechSynthesis' in window && (window.speechSynthesis.speaking || window.speechSynthesis.pending);
  } catch {
    return false;
  }
};

export function WarpProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const reduce = useReducedMotion();
  const [run, setRun] = useState<Run | null>(null);
  const busy = useRef(false);
  const seq = useRef(0);
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  const go = useCallback(
    (path: string, opts: WarpOptions = {}) => {
      const label = warpLabel(path);
      const target = path.split(/[?#]/)[0];
      if (!label) {
        window.location.href = path;
        return;
      }
      if (busy.current || pathRef.current === target) return;
      busy.current = true;
      const id = ++seq.current;
      const w = window.innerWidth;
      const h = window.innerHeight;
      const fab = document.querySelector('.max-fab')?.getBoundingClientRect();
      const at = fab ? { x: fab.left + fab.width / 2, y: fab.top + fab.height / 2, size: fab.width } : { x: w - 52, y: h - 52, size: 68 };
      const from = { x: at.x - w / 2, y: at.y - h * 0.46, size: at.size };
      // a esfera ocupa pouco mais da metade do quadro (o resto é o brilho em volta)
      const big = Math.round(Math.min(440, Math.min(w, h) * 0.78));
      document.documentElement.classList.add('is-warping');
      setRun({ id, path, lead: label.lead, name: label.name, phase: 'rise', from, big });
      try {
        router.prefetch(path);
      } catch {
        /* ignore */
      }

      void (async () => {
        const started = Date.now();
        // a frase: ou a Max já está falando (pedido por voz), ou falamos aqui (clique no botão)
        let talking = Boolean(opts.spoken);
        if (!opts.spoken && voiceOn()) {
          talking = true;
          speak(`${label.lead} ${label.name}.`, { onEnd: () => (talking = false) });
        }
        await wait(reduce ? 500 : RISE_MS);
        // espera ela terminar a frase (sem travar se o navegador não avisar)
        while ((talking || stillSpeaking()) && Date.now() - started < 4500) {
          if (opts.spoken && !stillSpeaking() && Date.now() - started > RISE_MS + 300) break;
          await wait(120);
        }
        if (id !== seq.current) return;
        setRun((r) => (r && r.id === id ? { ...r, phase: 'flood' } : r));
        await wait(reduce ? 200 : FLOOD_MS);
        router.push(path);
        // a tela nova entra por baixo; se o Next não trocar em 8s, vai do jeito tradicional
        const pushed = Date.now();
        while (pathRef.current !== target && Date.now() - pushed < 8000) await wait(60);
        if (pathRef.current !== target) {
          window.location.href = path;
          return;
        }
        await wait(520); // dá tempo de a tela nova desenhar
        if (id !== seq.current) return;
        setRun((r) => (r && r.id === id ? { ...r, phase: 'reveal' } : r));
        await wait(reduce ? 250 : REVEAL_MS);
        document.documentElement.classList.remove('is-warping');
        busy.current = false;
        setRun((r) => (r && r.id === id ? null : r));
      })();
    },
    [router, reduce],
  );

  // deixa as vozes carregadas para a frase sair junto com a animação
  useEffect(() => {
    void loadVoices().catch(() => undefined);
  }, []);

  // segurança: se o componente sair de cena no meio, não deixa a classe presa
  useEffect(() => () => document.documentElement.classList.remove('is-warping'), []);

  return (
    <Ctx.Provider value={{ go }}>
      {children}
      <AnimatePresence>
        {run ? (
          <motion.div
            key={run.id}
            className={`warp is-${run.phase}`}
            role="status"
            aria-live="polite"
            initial={{ opacity: 1 }}
            animate={{ opacity: run.phase === 'reveal' ? 0 : 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: run.phase === 'reveal' ? REVEAL_MS / 1000 : 0.2, ease: 'easeOut' }}
          >
            <motion.div className="warp-dim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }} />
            {/* a onda que toma a tela */}
            <motion.div
              className="warp-flood"
              initial={{ scale: 0, opacity: 0 }}
              animate={run.phase === 'rise' ? { scale: 0, opacity: 0 } : { scale: 8, opacity: 1 }}
              transition={{ duration: reduce ? 0.2 : FLOOD_MS / 1000, ease: [0.7, 0, 0.3, 1] }}
            />
            <motion.div
              className="warp-orb"
              style={{ width: ORB, height: ORB, marginLeft: -ORB / 2, marginTop: -ORB / 2 }}
              initial={reduce ? { x: 0, y: 0, scale: 0.9, opacity: 0 } : { x: run.from.x, y: run.from.y, scale: run.from.size / ORB, opacity: 1 }}
              animate={
                run.phase === 'rise'
                  ? { x: 0, y: 0, scale: run.big / ORB, opacity: 1 }
                  : { x: 0, y: 0, scale: reduce ? run.big / ORB : (run.big / ORB) * 2.2, opacity: 0 }
              }
              transition={run.phase === 'rise' ? { type: 'spring', stiffness: 70, damping: 15, mass: 1 } : { duration: (FLOOD_MS / 1000) * 0.6, ease: 'easeIn' }}
            >
              {/* na revelação ela já sumiu: não gasta a placa de vídeo à toa */}
              {run.phase === 'reveal' ? null : <MaxOrb size={ORB} state="speaking" />}
            </motion.div>
            <motion.p
              className="warp-label"
              style={{ top: `calc(46% + ${Math.round(run.big * 0.3) + 44}px)` }}
              initial={{ opacity: 0, y: 14 }}
              animate={run.phase === 'rise' ? { opacity: 1, y: 0 } : { opacity: 0, y: -10 }}
              transition={{ duration: 0.45, delay: run.phase === 'rise' ? 0.55 : 0 }}
            >
              <small>{run.lead}</small>
              <strong>{run.name}</strong>
            </motion.p>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </Ctx.Provider>
  );
}
