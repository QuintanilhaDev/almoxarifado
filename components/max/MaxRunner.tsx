'use client';
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { MaxOrb } from './MaxOrb';

/**
 * A Max saindo do canto: ganha bracinhos e perninhas, corre até o botão,
 * dá um soquinho nele e volta para o lugar. Tudo animado à mão (rAF), sem bibliotecas.
 *
 * Unidades do esqueleto: r = raio do corpo em pixels. Origem no centro do corpo, y para baixo.
 */
export interface RunnerApi {
  /** sai do botão da Max (ganha membros com um pulinho) */
  sprout: () => Promise<void>;
  /** corre até o ponto onde o soco alcança o alvo e soca. Devolve depois do impacto. */
  punch: (target: Element, onHit: () => void) => Promise<void>;
  /** volta para o botão da Max e some */
  home: () => Promise<void>;
  /** está fora do canto? */
  out: () => boolean;
}

type V = { x: number; y: number };
const D2R = Math.PI / 180;
const dirOf = (a: number): V => ({ x: Math.sin(a), y: Math.cos(a) });
const add = (a: V, b: V, k = 1): V => ({ x: a.x + b.x * k, y: a.y + b.y * k });
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const back = (t: number) => {
  const c = 1.9;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
};
const frame = () => new Promise<number>((r) => requestAnimationFrame(r));

/** onde está o botão da Max agora (centro e tamanho da esfera) */
function homeRect(): { x: number; y: number; size: number } {
  const orb = document.querySelector('.max-fab .max-orb') as HTMLElement | null;
  const fab = document.querySelector('.max-fab') as HTMLElement | null;
  const el = orb ?? fab;
  if (el) {
    const r = el.getBoundingClientRect();
    if (r.width) return { x: r.left + r.width / 2, y: r.top + r.height / 2, size: orb ? r.width : r.width * 1.9 };
  }
  return { x: window.innerWidth - 52, y: window.innerHeight - 52, size: 128 };
}

interface Pose {
  /** ângulo de cada membro (graus, 0 = para baixo, + gira para a direita da tela) */
  armL: [number, number];
  armR: [number, number];
  legL: [number, number];
  legR: [number, number];
  /** esticada do braço que soca (1 = normal) */
  stretchL: number;
  stretchR: number;
  fistL: number;
  fistR: number;
}
const STAND: Pose = { armL: [-22, -18], armR: [22, 18], legL: [-6, 0], legR: [6, 0], stretchL: 1, stretchR: 1, fistL: 1, fistR: 1 };

export const MaxRunner = forwardRef<RunnerApi>(function MaxRunner(_, ref) {
  const [visible, setVisible] = useState(false);
  const [size, setSize] = useState(128);
  const wrap = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const fx = useRef<HTMLDivElement>(null);
  const st = useRef({ x: 0, y: 0, lean: 0, hop: 0, sx: 1, sy: 1, limbs: 0, dir: -1, phase: 0, pose: { ...STAND } as Pose, out: false, size: 128 });

  /* ---------------- desenho ---------------- */
  const draw = () => {
    const s = st.current;
    const w = wrap.current;
    const b = body.current;
    const g = svg.current;
    if (!w || !b || !g) return;
    const r = s.size * 0.237;
    w.style.transform = `translate3d(${s.x}px, ${s.y + s.hop}px, 0)`;
    b.style.transform = `translate(-50%, -50%) rotate(${s.lean}deg) scale(${s.sx}, ${s.sy})`;
    const k = s.limbs;
    const P = s.pose;
    const set = (sel: string, attrs: Record<string, string | number>) => {
      const el = g.querySelector(sel);
      if (el) for (const [a, v] of Object.entries(attrs)) el.setAttribute(a, String(v));
    };
    const limb = (root: V, a1: number, a2: number, l1: number, l2: number) => {
      const j = add(root, dirOf(a1 * D2R), l1);
      const e = add(j, dirOf((a1 + a2) * D2R), l2);
      return { j, e };
    };
    // ombros e quadris (saem de dentro do corpo, por isso ficam atrás da esfera)
    const shL = { x: -0.78 * r, y: 0.12 * r };
    const shR = { x: 0.78 * r, y: 0.12 * r };
    const hipL = { x: -0.38 * r, y: 0.78 * r };
    const hipR = { x: 0.38 * r, y: 0.78 * r };
    const A = 0.62 * r * k;
    const F = 0.56 * r * k;
    const L = 0.6 * r * k;
    const aL = limb(shL, P.armL[0], P.armL[1], A * P.stretchL, F * P.stretchL);
    const aR = limb(shR, P.armR[0], P.armR[1], A * P.stretchR, F * P.stretchR);
    const lL = limb(hipL, P.legL[0], P.legL[1], L, L);
    const lR = limb(hipR, P.legR[0], P.legR[1], L, L);
    const path = (root: V, l: { j: V; e: V }) => `M${root.x.toFixed(1)} ${root.y.toFixed(1)} Q${l.j.x.toFixed(1)} ${l.j.y.toFixed(1)} ${l.e.x.toFixed(1)} ${l.e.y.toFixed(1)}`;
    const thick = Math.max(2, 0.2 * r * Math.min(1, k * 1.4));
    for (const [n, root, l, w] of [['arm-l', shL, aL, thick], ['arm-r', shR, aR, thick], ['leg-l', hipL, lL, thick * 1.1], ['leg-r', hipR, lR, thick * 1.1]] as const) {
      set(`.mr-${n}`, { d: path(root, l), 'stroke-width': w });
      set(`.mr-o-${n}`, { d: path(root, l), 'stroke-width': w + 2.4 });
    }
    const glove = 0.21 * r * k;
    set('.mr-fist-l', { cx: aL.e.x, cy: aL.e.y, r: glove * P.fistL });
    set('.mr-fist-r', { cx: aR.e.x, cy: aR.e.y, r: glove * P.fistR });
    set('.mr-cuff-l', { cx: aL.j.x * 0.15 + aL.e.x * 0.85, cy: aL.j.y * 0.15 + aL.e.y * 0.85, r: glove * 0.62 * P.fistL });
    set('.mr-cuff-r', { cx: aR.j.x * 0.15 + aR.e.x * 0.85, cy: aR.j.y * 0.15 + aR.e.y * 0.85, r: glove * 0.62 * P.fistR });
    // tênis: apontam para onde ela corre
    const shoe = (sel: string, foot: V, a: number) => {
      const sc = (k * r * 1.3) / 30;
      set(sel, { transform: `translate(${foot.x.toFixed(1)} ${(foot.y + 0.03 * r).toFixed(1)}) scale(${(s.dir * sc).toFixed(3)} ${sc.toFixed(3)}) rotate(${(-a * s.dir * 0.3).toFixed(1)})` });
    };
    shoe('.mr-shoe-l', lL.e, P.legL[0] + P.legL[1]);
    shoe('.mr-shoe-r', lR.e, P.legR[0] + P.legR[1]);
    g.style.opacity = k > 0.02 ? '1' : '0';
  };

  /* ---------------- poses ---------------- */
  /** ciclo de corrida (fase em radianos) */
  const runPose = (ph: number, dir: number): Pose => {
    const sw = Math.sin(ph);
    const swB = Math.sin(ph + Math.PI);
    const knee = (x: number) => -dir * (12 + 62 * Math.max(0, Math.sin(x + Math.PI / 2)));
    return {
      legL: [dir * 40 * sw, knee(ph)],
      legR: [dir * 40 * swB, knee(ph + Math.PI)],
      armL: [-18 + dir * 48 * swB, dir * 78],
      armR: [18 + dir * 48 * sw, dir * 78],
      stretchL: 1,
      stretchR: 1,
      fistL: 1,
      fistR: 1,
    };
  };
  const mix = (a: Pose, b: Pose, t: number): Pose => {
    const m = (x: number, y: number) => x + (y - x) * t;
    const mm = (x: [number, number], y: [number, number]): [number, number] => [m(x[0], y[0]), m(x[1], y[1])];
    return { armL: mm(a.armL, b.armL), armR: mm(a.armR, b.armR), legL: mm(a.legL, b.legL), legR: mm(a.legR, b.legR), stretchL: m(a.stretchL, b.stretchL), stretchR: m(a.stretchR, b.stretchR), fistL: m(a.fistL, b.fistL), fistR: m(a.fistR, b.fistR) };
  };

  /** anima por `ms`, chamando `step(t 0..1, dt)` a cada quadro */
  const animate = async (ms: number, step: (t: number, dt: number) => void) => {
    const t0 = performance.now();
    let last = t0;
    for (;;) {
      const now = await frame();
      const t = Math.min(1, (now - t0) / ms);
      step(t, Math.min(48, now - last));
      last = now;
      draw();
      if (t >= 1) break;
    }
  };

  /* ---------------- efeitos ---------------- */
  const spawn = (cls: string, x: number, y: number, ms: number, extra?: (el: HTMLElement) => void) => {
    const host = fx.current;
    if (!host) return;
    const el = document.createElement('div');
    el.className = cls;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    extra?.(el);
    host.appendChild(el);
    setTimeout(() => el.remove(), ms);
  };
  const dust = (x: number, y: number, dir: number) =>
    spawn('mr-dust', x, y, 620, (el) => {
      el.style.setProperty('--dx', `${-dir * (10 + Math.random() * 14)}px`);
      el.style.setProperty('--s', `${0.7 + Math.random() * 0.6}`);
    });
  const burst = (x: number, y: number, dir: number) => {
    spawn('mr-pow', x, y, 700, (el) => el.style.setProperty('--dir', String(dir)));
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + Math.random() * 0.4;
      spawn('mr-spark', x, y, 650, (el) => {
        el.style.setProperty('--tx', `${Math.cos(a) * (26 + Math.random() * 22)}px`);
        el.style.setProperty('--ty', `${Math.sin(a) * (26 + Math.random() * 22)}px`);
        el.style.setProperty('--h', i % 3 === 0 ? '#ffd166' : i % 3 === 1 ? '#c6a8ff' : '#ffffff');
      });
    }
  };

  /* ---------------- movimentos ---------------- */
  const cls = (on: string[], off: string[] = []) => {
    const w = wrap.current;
    if (!w) return;
    on.forEach((c) => w.classList.add(c));
    off.forEach((c) => w.classList.remove(c));
  };

  /** corre do ponto atual até (x, y) */
  const runTo = async (x: number, y: number) => {
    const s = st.current;
    const r = s.size * 0.237;
    const from = { x: s.x, y: s.y };
    const dist = Math.hypot(x - from.x, y - from.y);
    if (dist < 4) return;
    s.dir = x >= from.x ? 1 : -1;
    const ms = Math.max(420, Math.min(1500, dist / 0.95));
    const stride = 1.5 * r;
    let lastStep = 0;
    cls(['is-running']);
    await animate(ms, (t) => {
      const e = ease(t);
      s.x = from.x + (x - from.x) * e;
      s.y = from.y + (y - from.y) * e;
      const travelled = dist * e;
      s.phase = (travelled / stride) * Math.PI;
      // começa e termina devagar: a pose entra e sai do ciclo de corrida
      const blend = Math.min(1, t * 5, (1 - t) * 6 + 0.25);
      s.pose = mix(STAND, runPose(s.phase, s.dir), Math.min(1, blend));
      s.hop = -Math.abs(Math.sin(s.phase)) * 0.32 * r * Math.min(1, blend);
      s.lean = s.dir * 11 * Math.min(1, blend);
      const sq = Math.cos(s.phase * 2) * 0.06 * blend;
      s.sx = 1 + sq;
      s.sy = 1 - sq;
      // poeirinha a cada passada
      const stepN = Math.floor(s.phase / Math.PI);
      if (stepN !== lastStep) {
        lastStep = stepN;
        dust(s.x - s.dir * 0.3 * r, s.y + 1.95 * r, s.dir);
      }
    });
    s.sx = 1;
    s.sy = 1;
    // freada: inclina para trás e assenta
    await animate(220, (t) => {
      s.lean = s.dir * 11 * (1 - t) - s.dir * 7 * Math.sin(t * Math.PI);
      s.hop = 0;
      s.pose = mix(s.pose, STAND, t);
    });
    cls([], ['is-running']);
  };

  const api: RunnerApi = {
    out: () => st.current.out,
    sprout: async () => {
      const s = st.current;
      if (s.out) return;
      const h = homeRect();
      s.size = Math.round(h.size);
      setSize(s.size);
      s.x = h.x;
      s.y = h.y;
      s.dir = -1;
      s.limbs = 0;
      s.pose = { ...STAND };
      s.out = true;
      setVisible(true);
      document.documentElement.classList.add('max-away');
      await frame();
      await frame();
      draw();
      const r = s.size * 0.237;
      cls(['is-sprout']);
      // agacha, pula e os membros brotam no ar
      await animate(170, (t) => {
        s.sx = 1 + 0.16 * t;
        s.sy = 1 - 0.18 * t;
      });
      spawn('mr-poof', s.x, s.y + 0.3 * r, 700);
      await animate(520, (t) => {
        s.sx = 1.16 - 0.16 * back(t);
        s.sy = 0.82 + 0.18 * back(t);
        s.hop = -Math.sin(t * Math.PI) * 1.1 * r;
        s.limbs = Math.max(0, back(Math.min(1, t * 1.25)));
        s.pose = mix({ ...STAND, armL: [-150, -30], armR: [150, 30] }, STAND, Math.min(1, t * 1.4)); // "tchã!"
      });
      s.limbs = 1;
      s.hop = 0;
      await animate(160, (t) => {
        s.sy = 1 - 0.1 * Math.sin(t * Math.PI);
        s.sx = 1 + 0.08 * Math.sin(t * Math.PI);
      });
      cls([], ['is-sprout']);
    },
    punch: async (target, onHit) => {
      const s = st.current;
      const r = s.size * 0.237;
      const box = target.getBoundingClientRect();
      // soca pelo lado de onde ela vem; o punho encosta na borda do botão
      const fromRight = s.x >= box.left + box.width / 2;
      const dir = fromRight ? -1 : 1;
      const tx = fromRight ? Math.min(box.right - 10, box.left + box.width * 0.75) : Math.max(box.left + 10, box.left + box.width * 0.25);
      const ty = box.top + box.height / 2;
      const reach = 0.78 * r + 1.18 * r * 1.32;
      const W = window.innerWidth;
      const H = window.innerHeight;
      const x = Math.max(r * 1.2, Math.min(W - r * 1.2, tx - dir * reach));
      const y = Math.max(r * 1.2, Math.min(H - r * 2.2, ty - 0.12 * r));
      await runTo(x, y);
      s.dir = dir;
      const side = dir > 0 ? 'R' : 'L';
      const other = dir > 0 ? 'L' : 'R';
      const set = (p: Pose, armA: [number, number], stretch: number, fist: number, guard: [number, number]): Pose => ({
        ...p,
        [`arm${side}`]: armA,
        [`stretch${side}`]: stretch,
        [`fist${side}`]: fist,
        [`arm${other}`]: guard,
      } as Pose);
      const base = { ...STAND };
      const wind = set(base, [-dir * 40, dir * 118], 0.9, 1.15, [dir * 40, dir * 120]);
      // a direção certa até o alvo (o braço aponta exatamente para o ponto do soco)
      const shoulder = { x: x + dir * 0.78 * r, y: y + 0.12 * r };
      const ang = Math.atan2(tx - shoulder.x, ty - shoulder.y) / D2R;
      const hit = set(base, [ang, 0], 1.32, 1.45, [dir * 30, dir * 125]);
      cls(['is-windup']);
      await animate(190, (t) => {
        const e = ease(t);
        s.pose = mix(base, wind, e);
        s.lean = -dir * 9 * e;
        s.sx = 1 - 0.05 * e;
        s.sy = 1 + 0.05 * e;
      });
      cls(['is-punch'], ['is-windup']);
      await animate(95, (t) => {
        s.pose = mix(wind, hit, t);
        s.lean = -dir * 9 + dir * 22 * t;
        s.sx = 1 + 0.08 * t;
        s.sy = 1 - 0.07 * t;
      });
      // impacto!
      target.classList.remove('max-hit');
      void (target as HTMLElement).offsetWidth;
      target.classList.add('max-hit');
      (target as HTMLElement).style.setProperty('--hit-dir', String(dir));
      setTimeout(() => target.classList.remove('max-hit'), 520);
      burst(tx, ty, dir);
      onHit();
      await animate(170, (t) => {
        s.x = x - dir * 4 * Math.sin(t * Math.PI); // recuo do soco
      });
      await animate(260, (t) => {
        const e = ease(t);
        s.pose = mix(hit, STAND, e);
        s.lean = dir * 13 * (1 - e);
        s.sx = 1 + 0.08 * (1 - e);
        s.sy = 1 - 0.07 * (1 - e);
      });
      cls([], ['is-punch']);
    },
    home: async () => {
      const s = st.current;
      if (!s.out) return;
      const h = homeRect();
      await runTo(h.x, h.y);
      // os membros recolhem com uma voltinha
      const r = s.size * 0.237;
      await animate(380, (t) => {
        const e = ease(t);
        s.limbs = 1 - e;
        s.hop = -Math.sin(t * Math.PI) * 0.6 * r;
        s.pose = mix(STAND, { ...STAND, armL: [-160, 0], armR: [160, 0] }, e);
      });
      spawn('mr-poof', s.x, s.y + 0.3 * r, 600);
      s.out = false;
      s.hop = 0;
      document.documentElement.classList.remove('max-away');
      setVisible(false);
    },
  };
  useImperativeHandle(ref, () => api);

  return (
    <>
      <div className="mr-fx" ref={fx} aria-hidden />
      <div className={`mr${visible ? ' is-on' : ''}`} ref={wrap} aria-hidden>
        <div className="mr-body" ref={body} style={{ width: size, height: size }}>
          <svg className="mr-limbs" ref={svg} viewBox={`${-size} ${-size} ${size * 2} ${size * 2}`} style={{ width: size * 2, height: size * 2, left: -size / 2, top: -size / 2 }}>
            <defs>
              <linearGradient id="mr-skin" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#b392ff" />
                <stop offset="100%" stopColor="#6a42d1" />
              </linearGradient>
              <radialGradient id="mr-glove" cx="35%" cy="30%" r="75%">
                <stop offset="0%" stopColor="#ffffff" />
                <stop offset="70%" stopColor="#ece6f8" />
                <stop offset="100%" stopColor="#b8acd2" />
              </radialGradient>
            </defs>
            <path className="mr-out mr-o-leg-l" />
            <path className="mr-out mr-o-leg-r" />
            <path className="mr-leg mr-leg-l" />
            <path className="mr-leg mr-leg-r" />
            <g className="mr-shoe mr-shoe-l">
              <path d="M-6.5 -2.5 C-6.5 -8.5 3 -9.5 8.5 -4.5 C12.5 -1.5 12.5 3 8.5 4 L-6.5 4 Z" fill="#f6f2ff" stroke="#2b1656" strokeWidth="1.3" strokeLinejoin="round" />
              <path d="M-7.5 3.2 L10 3.2 C11.6 3.2 11.6 6.6 9.6 6.6 L-7.5 6.6 C-8.6 6.6 -8.6 3.2 -7.5 3.2 Z" fill="#8b62ea" stroke="#2b1656" strokeWidth="1.1" />
              <path d="M-3 -5.5 L0.5 -1.5 M0.5 -7 L4 -3" stroke="#7a52dd" strokeWidth="1.3" strokeLinecap="round" />
              <path d="M-5 -1 C-1 -3 3 -2 6 0" fill="none" stroke="#c6a8ff" strokeWidth="1.1" strokeLinecap="round" />
            </g>
            <g className="mr-shoe mr-shoe-r">
              <path d="M-6.5 -2.5 C-6.5 -8.5 3 -9.5 8.5 -4.5 C12.5 -1.5 12.5 3 8.5 4 L-6.5 4 Z" fill="#f6f2ff" stroke="#2b1656" strokeWidth="1.3" strokeLinejoin="round" />
              <path d="M-7.5 3.2 L10 3.2 C11.6 3.2 11.6 6.6 9.6 6.6 L-7.5 6.6 C-8.6 6.6 -8.6 3.2 -7.5 3.2 Z" fill="#8b62ea" stroke="#2b1656" strokeWidth="1.1" />
              <path d="M-3 -5.5 L0.5 -1.5 M0.5 -7 L4 -3" stroke="#7a52dd" strokeWidth="1.3" strokeLinecap="round" />
              <path d="M-5 -1 C-1 -3 3 -2 6 0" fill="none" stroke="#c6a8ff" strokeWidth="1.1" strokeLinecap="round" />
            </g>
            <path className="mr-out mr-o-arm-l" />
            <path className="mr-out mr-o-arm-r" />
            <path className="mr-arm mr-arm-l" />
            <path className="mr-arm mr-arm-r" />
            <circle className="mr-cuff mr-cuff-l" />
            <circle className="mr-cuff mr-cuff-r" />
            <circle className="mr-fist mr-fist-l" />
            <circle className="mr-fist mr-fist-r" />
          </svg>
          {visible ? <MaxOrb size={size} state="speaking" /> : null}
        </div>
      </div>
    </>
  );
});
