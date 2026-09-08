import type { Metadata, Viewport } from 'next';
import { FONT_STYLESHEET_LINK_ATTRIBUTE, fontStylesheetUrl } from '@/lib/api/fonts';
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
          Schriften der Instanz (Arbeitspaket S-3, Fundpunkt 151).

          Hier standen bis zuletzt drei `<link>`-Zeilen zu den Schrift-Hosts von
          Google. Damit erfuhr ein Dritter bei **jedem** Seitenaufruf die
          IP-Adresse des Betrachters – noch bevor er sich angemeldet hatte. Das
          ist der Grund für das ganze Feature; die beiden Hostnamen stehen
          deshalb nirgends mehr in dieser Anwendung, auch nicht als Kommentar
          (`fontSources.test.ts` hält das fest).

          Jetzt kommt ein einziges Stylesheet aus der eigenen API. Es enthält die
          `@font-face`-Regeln aller Schriften der Instanz und die beiden
          CSS-Variablen mit der Auswahl des Betreibers
          (`--palantir-font-ui`/`--palantir-font-mono`, ausgewertet in
          `tailwind.config.ts`). Bewusst als `<link>` und nicht per JavaScript:
          So wirkt es auf jeder Seite – auch auf der Anmeldeseite, die noch gar
          keine Sitzung hat –, der Browser holt es parallel zum Dokument, und es
          bleibt zwischenspeicherbar.

          Hat der Betreiber nichts ausgewählt, trägt das Stylesheet Space Grotesk
          und JetBrains Mono ein: genau die zwei Schriften, die vorher von Google
          kamen. Eine unkonfigurierte Instanz sieht danach also unverändert aus.

          Das Merkmal `data-palantir-fonts` findet die Schriftverwaltung wieder,
          um das Stylesheet nach einem Upload neu zu holen (`lib/api/fonts.ts`).
        */}
        {/*
          Kein `preconnect` daneben: Die alten Zeilen brauchten es, weil
          Stylesheet und Schriftdateien auf zwei fremden Hosts lagen, zu denen
          erst eine Verbindung entstehen musste. Beides kommt jetzt von der
          API-Herkunft, die die Seite ohnehin gleich anspricht.
        */}
        <link
          rel="stylesheet"
          href={fontStylesheetUrl()}
          {...{ [FONT_STYLESHEET_LINK_ATTRIBUTE]: 'true' }}
        />
      </head>
      <body className="min-h-screen bg-canvas text-ink antialiased">{children}</body>
    </html>
  );
}
