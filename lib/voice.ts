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

export async function speak(text: string) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    const synth = window.speechSynthesis;
    const voice = pickBestVoice(await loadVoices());
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = voice?.lang || 'pt-BR';
    if (voice) u.voice = voice;
    u.rate = voice && voice.localService ? 0.95 : 0.98;
    // Voz local (offline) costuma soar mais robótica: um tom levemente mais alto e fala
    // um pouco mais lenta deixam a saudação mais suave.
    u.pitch = voice && voice.localService ? 1.1 : 1.05;
    u.volume = 1;
    synth.speak(u);
  } catch {
    /* sem voz disponível — segue em silêncio */
  }
}