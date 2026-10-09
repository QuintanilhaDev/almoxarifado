import 'server-only';
import { normalize } from '../text';
import { getJson } from './net';

/** Clima pelo Open-Meteo (gratuito, sem chave). Padrão: Salvador/BA. */
const SALVADOR = { name: 'Salvador', lat: -12.9714, lon: -38.5014 };

const WMO: [number[], string][] = [
  [[0], 'céu limpo'],
  [[1], 'poucas nuvens'],
  [[2], 'parcialmente nublado'],
  [[3], 'nublado'],
  [[45, 48], 'neblina'],
  [[51, 53, 55, 56, 57], 'garoa'],
  [[61, 80], 'chuva fraca'],
  [[63, 81], 'chuva'],
  [[65, 82], 'chuva forte'],
  [[66, 67], 'chuva gelada'],
  [[71, 73, 75, 77, 85, 86], 'neve'],
  [[95], 'trovoadas'],
  [[96, 99], 'tempestade com granizo'],
];
const describe = (code: number) => WMO.find(([codes]) => codes.includes(code))?.[1] ?? 'tempo instável';

export function isWeatherQuestion(text: string): boolean {
  const n = normalize(text);
  if (/\b(clima|chover|chovendo|chuva|temperatura|graus|previsao do tempo|guarda chuva|sol hoje|ensolarado|nublado)\b/.test(n)) return true;
  if (/\b(calor|frio)\b/.test(n) && /\b(hoje|amanha|agora|la fora|esta|ta|faz|fazendo|vai)\b/.test(n)) return true;
  return /\b(como (esta|ta|vai estar|vai ficar) o tempo|tempo (hoje|amanha|agora|la fora|em [a-z]+)|previsao)\b/.test(n);
}

function cityIn(text: string): string | null {
  const n = normalize(text);
  const m = n.match(/\b(?:em|para|pra|de|na cidade de|no municipio de)\s+((?:[a-z]+\s?){1,4}?)(?:\s+(?:hoje|amanha|agora|esta|neste|nesse|no momento)\b|$)/);
  if (!m) return null;
  const city = m[1].trim();
  if (!city || /^(hoje|amanha|agora|salvador|casa|aqui|la fora|tempo|chuva)$/.test(city)) return null;
  return city;
}

interface Forecast {
  current?: { temperature_2m: number; apparent_temperature: number; weather_code: number; relative_humidity_2m: number };
  daily?: { temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: (number | null)[]; weather_code: number[] };
}

export async function weatherAnswer(text: string): Promise<{ say: string; text: string } | null> {
  let place = SALVADOR;
  const city = cityIn(text);
  if (city) {
    const geo = await getJson<{ results?: { name: string; latitude: number; longitude: number }[] }>(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=pt&format=json`,
    );
    const hit = geo?.results?.[0];
    if (hit) place = { name: hit.name, lat: hit.latitude, lon: hit.longitude };
  }
  const f = await getJson<Forecast>(
    `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}` +
      '&current=temperature_2m,apparent_temperature,weather_code,relative_humidity_2m' +
      '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code' +
      '&timezone=America%2FBahia&forecast_days=2',
  );
  if (!f?.current || !f.daily) return null;
  const tomorrow = /\bamanha\b/.test(normalize(text));
  const i = tomorrow ? 1 : 0;
  const max = Math.round(f.daily.temperature_2m_max[i]);
  const min = Math.round(f.daily.temperature_2m_min[i]);
  const rain = f.daily.precipitation_probability_max[i];
  const rainText = rain === null || rain === undefined ? '' : ` A chance de chuva é de ${Math.round(rain)} por cento.`;
  if (tomorrow) {
    const say = `Amanhã em ${place.name}: ${describe(f.daily.weather_code[1])}, com mínima de ${min} e máxima de ${max} graus.${rainText}`;
    return { say, text: say.replace(/ por cento/g, '%').replace(/ graus/g, ' °C') };
  }
  const now = Math.round(f.current.temperature_2m);
  const feels = Math.round(f.current.apparent_temperature);
  const say = `Agora em ${place.name} faz ${now} graus, com ${describe(f.current.weather_code)}${feels !== now ? ` e sensação de ${feels}` : ''}. Hoje a mínima é de ${min} e a máxima de ${max} graus.${rainText}`;
  return { say, text: say.replace(/ por cento/g, '%').replace(/ graus/g, ' °C') };
}
