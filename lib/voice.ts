'use client';

/**
 * Escolhe a voz mais natural disponível no navegador.
 * Edge: "Microsoft Francisca/Thalita Online (Natural)" · Chrome: "Google português do Brasil"
 * Safari/iOS: vozes "Premium/Enhanced/Aprimorada" (Luciana etc.) · Android: vozes de rede do Google.
 */
const FEMALE =
  /\b(maria|francisca|thalita|luciana|fernanda|camila|vit[oó]ria|let[ií]cia|brenda|elza|manuela|yara|heloisa|helo[ií]sa|leila|giovanna|leticia|raquel|joana|catarina|female|feminin|mulher)\b/;
const MALE =
  /\b(daniel|ricardo|ant[oô]nio|donato|f[aá]bio|humberto|j[uú]lio|nicolau|val[eé]rio|felipe|eduardo|thiago|duarte|cristiano|jo[aã]o|male|masculin|homem)\b/;

function scoreVoice(v: SpeechSynthesisVoice): number {
  const name = v.name.toLowerCase();
  const lang = v.lang.toLowerCase().replace('_', '-');
  let s = 0;
  if (lang === 'pt-br') s += 1000;
  else if (lang.startsWith('pt')) s += 600;
  else return -1;

  if (/natural|neural|online/.test(name)) s += 300;
  if (/premium|enhanced|aprimorad|siri|wavenet|studio/.test(name)) s += 250;
  if (/francisca|thalita/.test(name)) s += 120;
  if (/google/.test(name)) s += 150;
  // Preferência forte por vozes femininas
  if (FEMALE.test(name)) s += 400;
  if (MALE.test(name)) s -= 800;
  if (!v.localService) s += 40; // vozes da nuvem costumam ser bem mais humanas
  if (/compact|espeak|robot|novelty|eloquence|grandma|grandpa|rocko|shelley|flo|reed|sandy/.test(name)) s -= 500;
  if (v.default) s += 5;
  return s;
}

export function loadVoices(timeoutMs = 2500): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return resolve([]);
    const synth = window.speechSynthesis;
    const now = synth.getVoices();
    if (now.length) return resolve(now);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      synth.removeEventListener?.('voiceschanged', finish);
      resolve(synth.getVoices());
    };
    synth.addEventListener?.('voiceschanged', finish);
    setTimeout(finish, timeoutMs);
  });
}

export function pickBestVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  let best: SpeechSynthesisVoice | null = null;
  let bestScore = -1;
  for (const v of voices) {
    const sc = scoreVoice(v);
    if (sc > bestScore) {
      bestScore = sc;
      best = v;
    }
  }
  return bestScore >= 0 ? best : null;
}

/** Quebra um texto longo em frases: o Chrome corta falas com mais de ~15 s. */
function chunks(text: string): string[] {
  const parts = text
    .replace(/\s+/g, ' ')
    .trim()
    .match(/[^.!?;:]+[.!?;:]*\s*/g);
  if (!parts) return [];
  const out: string[] = [];
  let cur = '';
  for (const p of parts) {
    if (cur && (cur + p).length > 180) {
      out.push(cur.trim());
      cur = p;
    } else cur += p;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export interface SpeakHandlers {
  onStart?: () => void;
  /** chamado uma única vez, quando a fala termina, é cancelada ou falha */
  onEnd?: (result: 'done' | 'blocked' | 'error' | 'cancelled') => void;
}

let speakSeq = 0;

export function voiceSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

/** Interrompe o que estiver sendo falado. */
export function stopSpeaking() {
  speakSeq++;
  if (voiceSupported()) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Fala o texto com a voz mais natural disponível. Sempre chama `onEnd` (mesmo quando o
 * navegador bloqueia a voz por ainda não ter havido um clique na página).
 */
export async function speak(text: string, handlers: SpeakHandlers = {}) {
  const my = ++speakSeq;
  let ended = false;
  let guard: ReturnType<typeof setTimeout> | undefined;
  const end = (r: 'done' | 'blocked' | 'error' | 'cancelled') => {
    if (ended) return;
    ended = true;
    if (guard) clearTimeout(guard);
    handlers.onEnd?.(r);
  };
  const parts = chunks(text);
  if (!voiceSupported() || !parts.length) return end(parts.length ? 'error' : 'done');
  try {
    const synth = window.speechSynthesis;
    const voice = pickBestVoice(await loadVoices());
    if (my !== speakSeq) return end('cancelled');
    synth.cancel();
    let started = false;
    // segurança: alguns navegadores nunca avisam que a fala terminou
    const arm = (ms: number) => {
      if (guard) clearTimeout(guard);
      guard = setTimeout(() => end(started ? 'done' : 'blocked'), ms);
    };
    arm(2500 + text.length * 110);
    parts.forEach((part, i) => {
      const u = new SpeechSynthesisUtterance(part);
      u.lang = voice?.lang || 'pt-BR';
      if (voice) u.voice = voice;
      // Voz local (offline) costuma soar mais robótica: um tom levemente mais alto e fala
      // um pouco mais lenta deixam a fala mais suave.
      u.rate = voice && voice.localService ? 0.97 : 1;
      u.pitch = voice && voice.localService ? 1.1 : 1.05;
      u.volume = 1;
      u.onstart = () => {
        if (my !== speakSeq) return;
        if (!started) {
          started = true;
          handlers.onStart?.();
        }
      };
      u.onerror = (ev) => {
        if (my !== speakSeq) return end('cancelled');
        const code = (ev as SpeechSynthesisErrorEvent).error;
        if (code === 'interrupted' || code === 'canceled') return end('cancelled');
        end(code === 'not-allowed' ? 'blocked' : 'error');
      };
      if (i === parts.length - 1) {
        u.onend = () => end(my === speakSeq ? 'done' : 'cancelled');
      }
      synth.speak(u);
    });
  } catch {
    end('error');
  }
}
