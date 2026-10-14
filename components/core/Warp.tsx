'use client';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useRef } from 'react';
import { MaxRunner, type RunnerApi } from '../max/MaxRunner';
import { setRunner, type RunStep } from '@/lib/max/runner';
import { preloadSector } from '../setores/SectorApp';

/**
 * Troca de tela. Pelo clique, a página troca direto (com a entrada em 3D das telas).
 * Pela Max, ela sai correndo do canto até o botão certo, dá um soquinho nele e a tela troca.
 */
interface WarpOptions {
  /** a Max já está falando a frase */
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

const clean = (p: string) => p.split(/[?#]/)[0];
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const visible = (el: Element | null): el is HTMLElement => {
  if (!el) return false;
  const r = (el as HTMLElement).getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
};
const first = (sel: string): HTMLElement | null => [...document.querySelectorAll(sel)].find(visible) as HTMLElement | null ?? null;
/** espera o botão aparecer (a tela pode estar abrindo) */
async function waitFirst(sel: string, ms: number): Promise<HTMLElement | null> {
  const t0 = Date.now();
  for (;;) {
    const el = first(sel);
    if (el && !(el as HTMLButtonElement).disabled) return el;
    if (Date.now() - t0 > ms) return el;
    await wait(80);
  }
}

/**
 * Botão que abre a janela de arquivos: o navegador só deixa abrir com um clique de verdade da pessoa.
 * Depois do soco, aparece um cartãozinho ao lado do botão para escolher ou arrastar o arquivo.
 */
function showFilePick(btn: HTMLElement, inputSel: string) {
  const input = document.querySelector(inputSel) as HTMLInputElement | null;
  if (!input) return;
  document.querySelector('.max-filepick')?.remove();
  const r = btn.getBoundingClientRect();
  const card = document.createElement('div');
  card.className = 'max-filepick';
  card.setAttribute('role', 'dialog');
  card.innerHTML = '<strong>Escolha o arquivo</strong><span>ou arraste para cá</span><button type="button" class="btn btn-primary btn-sm">Escolher arquivo</button><button type="button" class="max-filepick-x" aria-label="Fechar">×</button>';
  const w = 240;
  card.style.left = `${Math.max(12, Math.min(window.innerWidth - w - 12, r.left + r.width / 2 - w / 2))}px`;
  card.style.top = `${r.bottom + 10 + 120 > window.innerHeight ? Math.max(12, r.top - 130) : r.bottom + 10}px`;
  const close = () => {
    card.remove();
    document.removeEventListener('pointerdown', outside, true);
  };
  const outside = (e: Event) => {
    if (!card.contains(e.target as Node)) close();
  };
  (card.querySelector('.btn') as HTMLButtonElement).onclick = () => {
    input.click();
    close();
  };
  (card.querySelector('.max-filepick-x') as HTMLButtonElement).onclick = close;
  card.addEventListener('dragover', (e) => {
    e.preventDefault();
    card.classList.add('is-over');
  });
  card.addEventListener('dragleave', () => card.classList.remove('is-over'));
  card.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = e.dataTransfer?.files;
    if (files?.length) {
      const dt = new DataTransfer();
      dt.items.add(files[0]);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    close();
  });
  document.body.appendChild(card);
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
  setTimeout(close, 45000);
}

export function WarpProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  const runner = useRef<RunnerApi>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());

  /** troca de página pelo roteador e espera a tela nova aparecer */
  const push = useCallback(
    async (path: string) => {
      const target = clean(path);
      if (pathRef.current === target) return;
      if (!/^\/(hub|setor\/[a-z-]+)$/.test(target)) {
        window.location.href = path;
        return;
      }
      router.push(path);
      const t0 = Date.now();
      while (pathRef.current !== target && Date.now() - t0 < 8000) await wait(50);
      if (pathRef.current !== target) {
        window.location.href = path;
        return;
      }
      // espera os botões da tela nova existirem
      const t1 = Date.now();
      while (!document.querySelector('.nav-item, .tab') && Date.now() - t1 < 5000) await wait(60);
      await wait(250);
    },
    [router],
  );

  const go = useCallback((path: string) => void push(path), [push]);

  /** os botões que levam até `path`, na ordem em que a Max precisa socar */
  const plan = useCallback((path: string): { el: () => HTMLElement | null; to: string | null }[] => {
    const target = clean(path);
    const here = pathRef.current;
    if (here === target) return [];
    const back = () => first('.side-back, .mobile-top a[href="/hub"]');
    const card = (p: string) => () => first(`.hub-card a[href="${p}"]`) ?? first(`a[href="${p}"]`);
    // no painel, os cards ficam na aba Setores: se ela não estiver aberta, soca a aba antes
    const setores = (p: string) => () => {
      if (card(p)()) return null;
      const tab = first('.nav-item[data-tab="setores"], .tab[data-tab="setores"]');
      return tab && !tab.classList.contains('is-active') ? tab : null;
    };
    if (target === '/hub') return [{ el: back, to: '/hub' }];
    if (/^\/setor\//.test(target)) {
      if (here === '/hub') return [{ el: setores(target), to: null }, { el: card(target), to: target }];
      return [
        { el: back, to: '/hub' },
        { el: setores(target), to: null },
        { el: card(target), to: target },
      ];
    }
    return [{ el: () => null, to: path }];
  }, []);

  useEffect(() => {
    const run = (steps: RunStep[], onFirstHit?: () => void) => {
      let hitDone = false;
      const hit = () => {
        if (!hitDone) {
          hitDone = true;
          onFirstHit?.();
        }
      };
      const job = chain.current.then(async () => {
        const r = runner.current;
        try {
          for (const step of steps) {
            if (step.kind === 'tab') {
              const btn = first(`.nav-item[data-tab="${step.id}"], .tab[data-tab="${step.id}"]`);
              if (!r || !btn || btn.classList.contains('is-active')) {
                step.exec();
                hit();
                continue;
              }
              await r.sprout();
              await r.punch(btn, () => {
                step.exec();
                hit();
              });
              await wait(120);
            } else if (step.kind === 'press') {
              const el = await waitFirst(step.sel, 4000);
              if (el && step.skipActive && el.classList.contains('is-active')) continue;
              const press = () => {
                hit();
                if (step.exec) step.exec();
                else if (el?.dataset.maxFile) showFilePick(el, el.dataset.maxFile);
                else el?.click();
              };
              if (!r || !el) {
                if (step.exec) press();
                continue;
              }
              // botão fora da tela: rola até ele antes de correr
              const box = el.getBoundingClientRect();
              if (box.top < 0 || box.bottom > window.innerHeight) {
                el.scrollIntoView({ block: 'center' });
                await wait(200);
              }
              await r.sprout();
              await r.punch(el, press);
              await wait(380); // a tela reage ao clique (abre a gaveta, começa o download)
            } else {
              // o código do setor já começa a baixar enquanto ela corre
              const sec = step.path.match(/^\/setor\/([a-z-]+)/);
              if (sec) preloadSector(sec[1]);
              for (const p of plan(step.path)) {
                let el = p.el();
                // a tela nova pode ainda estar carregando os botões
                for (const t0 = Date.now(); !el && p.to !== null && Date.now() - t0 < 3000; ) {
                  await wait(80);
                  el = p.el();
                }
                if (p.to === null) {
                  // passo de clique (abrir a aba certa antes do botão)
                  if (!el) continue;
                  if (r) {
                    await r.sprout();
                    await r.punch(el, () => el.click());
                  } else el.click();
                  await wait(320);
                  continue;
                }
                if (!r || !el) {
                  hit();
                  await push(p.to);
                  continue;
                }
                await r.sprout();
                let go: Promise<void> = Promise.resolve();
                const to = p.to;
                await r.punch(el, () => {
                  hit();
                  go = push(to);
                });
                await go;
              }
            }
          }
        } catch (e) {
          console.error('[max] corrida', e);
          hit();
        } finally {
          await r?.home().catch(() => undefined);
          document.documentElement.classList.remove('max-away');
        }
      });
      chain.current = job.catch(() => undefined);
      return job;
    };
    setRunner(run);
    return () => setRunner(null);
  }, [plan, push]);

  useEffect(() => () => document.documentElement.classList.remove('max-away'), []);

  return (
    <Ctx.Provider value={{ go }}>
      {children}
      <MaxRunner ref={runner} />
    </Ctx.Provider>
  );
}
