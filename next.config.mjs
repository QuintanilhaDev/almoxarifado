/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // o pdfkit lê as fontes do próprio pacote em tempo de execução
  // o pdf.js (leitura do DANFE) também roda direto do node_modules
  serverExternalPackages: ['pdfkit', 'pdfjs-dist'],
  outputFileTracingIncludes: {
    '/api/gestao/pdf': ['./node_modules/pdfkit/js/data/**'],
    '/api/compras/**': ['./node_modules/pdfkit/js/data/**'],
    '/api/almoxarifado/notas/**': ['./node_modules/pdfkit/js/data/**', './node_modules/pdfjs-dist/legacy/build/**'],
  },
};
export default nextConfig;
