'use client';
import { AnimatePresence, motion } from 'framer-motion';
import { LogOut, MapPin, RefreshCcw } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

type State = 'checking' | 'ok' | 'fora' | 'impreciso' | 'negado' | 'sem-sinal' | 'sem-suporte';

const INSIDE_AREA = /^\/(hub|setor|sem-setor|dashboard)(\/|$)/;
/** renova a permissão (que dura 3 minutos) enquanto a pessoa continua dentro */
const HEARTBEAT_MS = 60_000;

/**
 * Vigia a localização o tempo todo nas áreas internas, para quem tem cerca (hoje só o @uesley).
 * Fora do terreno da empresa (ou sem permitir a localização), a tela fica bloqueada até a pessoa voltar.
 * Quem não tem cerca nem chega a ser perguntado: o servidor responde "isento" logo de cara.
 */
export function GeoGuard() {
  const pathname = usePathname();
  const active = INSIDE_AREA.test(pathname ?? '');
  const [state, setState] = useState<State>('checking');
  const [distance, setDistance] = useState<number | null>(null);
  const last = useRef<{ lat: number; lng: number; accuracy: number } | null>(null);
  const sent = useRef(0);
  const exempt = useRef(false);
  const watch = useRef<number | null>(null);
  // a conferência é rápida: o aviso "Conferindo…" só aparece se demorar
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 900);
    return () => clearTimeout(t);
  }, []);

  const send = useCallback(async (pos: { lat: number; lng: number; accuracy: number } | null) => {
    try {
      const r = await fetch('/api/geo', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pos ?? {}),
      });
      if (r.status === 401) return 'logout' as const;
      const j = (await r.json()) as { status: string; distance?: number | null };
      sent.current = Date.now();
      if (j.status === 'isento' || j.status === 'desligado') {
        exempt.current = true;
        setState('ok');
        return 'exempt' as const;
      }
      // sem posição ainda: o servidor só confirma que há cerca; segue conferindo
      if (j.status === 'aguardando') return j.status;
      setDistance(j.distance ?? null);
      setState(j.status === 'dentro' ? 'ok' : j.status === 'fora' ? 'fora' : 'impreciso');
      return j.status;
    } catch {
      return 'erro' as const;
    }
  }, []);

  const startWatch = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setState('sem-suporte');
      return;
    }
    if (watch.current !== null) navigator.geolocation.clearWatch(watch.current);
    watch.current = navigator.geolocation.watchPosition(
      (p) => {
        const pos = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy };
        const prev = last.current;
        last.current = pos;
        // manda quando muda de verdade (ou a cada 20 s no máximo)
        const moved = !prev || Math.hypot((pos.lat - prev.lat) * 111_000, (pos.lng - prev.lng) * 108_000) > 8 || Math.abs(pos.accuracy - prev.accuracy) > 20;
        if (moved || Date.now() - sent.current > 20_000) void send(pos);
      },
      (err) => setState(err.code === err.PERMISSION_DENIED ? 'negado' : 'sem-sinal'),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 25_000 },
    );
  }, [send]);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    (async () => {
      // primeiro pergunta ao servidor se a pessoa tem cerca (o master geral não tem)
      const first = await send(null);
      if (!alive || first === 'logout' || first === 'exempt') return;
      startWatch();
    })();
    const beat = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (exempt.current) {
        if (Date.now() - sent.current > 6 * 3600_000) void send(null);
        return;
      }
      if (last.current) void send(last.current);
    }, HEARTBEAT_MS);
    // uma rota recusou por localização: confere de novo na hora
    const onBlocked = () => {
      if (exempt.current) {
        // deixou de ser isento (entrou na cerca): passa a mandar a posição
        void send(null).then((s) => {
          if (s === 'aguardando') {
            exempt.current = false;
            startWatch();
          }
        });
      }
      else if (last.current) void send(last.current);
      else startWatch();
    };
    window.addEventListener('maxhub:geo-blocked', onBlocked);
    return () => {
      alive = false;
      clearInterval(beat);
      window.removeEventListener('maxhub:geo-blocked', onBlocked);
      if (watch.current !== null) navigator.geolocation.clearWatch(watch.current);
      watch.current = null;
    };
  }, [active, send, startWatch]);

  // qualquer resposta "fora da área" de uma rota do sistema aciona a verificação
  useEffect(() => {
    const w = window as Window & { __geoFetch?: boolean };
    if (w.__geoFetch) return;
    w.__geoFetch = true;
    const orig = window.fetch.bind(window);
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const res = await orig(...args);
      if (res.status === 403) {
        res
          .clone()
          .json()
          .then((j: { geo?: boolean }) => j?.geo && window.dispatchEvent(new Event('maxhub:geo-blocked')))
          .catch(() => undefined);
      }
      return res;
    };
  }, []);

  if (!active) return null;
  const blocked = state !== 'ok' && (state !== 'checking' || slow);
  const far = distance === null ? '' : distance >= 1000 ? `${(distance / 1000).toFixed(1).replace('.', ',')} km` : `${distance} m`;
  const copy: Record<Exclude<State, 'ok'>, { title: string; text: string }> = {
    checking: { title: 'Conferindo sua localização…', text: 'O Max Hub só funciona dentro do terreno da empresa.' },
    fora: { title: 'Você está fora da empresa', text: `O Max Hub só funciona dentro do terreno da empresa.${far ? ` Você está a ${far} dela.` : ''} Assim que voltar, a tela libera sozinha.` },
    impreciso: { title: 'Localização imprecisa', text: 'O aparelho não conseguiu dizer com precisão onde você está. Ative o Wi-Fi ou o GPS e tente de novo.' },
    negado: { title: 'Permita a localização', text: 'Para usar o Max Hub é preciso permitir o acesso à localização. Toque no ícone de cadeado ao lado do endereço do site, permita a localização e tente de novo.' },
    'sem-sinal': { title: 'Sem sinal de localização', text: 'Não consegui a sua localização. Confira se o GPS ou o Wi-Fi estão ligados e tente de novo.' },
    'sem-suporte': { title: 'Navegador sem localização', text: 'Este navegador não informa a localização. Use o Chrome, o Edge ou o Safari atualizados.' },
  };
  const c = blocked ? copy[state as Exclude<State, 'ok'>] : null;

  return (
    <AnimatePresence>
      {blocked && c ? (
        <motion.div className="geo-block" role="alertdialog" aria-modal="true" aria-label={c.title} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="geo-card" initial={{ y: 16, scale: 0.96 }} animate={{ y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 320, damping: 26 }}>
            <span className={`geo-pin${state === 'checking' ? ' is-checking' : ''}`}>
              <MapPin size={26} />
            </span>
            <h2>{c.title}</h2>
            <p>{c.text}</p>
            {state !== 'checking' ? (
              <div className="geo-actions">
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    setState('checking');
                    if (last.current) void send(last.current);
                    startWatch();
                  }}
                >
                  <RefreshCcw size={16} /> Tentar de novo
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={async () => {
                    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => undefined);
                    window.location.href = '/';
                  }}
                >
                  <LogOut size={16} /> Sair
                </button>
              </div>
            ) : (
              <span className="spinner" />
            )}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
