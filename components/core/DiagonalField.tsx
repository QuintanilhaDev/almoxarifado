'use client';
import { useEffect, useRef } from 'react';

/**
 * Textura diagonal que reage ao mouse/toque: os traços próximos ao
 * cursor giram em direção a ele, crescem e ganham o tom lilás.
 */
export function DiagonalField() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let w = 0;
    let h = 0;
    let dpr = 1;
    let gap = 26;
    const pointer = { x: -9999, y: -9999, tx: -9999, ty: -9999, energy: 0, targetEnergy: 0 };
    let raf = 0;
    let t0 = performance.now();

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      gap = w < 640 ? 22 : 26;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const move = (x: number, y: number) => {
      pointer.tx = x;
      pointer.ty = y;
      if (pointer.x < -9000) {
        pointer.x = x;
        pointer.y = y;
      }
      pointer.targetEnergy = 1;
    };
    const onMouse = (e: PointerEvent) => move(e.clientX, e.clientY);
    const onTouch = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t) move(t.clientX, t.clientY);
    };
    const onLeave = () => {
      pointer.targetEnergy = 0;
    };

    const radius = () => Math.max(160, Math.min(w, h) * 0.28);
    const BASE = -Math.PI / 4; // diagonal "/"

    const draw = (now: number) => {
      const time = (now - t0) / 1000;
      pointer.x += (pointer.tx - pointer.x) * 0.14;
      pointer.y += (pointer.ty - pointer.y) * 0.14;
      pointer.energy += (pointer.targetEnergy - pointer.energy) * 0.06;

      ctx.clearRect(0, 0, w, h);
      const R = radius();
      const R2 = R * R;
      const half = gap * 0.32;
      ctx.lineCap = 'round';

      for (let y = -gap; y < h + gap; y += gap) {
        const row = Math.round(y / gap);
        const offset = row % 2 === 0 ? 0 : gap / 2;
        for (let x = -gap + offset; x < w + gap; x += gap) {
          const dx = x - pointer.x;
          const dy = y - pointer.y;
          const d2 = dx * dx + dy * dy;
          let f = 0;
          if (d2 < R2) {
            const d = Math.sqrt(d2);
            f = (1 - d / R) ** 2 * pointer.energy;
          }
          // ondulação lenta para a textura respirar mesmo parada
          const wave = reduce ? 0 : Math.sin(x * 0.012 + y * 0.008 + time * 0.8) * 0.12;
          let angle = BASE + wave;
          if (f > 0.001) {
            const toward = Math.atan2(dy, dx) + Math.PI / 2;
            let diff = toward - angle;
            diff = Math.atan2(Math.sin(diff), Math.cos(diff));
            angle += diff * f * 0.9;
          }
          const len = half * (1 + f * 1.6);
          const cx = Math.cos(angle) * len;
          const cy = Math.sin(angle) * len;

          const alpha = 0.07 + f * 0.75;
          if (f > 0.02) {
            // mistura branco -> lilás
            const r = Math.round(246 + (198 - 246) * f);
            const g = Math.round(244 + (168 - 244) * f);
            const b = Math.round(251 + (255 - 251) * f);
            ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
            ctx.lineWidth = 1.2 + f * 1.3;
          } else {
            ctx.strokeStyle = `rgba(246,244,251,${alpha})`;
            ctx.lineWidth = 1.2;
          }
          ctx.beginPath();
          ctx.moveTo(x - cx, y - cy);
          ctx.lineTo(x + cx, y + cy);
          ctx.stroke();
        }
      }

      // brilho suave seguindo o cursor
      if (pointer.energy > 0.01) {
        const g = ctx.createRadialGradient(pointer.x, pointer.y, 0, pointer.x, pointer.y, R * 1.3);
        g.addColorStop(0, `rgba(198,168,255,${0.1 * pointer.energy})`);
        g.addColorStop(1, 'rgba(198,168,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(pointer.x - R * 1.3, pointer.y - R * 1.3, R * 2.6, R * 2.6);
      }

      raf = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', onMouse, { passive: true });
    window.addEventListener('touchmove', onTouch, { passive: true });
    window.addEventListener('touchstart', onTouch, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    window.addEventListener('blur', onLeave);
    const onVis = () => {
      cancelAnimationFrame(raf);
      if (document.visibilityState === 'visible') {
        t0 = performance.now() - 1000;
        raf = requestAnimationFrame(draw);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onMouse);
      window.removeEventListener('touchmove', onTouch);
      window.removeEventListener('touchstart', onTouch);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('blur', onLeave);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  return <canvas ref={ref} className="field-canvas" aria-hidden />;
}
