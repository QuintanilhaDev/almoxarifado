/**
 * Animações 3D decorativas (cena ao fundo, cartões inclinando, entradas girando): desligadas no
 * visual atual, mais sóbrio. O atributo continua para o CSS e a impressão; 'full' liga de novo.
 */
export type FxMode = 'full' | 'lite' | 'off';
export const fxScript = `document.documentElement.dataset.fx='off'`;
