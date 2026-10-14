'use client';
import { useId } from 'react';
import './cap.css';

/**
 * Boné "Max Forte" da Max. Fica por cima da esfera (mesma caixa 100×100 do rostinho)
 * e mexe junto com ela: balança em repouso, acompanha a fala, inclina pensando,
 * quica correndo e pula no soco (as animações estão em cap.css e, na corrida, em max.css).
 */
export function MaxCap() {
  const id = useId().replace(/:/g, '');
  const g = (n: string) => `${n}-${id}`;
  return (
    <svg className="max-cap" viewBox="0 0 100 100" aria-hidden focusable="false">
      <defs>
        <radialGradient id={g('crown')} cx="38%" cy="22%" r="80%">
          <stop offset="0%" stopColor="#4a4659" />
          <stop offset="45%" stopColor="#2a2735" />
          <stop offset="100%" stopColor="#14131b" />
        </radialGradient>
        <radialGradient id={g('front')} cx="42%" cy="18%" r="85%">
          <stop offset="0%" stopColor="#56516a" />
          <stop offset="55%" stopColor="#302d3d" />
          <stop offset="100%" stopColor="#1b1a24" />
        </radialGradient>
        <linearGradient id={g('brim')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3b3749" />
          <stop offset="55%" stopColor="#24222f" />
          <stop offset="100%" stopColor="#111017" />
        </linearGradient>
        <linearGradient id={g('under')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0c0b10" stopOpacity="0" />
          <stop offset="100%" stopColor="#0c0b10" stopOpacity="0.9" />
        </linearGradient>
        <linearGradient id={g('text')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#e2d4ff" />
        </linearGradient>
        <filter id={g('soft')} x="-30%" y="-80%" width="160%" height="260%">
          <feGaussianBlur stdDeviation="1.1" />
        </filter>
        <path id={g('arc')} d="M35.2 33.6 Q50 28.4 64.8 33.6" />
      </defs>

      {/* sombra que o boné faz na testa */}
      <ellipse className="mc-shade" cx="50" cy="42.6" rx="18.5" ry="2.6" fill="#1c0f3a" opacity="0.34" filter={`url(#${g('soft')})`} />

      <g className="mc-cap">
        {/* copa */}
        <path d="M27.2 38.4 C26.6 25.6 36.4 17.4 50 17.4 C63.6 17.4 73.4 25.6 72.8 38.4 C64 36.6 36 36.6 27.2 38.4 Z" fill={`url(#${g('crown')})`} />
        {/* gomos de trás (costuras discretas) */}
        <path d="M50 18.2 C43 21 38.6 28 37.2 37.4 M50 18.2 C57 21 61.4 28 62.8 37.4" fill="none" stroke="#0c0b12" strokeWidth="0.55" opacity="0.65" />
        {/* painel da frente, onde vai o bordado */}
        <path d="M33.4 37.4 C33.6 27.6 40.6 20.8 50 20.4 C59.4 20.8 66.4 27.6 66.6 37.4 C59 36.2 41 36.2 33.4 37.4 Z" fill={`url(#${g('front')})`} />
        <path d="M34.6 36.6 C35 28.4 41.4 22.2 50 21.7 C58.6 22.2 65 28.4 65.4 36.6" fill="none" stroke="#8e86a8" strokeWidth="0.32" strokeDasharray="0.9 0.7" opacity="0.7" />
        {/* bordado "MAX FORTE" */}
        <text className="mc-text" fontSize="4.15" fontWeight="800" letterSpacing="0.35" fill={`url(#${g('text')})`} style={{ fontFamily: 'var(--font-display, system-ui), system-ui, sans-serif' }}>
          <textPath href={`#${g('arc')}`} startOffset="50%" textAnchor="middle">
            MAX FORTE
          </textPath>
        </text>
        <path d="M41.2 35.2 L58.8 35.2" stroke="#c6a8ff" strokeWidth="0.55" strokeLinecap="round" opacity="0.9" />
        {/* brilho da copa */}
        <path d="M34 27 C37 21.6 42.6 19.2 48 19" fill="none" stroke="#ffffff" strokeWidth="1.6" strokeLinecap="round" opacity="0.16" />
        {/* botão do topo */}
        <ellipse cx="50" cy="18" rx="2.6" ry="1.35" fill="#3d3a4c" />
        <ellipse cx="49.4" cy="17.6" rx="1.2" ry="0.5" fill="#ffffff" opacity="0.28" />
        {/* aba */}
        <path d="M27.6 37.8 C34.4 35.6 65.6 35.6 72.4 37.8 C71.6 41.6 61.6 43.6 50 43.6 C38.4 43.6 28.4 41.6 27.6 37.8 Z" fill={`url(#${g('brim')})`} />
        <path d="M27.6 37.8 C28.4 41.6 38.4 43.6 50 43.6 C61.6 43.6 71.6 41.6 72.4 37.8 C71.9 40.4 61.6 42.2 50 42.2 C38.4 42.2 28.1 40.4 27.6 37.8 Z" fill={`url(#${g('under')})`} />
        <path d="M30.6 38.9 C38 40.7 62 40.7 69.4 38.9" fill="none" stroke="#7d7596" strokeWidth="0.3" strokeDasharray="0.8 0.6" opacity="0.8" />
        <path d="M27.6 37.8 C28.4 41.6 38.4 43.6 50 43.6 C61.6 43.6 71.6 41.6 72.4 37.8" fill="none" stroke="#c6a8ff" strokeWidth="0.45" opacity="0.55" />
      </g>
    </svg>
  );
}
