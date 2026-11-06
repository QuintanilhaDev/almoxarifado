import fs from 'node:fs';
import path from 'node:path';
import { PHASE_PRODUCTION_BUILD } from 'next/constants.js';

/**
 * Versão desta build. As telas abertas comparam com /version.json (arquivo estático, sem custo
 * de função) e se atualizam sozinhas quando sai uma versão nova.
 * Só a build grava o arquivo: o "next start" do servidor próprio não pode trocar a versão.
 */
function buildVersion(phase) {
  if (phase !== PHASE_PRODUCTION_BUILD) return 'dev';
  // a build carrega este arquivo mais de uma vez (workers): a versão fica fixa no processo
  const v = process.env.MAXHUB_BUILD_V || (process.env.VERCEL_GIT_COMMIT_SHA || process.env.MAXHUB_VERSION || '').slice(0, 12) || `b${Date.now().toString(36)}`;
  process.env.MAXHUB_BUILD_V = v;
  try {
    fs.writeFileSync(path.join(process.cwd(), 'public', 'version.json'), JSON.stringify({ version: v }) + '\n');
  } catch {
    /* sem o arquivo, as telas só não se atualizam sozinhas */
  }
  return v;
}

/** @type {(phase: string) => import('next').NextConfig} */
const nextConfig = (phase) => ({
  env: { NEXT_PUBLIC_BUILD_VERSION: buildVersion(phase) },
  async headers() {
    return [{ source: '/version.json', headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }] }];
  },
  reactStrictMode: true,
  poweredByHeader: false,
  // o pdfkit lê as fontes do próprio pacote em tempo de execução
  // o pdf.js (leitura do DANFE) também roda direto do node_modules
  serverExternalPackages: ['pdfkit', 'pdfjs-dist'],
  outputFileTracingIncludes: {
    '/api/gestao/pdf': ['./node_modules/pdfkit/js/data/**'],
    '/api/rh/devolucoes/relatorio': ['./node_modules/pdfkit/js/data/**'],
    '/api/compras/**': ['./node_modules/pdfkit/js/data/**'],
    '/api/pontos/**': ['./node_modules/pdfkit/js/data/**', './node_modules/pdfjs-dist/legacy/build/**'],
    '/api/almoxarifado/notas/**': ['./node_modules/pdfkit/js/data/**', './node_modules/pdfjs-dist/legacy/build/**'],
  },
});
export default nextConfig;
