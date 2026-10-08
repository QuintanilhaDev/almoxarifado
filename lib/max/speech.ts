'use client';

/**
 * Escuta por voz usando o reconhecimento do próprio navegador (Chrome, Edge e Safari),
 * sem custo e sem chave. Onde não existe (Firefox), a Max funciona por texto.
 */
export type ListenState = 'off' | 'starting' | 'on' | 'denied' | 'unsupported';

interface RecAlt {
  transcript: string;
  confidence: number;
}
interface RecResult {
  isFinal: boolean;
  length: number;
  [i: number]: RecAlt;
}
interface RecEvent {
  resultIndex: number;
  results: { length: number; [i: number]: RecResult };
}
interface Rec {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onresult: ((e: RecEvent) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

function recCtor(): (new () => Rec) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function listenSupported(): boolean {
  return recCtor() !== null;
}

export interface ListenerOptions {
  /** true = fica ouvindo sem parar (tela de login) · false = ouve um pedido e para */
  continuous: boolean;
  onState: (s: ListenState) => void;
  /** texto parcial, enquanto a pessoa ainda fala */
  onInterim?: (text: string) => void;
  /** frase concluída, com as alternativas que o navegador ouviu (da mais provável para a menos) */
  onFinal: (text: string, alternatives: string[]) => void;
  /** modo de um pedido só: terminou sem ouvir nada */
  onSilence?: () => void;
}

export class Listener {
  private rec: Rec | null = null;
  private wanted = false;
  private paused = false;
  private running = false;
  private gotFinal = false;
  private dead = false;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private lastFinal = { text: '', at: 0 };
  state: ListenState = 'off';

  constructor(private opts: ListenerOptions) {
    if (!listenSupported()) this.setState('unsupported');
  }

  private setState(s: ListenState) {
    if (this.state === s) return;
    this.state = s;
    this.opts.onState(s);
  }

  private build(): Rec | null {
    const C = recCtor();
    if (!C) return null;
    const rec = new C();
    rec.lang = 'pt-BR';
    rec.continuous = this.opts.continuous;
    rec.interimResults = true;
    rec.maxAlternatives = 4;
    rec.onstart = () => {
      if (this.rec !== rec) return;
      this.running = true;
      this.failures = 0;
      this.setState('on');
    };
    rec.onresult = (e) => {
      if (this.rec !== rec || this.paused) return;
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (!res || !res.length) continue;
        if (res.isFinal) {
          const alts: string[] = [];
          for (let k = 0; k < res.length; k++) {
            const t = (res[k]?.transcript || '').trim();
            if (t && !alts.includes(t)) alts.push(t);
          }
          if (!alts.length) continue;
          // o Chrome no Android repete a mesma frase final: ignora a cópia
          const now = Date.now();
          if (alts[0] === this.lastFinal.text && now - this.lastFinal.at < 1500) continue;
          this.lastFinal = { text: alts[0], at: now };
          this.gotFinal = true;
          this.opts.onFinal(alts[0], alts);
        } else {
          interim += res[0]?.transcript || '';
        }
      }
      if (interim.trim()) this.opts.onInterim?.(interim.trim());
    };
    rec.onerror = (e) => {
      if (this.rec !== rec) return;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.wanted = false;
        this.setState('denied');
      } else if (e.error === 'audio-capture' || e.error === 'network' || e.error === 'language-not-supported') {
        this.failures++;
      }
      // 'no-speech' e 'aborted' são normais: o onend decide o que fazer
    };
    rec.onend = () => {
      if (this.rec !== rec) return;
      this.running = false;
      this.rec = null;
      if (this.dead) return;
      if (this.state === 'denied') return;
      if (this.wanted && !this.paused && this.opts.continuous) {
        if (this.failures >= 6) {
          // microfone ou rede indisponíveis: para de insistir (um clique na Max tenta de novo)
          this.wanted = false;
          this.setState('off');
          return;
        }
        this.setState('starting');
        this.schedule(this.failures ? Math.min(8000, 600 * 2 ** this.failures) : 250);
        return;
      }
      // pausada (a Max está falando): continua "ligada" para quem vê
      if (this.paused) return;
      const silent = this.wanted && !this.gotFinal;
      this.wanted = false;
      this.setState('off');
      if (silent) this.opts.onSilence?.();
    };
    return rec;
  }

  private schedule(ms: number) {
    if (this.retry) clearTimeout(this.retry);
    this.retry = setTimeout(() => {
      this.retry = null;
      if (this.wanted && !this.paused && !this.dead) this.begin();
    }, ms);
  }

  private begin() {
    if (this.running || this.rec || this.dead) return;
    const rec = this.build();
    if (!rec) return this.setState('unsupported');
    this.rec = rec;
    this.gotFinal = false;
    this.setState('starting');
    // alguns navegadores aceitam o start() e nunca respondem: não fica "ligando" para sempre
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => {
      if (this.rec !== rec || this.running || this.dead) return;
      this.rec = null;
      try {
        rec.abort();
      } catch {
        /* ignore */
      }
      this.wanted = false;
      this.setState('off');
      this.opts.onSilence?.();
    }, 6000);
    try {
      rec.start();
    } catch {
      // já havia uma escuta ativa neste navegador: tenta de novo em instantes
      this.rec = null;
      this.failures++;
      if (this.failures < 6) this.schedule(700);
      else {
        this.wanted = false;
        this.setState('off');
      }
    }
  }

  /** Começa a ouvir (no modo de um pedido, ouve uma frase e para sozinha). */
  start() {
    if (this.dead || !listenSupported()) return;
    this.wanted = true;
    this.paused = false;
    this.failures = 0;
    if (this.state === 'denied') this.state = 'off'; // nova tentativa a pedido da pessoa
    this.begin();
  }

  /** Para de ouvir. */
  stop() {
    this.wanted = false;
    this.paused = false;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    const rec = this.rec;
    if (rec) {
      try {
        rec.abort();
      } catch {
        /* ignore */
      }
    } else if (this.state !== 'denied' && this.state !== 'unsupported') this.setState('off');
  }

  /** Pausa enquanto a Max fala (para ela não ouvir a própria voz). */
  pause() {
    if (!this.wanted || this.paused) return;
    this.paused = true;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    try {
      this.rec?.abort();
    } catch {
      /* ignore */
    }
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    if (this.wanted && !this.dead) this.schedule(350);
  }

  get active() {
    return this.wanted;
  }

  destroy() {
    this.dead = true;
    if (this.watchdog) clearTimeout(this.watchdog);
    this.wanted = false;
    if (this.retry) clearTimeout(this.retry);
    try {
      this.rec?.abort();
    } catch {
      /* ignore */
    }
    this.rec = null;
  }
}
