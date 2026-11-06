/**
 * Copia TODOS os anexos do Storage do Supabase (fotos do formulário, notas fiscais, PDFs,
 * prints dos chamados) para a pasta de anexos do servidor próprio, no formato que o Max Hub usa.
 * Pode rodar mais de uma vez: o que já foi copiado é pulado.
 *
 * Uso (no servidor, na pasta do código, com as chaves que estão hoje na Vercel):
 *   NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
 *   STORAGE_DIR=/var/lib/maxhub/arquivos node deploy/banco/baixar-anexos.mjs
 * Depois: sudo chown -R maxhub:maxhub /var/lib/maxhub/arquivos
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dir = process.env.STORAGE_DIR || '/var/lib/maxhub/arquivos';
const BUCKET = 'anexos';
if (!url || !key) {
  console.error('Defina NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

async function* walk(prefix = '') {
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await sb.storage.from(BUCKET).list(prefix, { limit: 1000, offset });
    if (error) throw error;
    for (const it of data) {
      const p = prefix ? `${prefix}/${it.name}` : it.name;
      if (it.id === null) yield* walk(p); // pasta
      else yield { path: p, type: it.metadata?.mimetype || 'application/octet-stream' };
    }
    if (data.length < 1000) break;
  }
}

let ok = 0;
let skip = 0;
let bad = 0;
for await (const f of walk()) {
  const dest = path.join(dir, BUCKET, f.path);
  if (fs.existsSync(dest) && fs.existsSync(`${dest}.tipo`)) {
    skip++;
    continue;
  }
  const { data, error } = await sb.storage.from(BUCKET).download(f.path);
  if (error || !data) {
    bad++;
    console.error('falhou:', f.path, error?.message);
    continue;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await data.arrayBuffer()));
  fs.writeFileSync(`${dest}.tipo`, data.type || f.type);
  ok++;
  if (ok % 50 === 0) console.log(`${ok} arquivos copiados…`);
}
console.log(`Fim: ${ok} copiados, ${skip} já estavam lá, ${bad} com falha.`);
process.exit(bad ? 1 : 0);
