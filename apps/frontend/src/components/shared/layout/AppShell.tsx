'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from '../icons/Icon';
import { LogoMark } from '../icons/LogoMark';
import { cn } from '../utils/cn';

export interface AppShellProps {
  /** Inhalt der Seitenleiste – üblicherweise mehrere `SideNavSection`. */
  sidebar: ReactNode;
  /** Rechter Teil der Kopfleiste (Glocke, Nutzermenü, Gesamtstatus). */
  topbar?: ReactNode;
  /** Fußzeile der Seitenleiste, z. B. die Versionsangabe. */
  sidebarFooter?: ReactNode;
  /** Warnstreifen unter der Kopfleiste, z. B. der Gast-Hinweis. */
  banner?: ReactNode;
  /** Seitenkopf (`PageHeader`) – bleibt beim Scrollen des Inhalts stehen. */
  header?: ReactNode;
  children: ReactNode;
}

/**
 * Ziel des Sprunglinks – dasselbe Wort steht im `id`-Attribut des Inhalts.
 */
const INHALT_ID = 'inhalt';

/**
 * Seitenrahmen des eingeloggten Bereichs: Seitenleiste, Kopfleiste, Inhalt.
 *
 * Mobile-First (Lastenheft §4): unterhalb von 768px verschwindet die
 * Seitenleiste und wird über die Menü-Schaltfläche als Schublade eingeblendet.
 * Ab `md` steht sie dauerhaft daneben.
 *
 * **Sprung zum Inhalt** (Fundpunkt 217, WCAG 2.4.1): Gemessen waren es 22
 * Tabulatorschritte durch Navigation und Kopfleiste, bevor der eigentliche
 * Inhalt an der Reihe war – auf jeder Seite neu. Der erste Tabulatorschritt
 * blendet jetzt einen Sprunglink ein; sichtbar wird er nur, solange er den
 * Fokus hat.
 *
 * Die Kopfleiste ist ein `<header>` und der Inhalt trägt eine `id`: Erst damit
 * kann eine Vorlesehilfe die Bereiche überhaupt anspringen.
 */
export function AppShell({
  sidebar,
  topbar,
  sidebarFooter,
  banner,
  header,
  children,
}: AppShellProps) {
  const [navOpen, setNavOpen] = useState(false);

  // Escape schließt die mobile Schublade.
  useEffect(() => {
    if (!navOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setNavOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [navOpen]);

  return (
    <div className="flex h-screen overflow-hidden bg-canvas bg-app-glow">
      {/*
        Erster Tabulatorschritt der Seite. `sr-only` hält ihn aus der Anzeige,
        `focus:not-sr-only` holt ihn zurück, sobald er den Fokus hat.
      */}
      <a
        href={`#${INHALT_ID}`}
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:border focus:border-brand-line focus:bg-surface focus:px-4 focus:py-2 focus:text-base focus:text-ink"
      >
        Zum Inhalt springen
      </a>

      {navOpen ? (
        <div
          aria-hidden
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
        />
      ) : null}

      <nav
        aria-label="Hauptnavigation"
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex h-screen w-[250px] shrink-0 flex-col border-r border-line bg-surface-deep/95 backdrop-blur-[10px] transition-transform md:static md:translate-x-0 md:bg-surface-deep/65',
          navOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-16 items-center justify-between gap-2.5 border-b border-line px-5">
          <span className="flex items-center gap-2.5">
            <LogoMark />
            <span className="text-2xl font-bold tracking-[0.02em] text-ink">Palantir</span>
          </span>
          <button
            type="button"
            onClick={() => setNavOpen(false)}
            aria-label="Navigation schließen"
            className="text-ink-muted hover:text-ink md:hidden"
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        <div
          className="flex-1 overflow-y-auto p-3"
          onClick={() => setNavOpen(false)}
          role="presentation"
        >
          {sidebar}
        </div>

        {sidebarFooter ? (
          <div className="border-t border-line px-5 py-3.5">{sidebarFooter}</div>
        ) : null}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="relative z-20 flex min-h-16 shrink-0 flex-wrap items-center gap-4 border-b border-line bg-surface-deep/75 px-5 py-2">
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            aria-label="Navigation öffnen"
            aria-expanded={navOpen}
            className="text-ink md:hidden"
          >
            <Icon name="menu" size={22} />
          </button>
          {topbar}
        </header>

        {banner}
        {header}

        <main id={INHALT_ID} tabIndex={-1} className="flex-1 overflow-y-auto p-5">
          {children}
        </main>
      </div>
    </div>
  );
}
