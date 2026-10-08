'use client';

let ctx: AudioContext | null = null;

function tone(freqs: [number, number][], gain = 0.07, type: OscillatorType = 'sine') {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = ctx || new AC();
    if (ctx.state === 'suspended') ctx.resume().catch(() => undefined);
    if (ctx.state !== 'running') return; // sem clique na página ainda: fica em silêncio
    const now = ctx.currentTime;
    for (const [freq, delay] of freqs) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, now + delay);
      g.gain.linearRampToValueAtTime(gain, now + delay + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.22);
      o.connect(g).connect(ctx.destination);
      o.start(now + delay);
      o.stop(now + delay + 0.25);
    }
  } catch {
    /* sem áudio */
  }
}

/** Sons curtos da Max: começou a ouvir, entendeu, não entendeu. */
export const sfx = {
  listen: () => tone([[660, 0], [990, 0.09]]),
  heard: () => tone([[990, 0], [1320, 0.07]], 0.05),
  off: () => tone([[520, 0], [390, 0.09]], 0.05),
};
