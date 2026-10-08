'use client';
import { AnimatePresence, motion, useAnimate } from 'framer-motion';
import { Eye, EyeOff, LogIn, Mic, MicOff } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Brand } from '../core/Brand';
import { DiagonalField } from '../core/DiagonalField';
import { INTRO_FLAG } from '../core/AppFrame';
import { MaxOrb, type OrbState } from '../max/MaxOrb';
import { greetingFor } from '@/lib/format';
import { getSector } from '@/lib/sectors';
import type { HubUser } from '@/lib/permissions';
import { loadVoices, speak, stopSpeaking } from '@/lib/voice';
import { firstName } from '@/lib/max/clock';
import { hear, think, understand } from '@/lib/max/engine';
import { Listener, listenSupported, type ListenState } from '@/lib/max/speech';
import { sfx } from '@/lib/max/sfx';
import type { MaxHost, MaxMemory } from '@/lib/max/types';

type Phase = 'form' | 'morph' | 'greet' | 'expand';

const LISTEN_PREF = 'maxhub:escuta';
/** depois de dizer só "Max", o próximo pedido vale sem repetir o nome (ms) */
const ARMED_MS = 9000;

export function LoginScreen() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<Phase>('form');
  const [greeting, setGreeting] = useState({ title: '', sub: '' });
  const [orbSize, setOrbSize] = useState(184);
  const [scope, animate] = useAnimate();
  const userRef = useRef<HTMLInputElement>(null);
  const orbRef = useRef<HTMLDivElement>(null);
  const wipeRef = useRef<HTMLDivElement>(null);

  /* ---------- Max na tela de entrada: escuta constante ---------- */
  const [listen, setListen] = useState<ListenState>('off');
  const [orb, setOrb] = useState<OrbState>('idle');
  const [heard, setHeard] = useState('');
  const [reply, setReply] = useState('');
  const [voiceHint, setVoiceHint] = useState(false);
  const listener = useRef<Listener | null>(null);
  const armedUntil = useRef(0);
  const busy = useRef(false);
  const seq = useRef(0);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const phaseRef = useRef<Phase>('form');
  phaseRef.current = phase;

  const host = useMemo<MaxHost>(
    () => ({
      scope: 'login',
      sector: null,
      user: null,
      tabs: [],
      tab: '',
      goTab: () => undefined,
      can: () => false,
      navigate: (path) => {
        window.location.href = path;
      },
      logout: () => undefined,
    }),
    [],
  );
  const memory = useRef<MaxMemory>({ last: null, lastInput: '', voiceOn: true, setVoice: () => undefined });
  useEffect(() => {
    memory.current.setVoice = (on) => {
      memory.current.voiceOn = on;
    };
  }, []);

  const answer = useCallback(
    async (command: string, shown: string) => {
      if (phaseRef.current !== 'form') return;
      const my = ++seq.current;
      busy.current = true;
      if (clearTimer.current) clearTimeout(clearTimer.current);
      setHeard(shown);
      setReply('');
      setOrb('thinking');
      sfx.heard();
      const r = await think(command, host, { memory: memory.current });
      if (my !== seq.current || phaseRef.current !== 'form') return;
      if (r.source !== 'stop') memory.current.last = r;
      r.act?.();
      setReply(r.text ?? r.say);
      const finish = () => {
        if (my !== seq.current) return;
        busy.current = false;
        setOrb('idle');
        listener.current?.resume();
        r.afterSpeech?.();
        clearTimer.current = setTimeout(() => {
          if (my !== seq.current) return;
          setHeard('');
          setReply('');
        }, 14000);
      };
      if (!r.say || !memory.current.voiceOn) return finish();
      // pausa a escuta enquanto fala, para não ouvir a própria voz
      listener.current?.pause();
      speak(r.say, {
        onStart: () => my === seq.current && setOrb('speaking'),
        onEnd: (result) => {
          if (result === 'blocked') setVoiceHint(true);
          finish();
        },
      });
    },
    [host],
  );

  const onFinal = useCallback(
    (_text: string, alts: string[]) => {
      if (busy.current || phaseRef.current !== 'form') return;
      const readings = alts.map((a) => ({ a, h: hear(a) }));
      const strong = readings.find((r) => r.h.wake === 'strong');
      if (strong) {
        if (!strong.h.command) {
          // só chamou: fica atenta ao próximo pedido
          armedUntil.current = Date.now() + ARMED_MS;
          setOrb('listening');
          setHeard('Max…');
          setReply('Estou ouvindo.');
          sfx.listen();
          return;
        }
        armedUntil.current = 0;
        return void answer(strong.h.command, strong.a);
      }
      const first = readings[0];
      if (!first) return;
      if (Date.now() < armedUntil.current) {
        armedUntil.current = 0;
        return void answer(first.h.wake === 'none' ? first.a : first.h.command, first.a);
      }
      // "mas/mais …" pode ser "Max" mal ouvido: só responde se o resto for um pedido claro
      if (first.h.wake === 'weak' && first.h.command) {
        const top = understand(first.h.command, host).top;
        if (top && top.score >= 0.85) return void answer(first.h.command, 'Max, ' + first.h.command);
      }
      setOrb('idle');
    },
    [answer, host],
  );

  const onInterim = useCallback((text: string) => {
    if (busy.current) return;
    const h = hear(text);
    // só mostra o que foi dito quando a pessoa está falando com a Max
    if (h.wake === 'strong' || Date.now() < armedUntil.current) {
      setOrb('listening');
      setHeard(text);
      setReply('');
    }
  }, []);

  useEffect(() => {
    loadVoices(); // pré-carrega as vozes para a saudação sair na hora
    // no celular não abre o teclado sozinho
    if (window.matchMedia('(pointer: fine)').matches) userRef.current?.focus();
    const fit = () => setOrbSize(window.innerHeight < 640 ? 104 : window.innerHeight < 800 ? 140 : 184);
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  useEffect(() => {
    const l = new Listener({ continuous: true, onState: setListen, onInterim, onFinal });
    listener.current = l;
    let wants = true;
    try {
      wants = localStorage.getItem(LISTEN_PREF) !== 'off';
    } catch {
      /* sem armazenamento */
    }
    if (wants && listenSupported()) l.start();
    const onVis = () => {
      // aba escondida não fica com o microfone aberto
      if (document.visibilityState === 'hidden') l.pause();
      else l.resume();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      l.destroy();
      listener.current = null;
      stopSpeaking();
    };
  }, [onFinal, onInterim]);

  const savePref = (on: boolean) => {
    try {
      localStorage.setItem(LISTEN_PREF, on ? 'on' : 'off');
    } catch {
      /* ignore */
    }
  };

  const toggleListen = () => {
    const l = listener.current;
    if (!l || listen === 'unsupported') return;
    setVoiceHint(false);
    if (l.active) {
      l.stop();
      savePref(false);
      setOrb('idle');
      setHeard('');
      setReply('');
    } else {
      l.start();
      savePref(true);
    }
  };

  /** Clique na esfera: liga a escuta (se preciso) e já fica atenta, sem precisar dizer "Max". */
  const orbClick = () => {
    if (phase !== 'form') return;
    const l = listener.current;
    setVoiceHint(false);
    if (busy.current) {
      // clicou enquanto ela falava: interrompe
      seq.current++;
      busy.current = false;
      stopSpeaking();
      setOrb('idle');
      l?.resume();
      return;
    }
    if (!l || listen === 'unsupported') {
      void answer('apresente-se', 'Max, apresente-se');
      return;
    }
    if (!l.active) {
      l.start();
      savePref(true);
    }
    armedUntil.current = Date.now() + ARMED_MS;
    setOrb('listening');
    setHeard('');
    setReply('Estou ouvindo.');
    sfx.listen();
    setTimeout(() => {
      if (!busy.current && Date.now() >= armedUntil.current) setOrb((o) => (o === 'listening' ? 'idle' : o));
    }, ARMED_MS + 200);
  };

  /* ---------- login ---------- */
  const shake = () => animate(scope.current, { x: [0, -10, 9, -6, 4, 0] }, { duration: 0.45 });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || phase !== 'form') return;
    setError('');
    if (!username.trim() || !password) {
      setError('Preencha usuário e senha.');
      shake();
      return;
    }
    setLoading(true);
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string; user?: HubUser; home?: string };
      if (!r.ok || !j.user) throw new Error(j.error || 'Não foi possível entrar.');
      await runIntro(j.user, j.home || '/');
    } catch (err) {
      setLoading(false);
      setError(err instanceof Error && err.message !== 'Failed to fetch' ? err.message : 'Sem conexão com o servidor. Tente de novo.');
      shake();
    }
  };

  const runIntro = async (user: HubUser, home: string) => {
    // encerra a escuta: a partir daqui é só a saudação
    seq.current++;
    busy.current = true;
    listener.current?.destroy();
    listener.current = null;
    stopSpeaking();
    if (clearTimer.current) clearTimeout(clearTimer.current);
    setHeard('');
    setReply('');

    const name = firstName(user.display_name) || user.display_name;
    const where = user.is_master ? 'Painel master' : (getSector(user.sector)?.name ?? '');
    const title = `${greetingFor()}, ${name}`;
    setGreeting({ title, sub: where });
    setPhase('morph');
    setOrb('thinking');

    const orbEl = orbRef.current;
    const card = scope.current as HTMLElement | null;
    try {
      if (card) await animate(card, { opacity: 0, scale: 0.96, y: 14, filter: 'blur(6px)' }, { duration: 0.38, ease: 'easeIn' });
      if (orbEl) {
        const rect = orbEl.getBoundingClientRect();
        const dy = window.innerHeight / 2 - (rect.top + rect.height / 2) - 34;
        await animate(orbEl, { y: dy, scale: 1.3 }, { duration: 0.8, ease: [0.76, 0, 0.24, 1] });
      }
    } catch {
      /* animação interrompida: segue */
    }

    setPhase('greet');
    setOrb('speaking');
    const started = Date.now();
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      const max = setTimeout(done, 5200);
      speak(where && !user.is_master ? `${title}. Abrindo ${where}.` : `${title}.`, {
        onEnd: () => {
          clearTimeout(max);
          // dá tempo de ler a saudação mesmo se a voz estiver desligada/bloqueada
          setTimeout(done, Math.max(350, 2300 - (Date.now() - started)));
        },
      });
    });

    setPhase('expand');
    setOrb('idle');
    const wipe = wipeRef.current;
    if (wipe && orbEl) {
      const rect = orbEl.getBoundingClientRect();
      wipe.style.left = `${rect.left + rect.width / 2}px`;
      wipe.style.top = `${rect.top + rect.height / 2}px`;
      const scale = (Math.hypot(window.innerWidth, window.innerHeight) / 100) * 2.3;
      try {
        await animate(wipe, { scale: [0, scale], opacity: [1, 1] }, { duration: 0.85, ease: [0.7, 0, 0.3, 1] });
      } catch {
        /* segue */
      }
    }
    try {
      sessionStorage.setItem(INTRO_FLAG, '1');
    } catch {
      /* ignore */
    }
    // navegação completa: garante que o cookie novo seja lido pelo servidor
    window.location.replace(home);
  };

  const letters = Array.from(greeting.title);
  const inForm = phase === 'form';
  const hint =
    listen === 'on' || listen === 'starting'
      ? 'Diga “Max, bom dia” ou “Max, apresente-se”'
      : listen === 'denied'
        ? 'Microfone bloqueado. Libere no cadeado da barra de endereço e toque na Max.'
        : listen === 'unsupported'
          ? 'Toque na Max para ela se apresentar. (Escuta por voz: use Chrome ou Edge.)'
          : 'Toque na Max para falar com ela';

  return (
    <>
      <DiagonalField />
      <main className="login-page page-layer">
        <div className="login-stage">
          <motion.div
            ref={orbRef}
            className="login-max"
            initial={{ opacity: 0, y: -18, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          >
            <button type="button" className="login-orb-btn" onClick={orbClick} disabled={!inForm} aria-label="Falar com a Max, assistente do Max Hub">
              <MaxOrb size={orbSize} state={orb} />
            </button>
          </motion.div>

          <div className={`login-caption${inForm ? '' : ' is-hidden'}`}>
            <div className="login-caption-text" aria-live="polite">
              {reply ? (
                <>
                  {heard ? <span className="heard">“{heard}”</span> : null}
                  <span className="said">{reply}</span>
                </>
              ) : heard ? (
                <span className="heard">“{heard}”</span>
              ) : (
                <span className="hint">{hint}</span>
              )}
              {voiceHint ? <span className="hint">Clique em qualquer lugar da página para eu poder responder em voz alta.</span> : null}
            </div>
            {listen !== 'unsupported' ? (
              <button type="button" className={`listen-chip${listen === 'on' ? ' is-on' : ''}`} onClick={toggleListen} aria-pressed={listen === 'on' || listen === 'starting'}>
                {listen === 'on' || listen === 'starting' ? <Mic size={13} /> : <MicOff size={13} />}
                {listen === 'on' ? 'Escuta ligada' : listen === 'starting' ? 'Ligando a escuta…' : listen === 'denied' ? 'Microfone bloqueado' : 'Escuta desligada'}
              </button>
            ) : null}
          </div>

          <motion.div
            ref={scope}
            className="login-card"
            initial={{ opacity: 0, y: 30, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.8, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
            style={inForm ? undefined : { pointerEvents: 'none' }}
            aria-hidden={!inForm}
          >
            <form className="login-content" onSubmit={submit} noValidate>
              <Brand sub="Todos os setores em um só lugar" />
              <h1>Entrar</h1>
              <p>Use seu usuário e senha. Você vai direto para a ferramenta do seu setor.</p>
              <div className="login-field">
                <label className="label" htmlFor="user">
                  Usuário
                </label>
                <input
                  ref={userRef}
                  id="user"
                  className="input"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={60}
                  value={username}
                  disabled={!inForm}
                  onChange={(e) => {
                    setUsername(e.target.value);
                    setError('');
                  }}
                  placeholder="Ex.: mateus"
                />
              </div>
              <div className="login-field">
                <label className="label" htmlFor="pass">
                  Senha
                </label>
                <div className="pass-wrap">
                  <input
                    id="pass"
                    className="input"
                    type={show ? 'text' : 'password'}
                    autoComplete="current-password"
                    maxLength={200}
                    value={password}
                    disabled={!inForm}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setError('');
                    }}
                    placeholder="••••••"
                  />
                  <button type="button" className="icon-btn" onClick={() => setShow((s) => !s)} aria-label={show ? 'Esconder senha' : 'Mostrar senha'}>
                    {show ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
              <button className="btn btn-primary btn-block" type="submit" disabled={loading}>
                {loading ? <span className="spinner" /> : <LogIn size={18} />} {loading ? 'Entrando…' : 'Entrar'}
              </button>
              <div className="login-error" role="alert">
                <AnimatePresence mode="wait">
                  {error ? (
                    <motion.span key={error} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                      {error}
                    </motion.span>
                  ) : null}
                </AnimatePresence>
              </div>
              <a className="login-back" href="/solicitacao">
                Supervisor de posto? Faça uma solicitação ao almoxarifado
              </a>
            </form>
          </motion.div>

          <AnimatePresence>
            {phase === 'greet' && greeting.title ? (
              <motion.div className="greeting" aria-live="polite" exit={{ opacity: 0, transition: { duration: 0.2 } }}>
                <div>
                  {letters.map((ch, i) => (
                    <motion.span
                      key={i}
                      initial={{ opacity: 0, y: 18, filter: 'blur(6px)' }}
                      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                      transition={{ delay: 0.1 + i * 0.04, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                    >
                      {ch}
                    </motion.span>
                  ))}
                </div>
                {greeting.sub ? (
                  <motion.small initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 + letters.length * 0.04, duration: 0.5 }}>
                    {greeting.sub}
                  </motion.small>
                ) : null}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
        <div ref={wipeRef} className="login-wipe" aria-hidden />
      </main>
    </>
  );
}
