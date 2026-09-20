import type { Metadata, Viewport } from 'next';
import { FONT_STYLESHEET_LINK_ATTRIBUTE, fontStylesheetUrl } from '@/lib/api/fonts';
import { fremdeApiHerkunft } from '@/lib/auth/api';
import './globals.css';

/**
 * Jede Seite dynamisch rendern: Die Content-Security-Policy trägt eine Nonce je
 * Anfrage (`src/proxy.ts`, `lib/csp.ts`), und Next.js kann sie nur beim
 * Rendern zur Anfrage an seine Skripte hängen – eine beim Bau vorgerenderte
 * Seite hätte keine und würde von ihrer eigenen Regel blockiert. Der
 * eingeloggte Bereich war ohnehin dynamisch; das hier holt die Anmelde-Seiten
 * und die Fehlerseiten nach.
 */
export const dynamic = 'force-dynamic';

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
  const fremdeHerkunft = fremdeApiHerkunft();

  // Oberflächensprache ist laut Lastenheft §4 zunächst ausschließlich Deutsch.
  return (
    <html lang="de">
      <head>
        {/*
          Verbindung zur API vorziehen – **nur**, wenn sie woanders liegt als
          die Seite (siehe `fremdeApiHerkunft`).

          Unten steht, warum hier früher kein `preconnect` stand: „Beides kommt
          jetzt von der API-Herkunft, die die Seite ohnehin gleich anspricht."
          Das stimmt für gewöhnliche Abrufe – die laufen, wenn die Seite längst
          steht. Das Schrift-Stylesheet ist der Sonderfall: Es **blockiert das
          erste Bild**. Liegt die API auf einem zweiten Host, warten DNS, TCP
          und TLS vor dem ersten sichtbaren Buchstaben, und niemand spricht
          diesen Host vorher an.

          Im Regelfall – API unter `<Domain>/api` – ist `fremdeHerkunft` `null`
          und hier steht nichts: Ein `preconnect` auf die eigene Herkunft wäre
          eine Zeile ohne Wirkung.
        */}
        {fremdeHerkunft === null ? null : (
          <link rel="preconnect" href={fremdeHerkunft} crossOrigin="anonymous" />
        )}
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
          Hier stand: „Kein `preconnect` daneben … beides kommt jetzt von der
          API-Herkunft, die die Seite ohnehin gleich anspricht." Der Satz galt
          nur, solange man die API-Herkunft gleich anspricht, **bevor** dieser
          `<link>` das Bild aufhält – und das tut sie nicht. Der `preconnect`
          steht deshalb wieder oben, aber nur für den Fall, dass die API
          tatsächlich woanders liegt.
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
