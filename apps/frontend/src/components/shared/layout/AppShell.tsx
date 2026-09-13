'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../icons/Icon';
import { LogoMark } from '../icons/LogoMark';
import { cn } from '../utils/cn';
import { useDrawerDrag, useMediaQuery } from './useDrawerDrag';

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
 * Breite der Schublade in Bildpunkten – dieselbe Zahl wie `w-[250px]` unten.
 *
 * Sie steht hier als Zahl, weil die Geste rechnet: Sie ist die Strecke
 * zwischen „ganz offen" und „ganz zu". Wer die Klasse ändert, ändert sie hier
 * mit.
 */
const DRAWER_WIDTH = 250;

/** Unterhalb dieser Breite ist die Seitenleiste eine Schublade (Tailwind `md`). */
const MOBILE_QUERY = '(max-width: 767px)';

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
  const panelRef = useRef<HTMLElement | null>(null);
  const scrimRef = useRef<HTMLDivElement | null>(null);

  /*
   * Die Geste gilt nur auf dem Telefon. Ab `md` ist die Seitenleiste eine feste
   * Spalte, und ein Zug daran hätte nichts zu verschieben.
   */
  const mobil = useMediaQuery(MOBILE_QUERY);
  const drag = useDrawerDrag({
    open: navOpen,
    onClose: () => setNavOpen(false),
    panelRef,
    scrimRef,
    width: DRAWER_WIDTH,
    enabled: mobil,
  });

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

      {/*
        Der Schleier bleibt stehen, auch wenn die Schublade zu ist: Während
        eines Zuges wird seine Deckkraft von der Geste gesetzt (siehe
        `useDrawerDrag`), und ein Element, das erst beim Öffnen entsteht, hätte
        dafür nichts zum Anfassen. Geschlossen ist er durchsichtig und nimmt
        keine Klicks an.
      */}
      <div
        ref={scrimRef}
        aria-hidden
        onClick={() => setNavOpen(false)}
        className={cn(
          'fixed inset-0 z-40 bg-black/50 transition-opacity md:hidden',
          navOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />

      <nav
        ref={panelRef}
        aria-label="Hauptnavigation"
        onPointerDown={drag.onPointerDown}
        onPointerMove={drag.onPointerMove}
        onPointerUp={drag.onPointerUp}
        onPointerCancel={drag.onPointerUp}
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex h-screen w-[250px] shrink-0 touch-pan-y flex-col border-r border-line bg-surface-deep/95 backdrop-blur-[10px] md:static md:translate-x-0 md:bg-surface-deep/65',
          // Der Übergang gilt nur ab `md`: Auf dem Telefon führt die Geste den
          // Transform Bild für Bild selbst, und eine CSS-Dauer daneben würde
          // ihn gegen den Finger verzögern.
          'md:transition-transform',
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
