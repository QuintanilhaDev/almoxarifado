/** Tema salvo (claro/escuro): roda no <head> do servidor, por isso fica fora do código 'use client'. */
export const THEME_KEY = 'maxhub-theme';
/** roda no <head>, antes de desenhar: a página já abre no tema escolhido (sem piscar) */
export const themeScript = `try{var t=localStorage.getItem('${THEME_KEY}');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;else document.documentElement.dataset.theme='dark'}catch(e){document.documentElement.dataset.theme='dark'}`;
