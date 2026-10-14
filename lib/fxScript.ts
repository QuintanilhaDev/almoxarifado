/** Modo das animações 3D (lido antes do React carregar). Sem 'use client': o layout do servidor usa. */
export type FxMode = 'full' | 'lite' | 'off';
export const FX_KEY = 'maxhub:fx';

/** roda antes do React (no <head>): evita a tela "pular" de modo */
export const fxScript = `try{var m=localStorage.getItem('${FX_KEY}');if(m!=='full'&&m!=='lite'&&m!=='off'){m=matchMedia('(prefers-reduced-motion: reduce)').matches?'lite':'full'}document.documentElement.dataset.fx=m}catch(e){document.documentElement.dataset.fx='full'}`;

