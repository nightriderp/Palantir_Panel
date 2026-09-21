import Link from 'next/link';
import { cookies } from 'next/headers';
import { LogoMark } from '@/components/shared';
import { THEME_COOKIE } from '@/lib/theme/cookie';
import { themeFuerId } from '@/lib/theme/palette';
import { spruch } from '@/lib/theme/sprueche';

/**
 * Eigene 404-Seite (Fundpunkt 218).
 *
 * Vorher erschien die Standardseite von Next.js: schwarze Schrift auf Weiß,
 * englischer Text, kein Bezug zum Panel – wer sich vertippte, landete auf einer
 * Seite, die aussah, als sei die Anwendung selbst kaputt.
 *
 * Bewusst **ohne** den Seitenrahmen (`AppShell`): Diese Seite greift auch, wenn
 * niemand angemeldet ist, und eine Navigation zu Bereichen, die dann alle auf
 * die Anmeldung umleiten, wäre eine Einladung ins Leere. Zwei Wege genügen:
 * zurück zur Übersicht (dort landet ein angemeldetes Konto) oder zur Anmeldung.
 *
 * Serverseitig gerendert, deshalb ohne `'use client'` – die Seite braucht
 * weder Zustand noch Sitzung.
 *
 * **Den Spruch holt sie sich selbst.** Der Kontext aus dem Wurzel-Layout
 * (`SpruchProvider`) erreicht sie nicht: Er ist ein Hook, und Hooks gibt es in
 * Server-Komponenten nicht. Statt die Seite dafür zur Client-Komponente zu
 * machen – für eine Überschrift und zwei Links – liest sie dieselbe Quelle
 * direkt, nämlich das Cookie. Dass `not-found` dafür `async` sein darf, steht
 * in `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/not-found.md`
 * unter „Data Fetching".
 *
 * Die Zeile „Fehler 404" darüber bleibt in jedem Theme, wie sie ist: Sie ist
 * eine technische Angabe und kein Spruch – wer sie in eine Suchmaschine
 * eingibt oder weitergibt, soll überall dasselbe vorfinden.
 */
export default async function NotFound() {
  const thema = themeFuerId((await cookies()).get(THEME_COOKIE)?.value);
  const { titel, text } = spruch(thema.id, 'nichtGefunden');

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-canvas bg-app-glow px-5 text-center">
      <LogoMark size={44} />

      <div className="flex flex-col gap-2">
        <p className="font-mono text-sm uppercase tracking-[0.14em] text-ink-faint">Fehler 404</p>
        <h1 className="text-2xl font-bold text-ink">{titel}</h1>
        <p className="mx-auto max-w-md text-base text-ink-muted">{text}</p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-md bg-brand px-4 py-2.5 text-base font-semibold text-canvas hover:bg-brand-bright"
        >
          Zur Übersicht
        </Link>
        <Link
          href="/login"
          className="inline-flex items-center justify-center rounded-md border border-line-strong px-4 py-2.5 text-base font-semibold text-ink hover:border-brand-line"
        >
          Zur Anmeldung
        </Link>
      </div>
    </main>
  );
}
