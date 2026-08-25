import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Palantir',
  description: 'Gameserver-Verwaltung für den eigenen Homeserver',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0a0b0f',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Oberflächensprache ist laut Lastenheft §4 zunächst ausschließlich Deutsch.
  return (
    <html lang="de">
      <head>
        {/*
          Schriften des Design-Systems (F2): Space Grotesk und JetBrains Mono,
          wie im Referenz-Mockup. Bewusst als <link> statt über `next/font/google`,
          damit der Build ohne Netzzugang durchläuft; die Fallback-Stacks stehen
          in `tailwind.config.ts`.
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- Die Regel zielt auf
            pages/_document.js. Im App Router ist dieses Root-Layout genau die eine Stelle,
            an der die Schriften für alle Seiten eingebunden werden. */}
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-canvas text-ink antialiased">{children}</body>
    </html>
  );
}
