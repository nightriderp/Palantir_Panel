import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import {
  FONT_ROLES,
  FONT_STYLESHEET_LINK_ATTRIBUTE,
  fontRoleUrl,
  fontStylesheetUrl,
} from '@/lib/api/fonts';
import { fremdeApiHerkunft } from '@/lib/auth/api';
import { THEME_COOKIE } from '@/lib/theme/cookie';
import { STANDARD_THEME_ID, themeFuerId, themesCss } from '@/lib/theme/palette';
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

/**
 * `themeColor` fehlt hier mit Absicht – die Farbe der Browserleiste hängt am
 * gewählten Theme und steht deshalb als eigenes `<meta>` weiter unten.
 *
 * Der vorgesehene Weg wäre `generateViewport()`; der darf zwar `cookies()`
 * lesen, zwingt die Route dann aber unter eine `<Suspense>`-Grenze um das
 * ganze Dokument oder unter `instant = false`
 * (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-viewport.md`).
 * Beides ändert das Navigationsverhalten der gesamten Anwendung – ein hoher
 * Preis für eine Leiste am oberen Bildschirmrand. Ein einzelnes `<meta>` im
 * `<head>` leistet dasselbe und kostet nichts; doppelt steht es nicht, weil
 * `themeColor` hier eben fehlt.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const fremdeHerkunft = fremdeApiHerkunft();

  /*
   * Das gewählte Theme kommt **mit der Anfrage**, nicht erst mit dem ersten
   * Skript (`lib/theme/cookie.ts`). Deshalb steht das Attribut schon im
   * ausgelieferten Dokument und das erste Bild trägt bereits die richtigen
   * Farben – kein Aufblitzen des Standards bei jedem Aufruf.
   *
   * Ein unbekannter Cookie-Wert ergibt den Standard, statt die Seite zu
   * zerlegen; das Cookie ist von außen beschreibbar.
   */
  const thema = themeFuerId((await cookies()).get(THEME_COOKIE)?.value);

  // Oberflächensprache ist laut Lastenheft §4 zunächst ausschließlich Deutsch.
  return (
    /*
     * Der Standard trägt **kein** Attribut: Sein Variablensatz steht auf
     * `:root` und gilt damit auch ohne. So sieht eine Seite ohne jede Wahl
     * genauso aus wie eine mit ausdrücklich gewähltem Standard – und der
     * Umschalter im Browser entfernt das Attribut aus demselben Grund, statt
     * `standard` hineinzuschreiben.
     */
    <html lang="de" data-theme={thema.id === STANDARD_THEME_ID ? undefined : thema.id}>
      <head>
        {/*
          Die Farbvariablen **aller** Themes – zuerst, damit sie stehen, bevor
          irgendeine Regel sie liest.

          Als `<style>` und nicht als eigene Datei: Es sind wenige hundert Byte,
          sie gehören zu genau diesem Dokument (das Attribut am `<html>` und die
          Werte müssen zusammenpassen), und eine zweite Anfrage vor dem ersten
          Bild wäre teurer als der Inhalt.

          Die CSP steht dem nicht im Weg: Sie verlangt eine Nonce für *Skripte*;
          `style-src` lässt `'unsafe-inline'` zu (`lib/csp.ts`), und ein
          Stylesheet ist kein Skript.
        */}
        <style>{themesCss()}</style>

        {/* Farbe der Browserleiste – siehe die Anmerkung an `viewport`. */}
        <meta name="theme-color" content={thema.palette.canvas} />

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

        {/*
          Die zwei tatsächlich benutzten Schriften vorladen.

          Ohne das läuft der Weg zum ersten richtig gesetzten Buchstaben
          **seriell**: Dokument holen, darin das Stylesheet finden, Stylesheet
          holen, darin die `@font-face`-Regel lesen, dann erst die Datei holen.
          Drei Runden nacheinander, und bis zur letzten steht der Text in der
          Ersatzschrift (`font-display: swap`) und springt danach um. Mit dem
          Vorladen startet die Schriftdatei zeitgleich mit dem Stylesheet.

          Möglich ist es nur, weil die Adresse die **Rolle** nennt und nicht
          die Kennung der Schrift: Welche Schrift der Betreiber gewählt hat,
          weiss diese Seite beim Rendern nicht, und es dafür zu erfragen hätte
          die Antwort des Dokuments verzögert – also genau das bezahlt, was
          hier eingespart werden soll.

          ⚠️ `crossOrigin` ist auch dann nötig, wenn die API auf derselben
          Herkunft liegt. Schriften werden immer im CORS-Modus geholt; ohne das
          Attribut lädt der Browser die Datei **zweimal** – einmal für das
          Vorladen, einmal für die Regel – und meldet in der Konsole
          „preloaded but not used".
        */}
        {FONT_ROLES.map((rolle) => (
          <link
            key={rolle}
            rel="preload"
            as="font"
            href={fontRoleUrl(rolle)}
            crossOrigin="anonymous"
          />
        ))}
      </head>
      <body className="min-h-screen bg-canvas text-ink antialiased">{children}</body>
    </html>
  );
}
