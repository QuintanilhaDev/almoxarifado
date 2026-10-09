import 'server-only';
import { normalize } from '../text';
import { getJson } from './net';

/** Cotações gratuitas e sem chave (AwesomeAPI; se falhar, Frankfurter/BCE). */
const COINS: { code: string; name: string; re: RegExp }[] = [
  { code: 'USD', name: 'dólar', re: /\b(dolar|dolares|usd)\b/ },
  { code: 'EUR', name: 'euro', re: /\b(euro|euros|eur)\b/ },
  { code: 'GBP', name: 'libra', re: /\b(libra|libras|gbp)\b/ },
  { code: 'ARS', name: 'peso argentino', re: /\b(peso argentino|pesos argentinos|ars)\b/ },
  { code: 'BTC', name: 'bitcoin', re: /\b(bitcoin|btc)\b/ },
];

export function currencyIn(text: string) {
  const n = normalize(text);
  const coin = COINS.find((c) => c.re.test(n));
  if (!coin) return null;
  if (!/\b(cotacao|quanto (esta|ta|custa|vale)|valor|preco|hoje|agora|cambio|converter|converta|em reais?)\b/.test(n) && n.split(' ').length > 3) return null;
  return coin;
}

const brl = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);

function spoken(value: number): string {
  const reais = Math.floor(value);
  const cents = Math.round((value - reais) * 100);
  const r = `${new Intl.NumberFormat('pt-BR').format(reais)} ${reais === 1 ? 'real' : 'reais'}`;
  return cents ? `${r} e ${cents} ${cents === 1 ? 'centavo' : 'centavos'}` : r;
}

export async function currencyAnswer(text: string): Promise<{ say: string; text: string } | null> {
  const coin = currencyIn(text);
  if (!coin) return null;
  let value: number | null = null;
  const a = await getJson<Record<string, { bid?: string }>>(`https://economia.awesomeapi.com.br/json/last/${coin.code}-BRL`);
  const bid = Number(a?.[`${coin.code}BRL`]?.bid);
  if (Number.isFinite(bid) && bid > 0) value = bid;
  if (value === null && coin.code !== 'BTC') {
    const f = await getJson<{ rates?: { BRL?: number } }>(`https://api.frankfurter.dev/v1/latest?base=${coin.code}&symbols=BRL`);
    if (f?.rates?.BRL) value = f.rates.BRL;
  }
  if (value === null) return null;
  const amount = Number(normalize(text).match(/\b(\d+(?:[.,]\d+)?)\s*(?:dolar|dolares|euro|euros|libra|libras|bitcoin|usd|eur|gbp|btc)/)?.[1]?.replace(',', '.'));
  if (Number.isFinite(amount) && amount > 0 && amount !== 1) {
    const total = amount * value;
    return {
      say: `${new Intl.NumberFormat('pt-BR').format(amount)} em ${coin.name} dá ${spoken(total)}, com a cotação de agora.`,
      text: `${new Intl.NumberFormat('pt-BR').format(amount)} ${coin.code} = ${brl(total)} (cotação ${brl(value)})`,
    };
  }
  return { say: `O ${coin.name} está cotado a ${spoken(value)}.`, text: `1 ${coin.code} = ${brl(value)}` };
}
