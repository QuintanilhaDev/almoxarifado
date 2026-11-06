import type { Metadata, Viewport } from 'next';
// fontes servidas pelo próprio site (sem depender do Google Fonts)
import '@fontsource-variable/instrument-sans/index.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import './globals.css';
import './obsidiana.css';
import { WarpProvider } from '@/components/core/Warp';
import { GeoGuard } from '@/components/core/GeoGuard';
import { AuditBeacon } from '@/components/core/AuditBeacon';
import { VersionWatch } from '@/components/core/VersionWatch';
import { fxScript } from '@/lib/fxScript';
import { themeScript } from '@/lib/themeScript';
import './fx3d.css';

export const metadata: Metadata = {
  title: 'Max Hub',
  description: 'Max Hub: todos os setores da empresa em um só lugar, com a assistente Max.',
  robots: { index: false, follow: false },
  icons: { icon: '/favicon.svg' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0b0b0d',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: fxScript }} />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <WarpProvider>{children}</WarpProvider>
        <GeoGuard />
        <AuditBeacon />
        <VersionWatch />
      </body>
    </html>
  );
}
