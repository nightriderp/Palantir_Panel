import Link from 'next/link';
import { LogoMark } from '@/components/shared';

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
 */
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-canvas bg-app-glow px-5 text-center">
      <LogoMark size={44} />

      <div className="flex flex-col gap-2">
        <p className="font-mono text-sm uppercase tracking-[0.14em] text-ink-faint">Fehler 404</p>
        <h1 className="text-2xl font-bold text-ink">Diese Seite gibt es nicht</h1>
        <p className="mx-auto max-w-md text-base text-ink-muted">
          Vielleicht ist der Link veraltet oder es hat sich ein Tippfehler in die Adresse
          eingeschlichen. Die Übersicht führt zurück zu deinen Servern.
        </p>
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
