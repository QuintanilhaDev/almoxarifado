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

export type ListenTrouble = 'network' | 'mic';

export interface ListenerOptions {
  /**
   * 'always' = fica ouvindo sem parar (tela de login)
   * 'once'   = ouve até a pessoa falar um pedido (ou a janela de espera acabar)
   */
  mode: 'always' | 'once';
  onState: (s: ListenState) => void;
  /** texto parcial, enquanto a pessoa ainda fala */
  onInterim?: (text: string) => void;
  /** frase concluída, com as alternativas que o navegador ouviu (da mais provável para a menos) */
  onFinal: (text: string, alternatives: string[]) => void;
  /** modo 'once': a janela de espera acabou sem ninguém falar */
  onSilence?: () => void;
  /** o navegador não está conseguindo ouvir (serviço de voz bloqueado, microfone ausente…) */
  onTrouble?: (kind: ListenTrouble) => void;
}

/**
 * O reconhecimento do navegador encerra a sessão sozinho o tempo todo (alguns segundos de
 * silêncio, um ruído, a cada frase…). Isso é normal. Esta classe religa em silêncio e só
 * avisa a tela quando o estado muda DE VERDADE: assim nada fica "ligando e desligando".
 */
export class Listener {
  private rec: Rec | null = null;
  private wanted = false;
  private paused = false;
  private running = false;
  private dead = false;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private troubleTold = false;
  private deadline = 0;
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

  private clearTimers() {
    if (this.retry) clearTimeout(this.retry);
    if (this.watchdog) clearTimeout(this.watchdog);
    this.retry = null;
    this.watchdog = null;
  }

  private trouble(kind: ListenTrouble) {
    if (this.troubleTold) return;
    this.troubleTold = true;
    this.opts.onTrouble?.(kind);
  }

  /** Desiste (modo 'once') ou continua tentando com calma (modo 'always'). */
  private afterEnd() {
    if (this.dead || this.state === 'denied' || this.paused) return;
    if (!this.wanted) return this.setState('off');
    if (this.opts.mode === 'once') {
      const expired = Date.now() >= this.deadline;
      if (expired || this.failures >= 3) {
        this.wanted = false;
        this.setState('off');
        if (this.failures < 3) this.opts.onSilence?.();
        return;
      }
    }
    // religa sem mudar o estado visível
    const wait = this.failures ? Math.min(15000, 500 * 2 ** Math.min(this.failures, 5)) : 120;
    this.schedule(wait);
  }

  private build(): Rec | null {
    const C = recCtor();
    if (!C) return null;
    const rec = new C();
    rec.lang = 'pt-BR';
    // contínuo: não encerra na primeira pausa de quem fala
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 4;
    rec.onstart = () => {
      if (this.rec !== rec) return;
      this.running = true;
      if (this.watchdog) clearTimeout(this.watchdog);
      this.watchdog = null;
    };
    rec.onresult = (e) => {
      if (this.rec !== rec || this.paused || !this.wanted) return;
      this.failures = 0;
      this.troubleTold = false;
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
          if (this.opts.mode === 'once') {
            // pedido ouvido: encerra esta escuta
            this.wanted = false;
            this.clearTimers();
            try {
              rec.abort();
            } catch {
              /* ignore */
            }
            this.opts.onFinal(alts[0], alts);
            return;
          }
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
      } else if (e.error === 'network' || e.error === 'language-not-supported') {
        this.failures++;
        if (this.failures >= 2) this.trouble('network');
      } else if (e.error === 'audio-capture') {
        this.failures++;
        this.trouble('mic');
      } else if (e.error === 'no-speech') {
        this.failures = 0; // silêncio é normal: o serviço está funcionando
      }
    };
    rec.onend = () => {
      if (this.rec !== rec) return;
      this.running = false;
      this.rec = null;
      if (this.watchdog) clearTimeout(this.watchdog);
      this.watchdog = null;
      this.afterEnd();
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
    // alguns navegadores aceitam o start() e nunca respondem
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => {
      this.watchdog = null;
      if (this.rec !== rec || this.running || this.dead) return;
      this.rec = null;
      try {
        rec.abort();
      } catch {
        /* ignore */
      }
      this.failures++;
      if (this.failures >= 2) this.trouble('network');
      this.afterEnd();
    }, 6000);
    try {
      rec.start();
    } catch {
      // ainda havia uma sessão encerrando neste navegador: tenta de novo em instantes
      this.rec = null;
      if (this.watchdog) clearTimeout(this.watchdog);
      this.watchdog = null;
      this.schedule(400);
    }
  }

  /**
   * Começa a ouvir. No modo 'once', `windowMs` é quanto tempo ela espera alguém falar.
   */
  start(windowMs = 12000) {
    if (this.dead || !listenSupported()) return;
    this.wanted = true;
    this.paused = false;
    this.failures = 0;
    this.troubleTold = false;
    this.deadline = Date.now() + windowMs;
    this.state = this.state === 'on' ? 'on' : 'off';
    this.setState('on');
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.begin();
  }

  /** Para de ouvir. */
  stop() {
    this.wanted = false;
    this.paused = false;
    this.clearTimers();
    const rec = this.rec;
    if (rec) {
      try {
        rec.abort();
      } catch {
        /* ignore */
      }
    }
    if (this.state !== 'denied' && this.state !== 'unsupported') this.setState('off');
  }

  /** Pausa enquanto a Max fala (para ela não ouvir a própria voz). Para a tela, continua ligada. */
  pause() {
    if (!this.wanted || this.paused) return;
    this.paused = true;
    this.clearTimers();
    try {
      this.rec?.abort();
    } catch {
      /* ignore */
    }
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    if (this.wanted && !this.dead) this.schedule(300);
  }

  get active() {
    return this.wanted;
  }

  destroy() {
    this.dead = true;
    this.wanted = false;
    this.clearTimers();
    try {
      this.rec?.abort();
    } catch {
      /* ignore */
    }
    this.rec = null;
  }
}
