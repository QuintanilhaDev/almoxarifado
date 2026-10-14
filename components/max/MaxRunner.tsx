'use client';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { MaxOrb } from './MaxOrb';
import { MaxFace } from './MaxFace';
import { MaxCap } from './MaxCap';
import { MaxBody3D, type Rig } from './MaxBody3D';
import './max.css';

/**
 * A Max saindo do canto: ganha bracinhos e perninhas, corre até o botão,
 * dá um soquinho nele e volta para o lugar. O corpo e os membros são 3D (MaxBody3D);
 * aqui fica o esqueleto e a animação (rAF), sem bibliotecas.
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
  /** profundidade da ponta de cada membro (+ = para a frente, rumo à câmera) */
  zArmL: number;
  zArmR: number;
  zLegL: number;
  zLegR: number;
}
const STAND: Pose = { armL: [-24, -20], armR: [24, 20], legL: [-6, 2], legR: [6, -2], stretchL: 1, stretchR: 1, fistL: 1, fistR: 1, zArmL: 0.12, zArmR: 0.12, zLegL: 0.04, zLegR: 0.04 };
const NUM_KEYS = ['stretchL', 'stretchR', 'fistL', 'fistR', 'zArmL', 'zArmR', 'zLegL', 'zLegR'] as const;

export const MaxRunner = forwardRef<RunnerApi>(function MaxRunner(_, ref) {
  const [visible, setVisible] = useState(false);
  const [size, setSize] = useState(128);
  const wrap = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLSpanElement>(null);
  const [gl, setGl] = useState(true);
  // o corpo 3D é preparado com a página parada, para a primeira corrida não engasgar
  const [warm, setWarm] = useState(false);
  useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    const t = setTimeout(() => (w.requestIdleCallback ? w.requestIdleCallback(() => setWarm(true), { timeout: 3000 }) : setWarm(true)), 2500);
    return () => clearTimeout(t);
  }, []);
  const rig = useRef<Rig>({ j: new Float32Array(36), k: 0, fistL: 1, fistR: 1, dir: -1 });
  const fx = useRef<HTMLDivElement>(null);
  const st = useRef({ x: 0, y: 0, lean: 0, hop: 0, sx: 1, sy: 1, limbs: 0, dir: -1, phase: 0, pose: { ...STAND } as Pose, out: false, size: 128, yaw: 0 });

  /* ---------------- desenho ---------------- */
  const draw = () => {
    const s = st.current;
    const w = wrap.current;
    const b = body.current;
    if (!w || !b) return;
    const r = s.size * 0.237;
    w.style.transform = `translate3d(${s.x}px, ${s.y + s.hop}px, 0)`;
    b.style.transform = `translate(-50%, -50%) rotate(${s.lean}deg) scale(${s.sx}, ${s.sy})`;
    const k = s.limbs;
    const P = s.pose;
    const limb = (root: V, a1: number, a2: number, l1: number, l2: number) => {
      const j = add(root, dirOf(a1 * D2R), l1);
      const e = add(j, dirOf((a1 + a2) * D2R), l2);
      return { j, e };
    };
    // ombros e quadris ficam dentro da gelatina (os membros brotam de dentro dela)
    const shL = { x: -0.78 * r, y: 0.12 * r };
    const shR = { x: 0.78 * r, y: 0.12 * r };
    const hipL = { x: -0.38 * r, y: 0.78 * r };
    const hipR = { x: 0.38 * r, y: 0.78 * r };
    const A = 0.46 * r * k;
    const F = 0.42 * r * k;
    const L = 0.44 * r * k;
    const aL = limb(shL, P.armL[0], P.armL[1], A * P.stretchL, F * P.stretchL);
    const aR = limb(shR, P.armR[0], P.armR[1], A * P.stretchR, F * P.stretchR);
    const lL = limb(hipL, P.legL[0], P.legL[1], L, L);
    const lR = limb(hipR, P.legR[0], P.legR[1], L, L);
    // pixels → mundo 3D (raio do corpo = 0.6, y para cima) e giro do corpo para onde ela corre
    const W = 0.6 / r;
    const yaw = s.yaw * D2R;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const J = rig.current.j;
    let i = 0;
    const put = (v: V, z: number) => {
      const x = v.x * W;
      J[i++] = x * cy + z * sy;
      J[i++] = -v.y * W;
      J[i++] = -x * sy + z * cy;
    };
    const chain = (root: V, l: { j: V; e: V }, z0: number, z: number) => {
      put(root, z0);
      put(l.j, z0 + (z - z0) * 0.55 * k);
      put(l.e, z0 + (z - z0) * k);
    };
    chain(shL, aL, 0.14, P.zArmL);
    chain(shR, aR, 0.14, P.zArmR);
    chain(hipL, lL, 0.06, P.zLegL);
    chain(hipR, lR, 0.06, P.zLegR);
    rig.current.k = k;
    rig.current.fistL = P.fistL;
    rig.current.fistR = P.fistR;
    rig.current.dir = s.dir;
    // o rosto e o boné giram junto com o corpo
    const hd = head.current;
    if (hd) hd.style.transform = `translateX(${(sy * 0.42 * r).toFixed(2)}px) rotateY(${s.yaw.toFixed(2)}deg)`;
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
      // braços e pernas vão e vêm também em profundidade
      zArmL: 0.12 + 0.26 * Math.cos(ph),
      zArmR: 0.12 - 0.26 * Math.cos(ph),
      zLegL: 0.04 - 0.2 * Math.cos(ph),
      zLegR: 0.04 + 0.2 * Math.cos(ph),
    };
  };
  const mix = (a: Pose, b: Pose, t: number): Pose => {
    const m = (x: number, y: number) => x + (y - x) * t;
    const mm = (x: [number, number], y: [number, number]): [number, number] => [m(x[0], y[0]), m(x[1], y[1])];
    const out = { armL: mm(a.armL, b.armL), armR: mm(a.armR, b.armR), legL: mm(a.legL, b.legL), legR: mm(a.legR, b.legR) } as Pose;
    for (const key of NUM_KEYS) out[key] = m(a[key], b[key]);
    return out;
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
      s.lean = s.dir * 9 * Math.min(1, blend);
      s.yaw = s.dir * 32 * Math.min(1, blend);
      const sq = Math.cos(s.phase * 2) * 0.06 * blend;
      s.sx = 1 + sq;
      s.sy = 1 - sq;
      // poeirinha a cada passada
      const stepN = Math.floor(s.phase / Math.PI);
      if (stepN !== lastStep) {
        lastStep = stepN;
        dust(s.x - s.dir * 0.3 * r, s.y + 1.75 * r, s.dir);
      }
    });
    s.sx = 1;
    s.sy = 1;
    // freada: inclina para trás e assenta
    await animate(220, (t) => {
      s.lean = s.dir * 9 * (1 - t) - s.dir * 7 * Math.sin(t * Math.PI);
      s.yaw = s.dir * 32 * (1 - ease(t));
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
        s.pose = mix({ ...STAND, armL: [-150, -30], armR: [150, 30], zArmL: 0.3, zArmR: 0.3 }, STAND, Math.min(1, t * 1.4)); // "tchã!"
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
      const reach = 0.78 * r + 0.88 * r * 1.32 + 0.2 * r;
      const W = window.innerWidth;
      const H = window.innerHeight;
      const x = Math.max(r * 1.2, Math.min(W - r * 1.2, tx - dir * reach));
      const y = Math.max(r * 1.2, Math.min(H - r * 2.2, ty - 0.12 * r));
      await runTo(x, y);
      s.dir = dir;
      s.yaw = 0;
      const side = dir > 0 ? 'R' : 'L';
      const other = dir > 0 ? 'L' : 'R';
      const set = (p: Pose, armA: [number, number], stretch: number, fist: number, guard: [number, number], z: number, zGuard: number): Pose => ({
        ...p,
        [`arm${side}`]: armA,
        [`stretch${side}`]: stretch,
        [`fist${side}`]: fist,
        [`z${'Arm' + side}`]: z,
        [`arm${other}`]: guard,
        [`z${'Arm' + other}`]: zGuard,
      } as Pose);
      const base = { ...STAND };
      // prepara: o punho vai para trás (em profundidade) e a outra mão protege na frente
      const wind = set(base, [-dir * 40, dir * 118], 0.9, 1.15, [dir * 40, dir * 120], -0.34, 0.42);
      // a direção certa até o alvo (o braço aponta exatamente para o ponto do soco)
      const shoulder = { x: x + dir * 0.78 * r, y: y + 0.12 * r };
      const ang = Math.atan2(tx - shoulder.x, ty - shoulder.y) / D2R;
      const hit = set(base, [ang, 0], 1.32, 1.45, [dir * 30, dir * 125], 0.1, 0.36);
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
        s.pose = mix(STAND, { ...STAND, armL: [-160, 0], armR: [160, 0], zArmL: 0.3, zArmR: 0.3 }, e);
        s.yaw = 360 * e; // voltinha completa antes de sumir
      });
      spawn('mr-poof', s.x, s.y + 0.3 * r, 600);
      s.out = false;
      s.hop = 0;
      s.yaw = 0;
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
          {gl && (visible || warm) ? <MaxBody3D size={size} rig={rig} active={visible} onFail={() => setGl(false)} /> : null}
          {visible ? (
            gl ? (
              <>
                <span ref={head} className="max-orb is-speaking mr-head" style={{ width: size, height: size }}>
                  <MaxFace state="speaking" />
                  <MaxCap />
                </span>
              </>
            ) : (
              <MaxOrb size={size} state="speaking" />
            )
          ) : null}
        </div>
      </div>
    </>
  );
});
