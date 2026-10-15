/**
 * Cerca de localização (rodar com GEO_FENCE=on no servidor de teste). Só o @uesley tem cerca.
 * Dentro do terreno: funciona. Fora, sem GPS preciso ou sem permitir: tela bloqueada e rotas recusadas.
 * Os outros usuários e o master geral entram de qualquer lugar. O formulário público dos supervisores não é afetado.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW || 'playwright');
const B = 'http://localhost:3100';
const SHOTS = process.env.SHOTS || '/tmp/shots';
const problems = [];
const ok = (cond, msg) => { if (!cond) { problems.push(msg); console.log('  ✗', msg); } else console.log('  ✓', msg); };
const EMPRESA = { latitude: -12.986892099250628, longitude: -38.489956547863, accuracy: 15 };
const LONGE = { latitude: -12.9714, longitude: -38.5014, accuracy: 15 }; // centro de Salvador, ~2 km
async function newPage(browser, geo, allow = true) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'pt-BR', ...(geo ? { geolocation: geo } : {}), permissions: allow ? ['geolocation'] : [] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { problems.push('pageerror: ' + e.message); console.log('  ! pageerror', e.message); });
  return page;
}
async function login(page, user, url) {
  await page.goto(B + '/');
  await page.fill('#user', user);
  await page.fill('#pass', '123456');
  await page.click('button[type=submit]');
  await page.waitForURL(B + url + '**', { timeout: 20000 });
  await page.waitForTimeout(2500);
}
const api = (page, path) => page.evaluate(async (p) => { const r = await fetch(p); return { status: r.status, body: await r.json().catch(() => ({})) }; }, path);

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  console.log('\n[1] Dentro do terreno');
  let page = await newPage(browser, EMPRESA);
  await login(page, 'uesley', '/setor/operacional');
  ok((await page.locator('.geo-block').count()) === 0, 'sem bloqueio');
  ok((await api(page, '/api/pedidos?scope=operacao')).status === 200, 'o sistema responde');

  console.log('\n[2] Saiu do terreno (a posição muda com a tela aberta)');
  await page.context().setGeolocation(LONGE);
  await page.waitForSelector('.geo-block', { timeout: 30000 });
  const txt = await page.locator('.geo-card').textContent();
  ok(/Você está fora da empresa/.test(txt) && /km dela/.test(txt), 'tela bloqueada, com a distância: ' + txt.slice(0, 90));
  const r = await api(page, '/api/pedidos?scope=operacao');
  ok(r.status === 403 && r.body.geo === true, 'e o sistema recusa (403) mesmo chamando direto');
  await page.screenshot({ path: SHOTS + '/g1-fora.png' });

  console.log('\n[3] Voltou para o terreno');
  await page.context().setGeolocation(EMPRESA);
  await page.waitForSelector('.geo-block', { state: 'detached', timeout: 30000 });
  ok((await api(page, '/api/pedidos?scope=operacao')).status === 200, 'libera sozinho ao voltar');
  await page.context().close();

  console.log('\n[4] Sem permitir a localização');
  page = await newPage(browser, null, false);
  await login(page, 'uesley', '/setor/operacional');
  await page.waitForSelector('.geo-block', { timeout: 30000 });
  ok(/Permita a localização/.test(await page.locator('.geo-card').textContent()), 'pede para permitir a localização');
  ok((await api(page, '/api/pedidos?scope=operacao')).status === 403, 'sistema recusa sem localização');
  await page.context().close();

  console.log('\n[5] GPS impreciso (localização aproximada demais)');
  page = await newPage(browser, { ...EMPRESA, accuracy: 3000 });
  await login(page, 'uesley', '/setor/operacional');
  await page.waitForSelector('.geo-block', { timeout: 30000 });
  ok(/Localização imprecisa/.test(await page.locator('.geo-card').textContent()), 'impreciso: bloqueia e explica');
  await page.context().close();

  console.log('\n[6] Outros usuários não têm cerca');
  page = await newPage(browser, LONGE);
  await login(page, 'neilton', '/setor/almoxarifado');
  await page.waitForTimeout(1500);
  ok((await page.locator('.geo-block').count()) === 0 && (await api(page, '/api/almoxarifado/stock')).status === 200, 'neilton longe da empresa: sem bloqueio');
  await page.context().close();
  page = await newPage(browser, null, false);
  await login(page, 'carla', '/setor/rh');
  await page.waitForTimeout(1500);
  ok((await page.locator('.geo-block').count()) === 0, 'carla sem permitir localização: sem bloqueio');
  await page.context().close();

  console.log('\n[6b] Master geral entra de qualquer lugar');
  page = await newPage(browser, LONGE);
  await login(page, 'mateus', '/hub');
  ok((await page.locator('.geo-block').count()) === 0 && (await api(page, '/api/hub/users')).status === 200, 'master longe da empresa: sem bloqueio');
  await page.click('.nav-item[data-tab="auditoria"]');
  await page.waitForSelector('.au-row', { timeout: 10000 });
  const au = await page.locator('.au-list').textContent();
  ok(/Saiu da área da empresa/.test(au) && /Entrou na área da empresa/.test(au), 'a Auditoria mostra a saída e a volta da área');
  await page.context().close();

  console.log('\n[7] Formulário público dos supervisores continua funcionando de fora');
  page = await newPage(browser, LONGE);
  await page.goto(B + '/solicitacao');
  await page.waitForTimeout(2000);
  ok((await page.locator('.geo-block').count()) === 0 && (await api(page, '/api/form')).status === 200, 'formulário abre e responde');
} catch (e) {
  problems.push('EXCEÇÃO ' + e.message);
  console.log('EXCEÇÃO', e);
} finally {
  await browser.close();
}
console.log(problems.length ? `\n${problems.length} problema(s):\n- ` + problems.join('\n- ') : '\nTUDO CERTO');
process.exit(problems.length ? 1 : 0);
