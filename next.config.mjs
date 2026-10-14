/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // o pdfkit lê as fontes do próprio pacote em tempo de execução
  serverExternalPackages: ['pdfkit'],
  outputFileTracingIncludes: { '/api/gestao/pdf': ['./node_modules/pdfkit/js/data/**'] },
};
export default nextConfig;
