'use client';

let ctx: AudioContext | null = null;

/** Dois toques curtos e suaves para avisar de uma nova solicitação. */
export function chime() {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = ctx || new AC();
    if (ctx.state === 'suspended') ctx.resume().catch(() => undefined);
    const now = ctx.currentTime;
    [
      [880, 0],
      [1318.5, 0.12],
    ].forEach(([freq, delay]) => {
      const o = ctx!.createOscillator();
      const g = ctx!.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, now + delay);
      g.gain.linearRampToValueAtTime(0.12, now + delay + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.5);
      o.connect(g).connect(ctx!.destination);
      o.start(now + delay);
      o.stop(now + delay + 0.55);
    });
  } catch {
    /* sem áudio */
  }
}
