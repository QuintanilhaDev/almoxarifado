'use client';
import { AnimatePresence, motion, useAnimate } from 'framer-motion';
import { Eye, EyeOff, LogIn } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Brand } from './Brand';
import { DiagonalField } from './DiagonalField';
import { greetingFor } from '@/lib/format';
import { loadVoices, speak } from '@/lib/voice';

type Phase = 'form' | 'morph' | 'slime' | 'expand';

export const INTRO_FLAG = 'almox:intro';
const CIRCLE = 168;
const SLIME_MS = 5000;

export function LoginScreen() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<Phase>('form');
  const [greeting, setGreeting] = useState('');
  const [scope, animate] = useAnimate();
  const userRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadVoices(); // pré-carrega as vozes para a saudação sair na hora
    // no celular não abre o teclado sozinho
    if (window.matchMedia('(pointer: fine)').matches) userRef.current?.focus();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || phase !== 'form') return;
    setError('');
    if (!username.trim() || !password) {
      setError('Preencha usuário e senha.');
      animate(scope.current, { x: [0, -10, 9, -6, 4, 0] }, { duration: 0.45 });
      return;
    }
    setLoading(true);
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Não foi possível entrar.');

      const name: string = j.user?.display_name || username;
      const text = `${greetingFor()}, ${name}`;
      setGreeting(text);
      speak(text);
      await runIntro();
    } catch (err) {
      setLoading(false);
      setError(err instanceof Error ? err.message : 'Não foi possível entrar.');
      animate(scope.current, { x: [0, -10, 9, -6, 4, 0] }, { duration: 0.45 });
    }
  };

  const runIntro = async () => {
    const card = scope.current as HTMLElement;
    const rect = card.getBoundingClientRect();
    setPhase('morph');
    // trava o tamanho atual para poder animar até o círculo
    await animate(card, { width: rect.width, height: rect.height }, { duration: 0 });
    await animate('.login-content', { opacity: 0, y: -10, filter: 'blur(4px)' }, { duration: 0.28, ease: 'easeIn' });
    await animate(
      card,
      { width: CIRCLE, height: CIRCLE, borderRadius: CIRCLE / 2, backgroundColor: '#c6a8ff', borderColor: 'rgba(198,168,255,0)' },
      { duration: 0.75, ease: [0.76, 0, 0.24, 1] },
    );
    setPhase('slime');
    await new Promise((r) => setTimeout(r, SLIME_MS));
    setPhase('expand');
    const scale = (Math.hypot(window.innerWidth, window.innerHeight) / CIRCLE) * 1.15;
    await animate(card, { scale }, { duration: 0.85, ease: [0.7, 0, 0.3, 1] });
    try {
      sessionStorage.setItem(INTRO_FLAG, '1');
    } catch {
      /* ignore */
    }
    // navegação completa: garante que o cookie novo seja lido pelo servidor
    window.location.replace('/dashboard');
  };

  const letters = Array.from(greeting);

  return (
    <>
      <DiagonalField />
      <main className="login-page page-layer">
        <div className="login-stage">
          <motion.div
            ref={scope}
            className={`login-card${phase === 'slime' ? ' is-slime' : ''}`}
            initial={{ opacity: 0, y: 30, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            style={phase === 'expand' ? { backgroundColor: '#c6a8ff', overflow: 'hidden' } : undefined}
          >
            {phase === 'form' || phase === 'morph' ? (
              <form className="login-content" onSubmit={submit} noValidate>
                <Brand sub="Painel da equipe" />
                <h1>Entrar</h1>
                <p>Use seu usuário e senha do painel.</p>
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
                    spellCheck={false}
                    value={username}
                    onChange={(e) => {
                      setUsername(e.target.value);
                      setError('');
                    }}
                    placeholder="Ex.: neilton"
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
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        setError('');
                      }}
                      placeholder="••••••"
                    />
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => setShow((s) => !s)}
                      aria-label={show ? 'Esconder senha' : 'Mostrar senha'}
                    >
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
                  Ir para o formulário de solicitação
                </a>
              </form>
            ) : null}

            {phase === 'slime' ? <Slime /> : null}
          </motion.div>

          <AnimatePresence>
            {phase === 'slime' && greeting ? (
              <motion.div className="greeting" aria-live="polite" exit={{ opacity: 0, transition: { duration: 0.2 } }}>
                {letters.map((ch, i) => (
                  <motion.span
                    key={i}
                    initial={{ opacity: 0, y: 18, filter: 'blur(6px)' }}
                    animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                    transition={{ delay: 0.25 + i * 0.045, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                  >
                    {ch}
                  </motion.span>
                ))}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </main>
    </>
  );
}

/** Círculo gelatinoso: bolhas que se esticam, se fundem e voltam ao centro. */
function Slime() {
  return (
    <svg className="slime" viewBox="0 0 280 280" aria-hidden>
      <defs>
        <filter id="goo" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="10" result="blur" />
          <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 26 -11" />
        </filter>
        <radialGradient id="slimeFill" gradientUnits="userSpaceOnUse" cx="110" cy="100" r="170">
          <stop offset="0%" stopColor="#e6d9ff" />
          <stop offset="55%" stopColor="#c6a8ff" />
          <stop offset="100%" stopColor="#9b72f5" />
        </radialGradient>
      </defs>
      <g filter="url(#goo)" fill="url(#slimeFill)">
        <circle className="core" cx="140" cy="140" r="84" />
        <g className="orbit orbit-1">
          <circle className="blob blob-1" cx="140" cy="140" r="30" />
        </g>
        <g className="orbit orbit-2">
          <circle className="blob blob-2" cx="140" cy="140" r="26" />
        </g>
        <g className="orbit orbit-3">
          <circle className="blob blob-3" cx="140" cy="140" r="32" />
        </g>
        <g className="orbit orbit-4">
          <circle className="blob blob-4" cx="140" cy="140" r="22" />
        </g>
      </g>
    </svg>
  );
}
