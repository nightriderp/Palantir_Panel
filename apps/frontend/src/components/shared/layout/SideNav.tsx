'use client';

import Link, { useLinkStatus } from 'next/link';
import { type ServerStatus } from '@palantir/contracts';
import { CountBadge, StatusDot } from '../primitives/Badge';
import { Icon, type IconName } from '../icons/Icon';
import { Spinner } from '../primitives/Spinner';
import { serverStatusMeta } from '../server/serverStatus';
import { cn } from '../utils/cn';

/**
 * Ein Eintrag der Seitenleiste.
 *
 * **Kein `onSelect`** (Fundpunkt 166): Die mobile Schublade schließt sich schon
 * eine Ebene höher. `AppShell` legt den Klick-Fänger um den ganzen Behälter der
 * Seitenleiste, und jeder Klick auf einen Eintrag blubbert dorthin – auch der
 * eines Tastaturnutzers, der mit Eingabe auslöst. Ein zweiter Weg hier war nie
 * gesetzt und hätte dasselbe doppelt getan.
 */
export interface SideNavItem {
  key: string;
  label: string;
  icon: IconName;
  /**
   * Ziel-Route – Pflicht (Fundpunkt 159).
   *
   * Bis dahin war sie optional, und Einträge ohne Ziel wurden als `<button>`
   * gerendert. Seit die Hauptnavigation ein Ziel verlangt (Fundpunkt 155,
   * `DashboardNav.tsx`), ging diesen Weg niemand mehr – ein Eintrag, der
   * nirgendwohin führt, gehört gar nicht erst in die Liste.
   */
  href: string;
  active?: boolean;
  /** Zähler rechts im Eintrag (z. B. ungelesene Nachrichten). */
  badgeCount?: number;
  /**
   * Marke für den Rundgang (`components/tutorial`), landet als
   * `data-rundgang` am Link.
   *
   * Bewusst ein Attribut und keine Klasse: Der Rundgang leuchtet echte
   * Bedienelemente an, und er soll sie über etwas finden, das beim Umbauen
   * mitwandert – eine Gestaltungsklasse wäre beim nächsten Feinschliff weg.
   */
  tourId?: string;
}

export interface SideNavSectionProps {
  /** Überschrift der Gruppe, z. B. „Administration". Ohne Angabe ohne Überschrift. */
  title?: string;
  /** Zusatz rechts neben der Überschrift, z. B. die Anzahl eigener Server. */
  titleAside?: string;
  items: readonly SideNavItem[];
  className?: string;
}

/**
 * Gruppe von Navigationseinträgen in der Seitenleiste.
 *
 * Welche Einträge überhaupt übergeben werden, entscheidet das aufrufende Paket
 * anhand der Berechtigungen aus dem DTO – die Navigation filtert nicht selbst.
 * Jeder Eintrag führt zu einer Route, also ist jede Zeile ein Link
 * (Fundpunkt 159).
 */
/** Überschrift einer Gruppe – gleich für Einträge und Serverliste. */
function SectionHeading({ title, aside }: { title: string; aside?: string }) {
  return (
    <div className="mt-4.5 flex items-center justify-between px-2.5 pb-1">
      <span className="text-2xs uppercase tracking-[0.1em] text-ink-soft">{title}</span>
      {aside ? <span className="font-mono text-2xs text-ink-faint">{aside}</span> : null}
    </div>
  );
}

/**
 * Das Symbol eines Eintrags – oder ein Spinner, solange dessen Seite lädt.
 *
 * `useLinkStatus` gibt es nur **innerhalb** eines `<Link>`, deshalb diese
 * eigene kleine Komponente statt einer Abfrage in der Zeile selbst.
 *
 * Sie schließt die letzte Lücke des Seitenwechsels: Das Ladebild
 * (`(dashboard)/loading.tsx`) sagt „im Inhaltsbereich passiert etwas", aber
 * nicht, **welcher** Eintrag gerade angeklickt wurde. Der Spinner sitzt an der
 * Stelle des Symbols und ist damit genau dort, wo der Zeiger gerade war.
 */
function EintragSymbol({ icon }: { icon: IconName }) {
  const { pending } = useLinkStatus();

  return pending ? <Spinner size={16} /> : <Icon name={icon} size={16} />;
}

/**
 * Grundoptik jeder Zeile der Seitenleiste – Abschnitte **und** Server.
 *
 * ⚠️ `border-l-2` steht in der **Grundlage**, nicht nur am aktiven Eintrag.
 * Vorher bekam die Kante nur der aktive Eintrag, und weil ein Rahmen Platz
 * einnimmt, rutschte bei jedem Seitenwechsel die Beschriftung der neuen Zeile
 * um zwei Pixel nach rechts und die der alten wieder zurück. Auf der
 * meistbenutzten Fläche der Oberfläche war das ein sichtbares Zucken. Mit der
 * Kante in der Grundlage und `border-transparent` im Ruhezustand ist der Platz
 * immer belegt; sichtbar wird nur die Farbe.
 *
 * `transition-colors` gehört dazu: Ohne die Angabe springen Text- und
 * Flächenfarbe hart um, und genau dieses Springen unterscheidet eine
 * Oberfläche, die reagiert, von einer, die nur umschaltet.
 */
const ZEILE_BASIS =
  'flex items-center gap-2.5 rounded-tile border-l-2 px-2.5 text-base transition-colors';

/** Ruhe- und Hover-Zustand einer nicht aktiven Zeile. */
const ZEILE_RUHEND = 'border-transparent text-ink-muted hover:bg-fill hover:text-ink';

/** Aktive Zeile: farbige Kante, getönte Fläche. */
const ZEILE_AKTIV = 'border-brand bg-brand-soft text-white';

export function SideNavSection({ title, titleAside, items, className }: SideNavSectionProps) {
  return (
    <div className={cn('flex flex-col gap-0.5', className)}>
      {title ? <SectionHeading title={title} aside={titleAside} /> : null}

      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          data-rundgang={item.tourId}
          aria-current={item.active ? 'page' : undefined}
          className={cn(ZEILE_BASIS, 'py-2.5', item.active ? ZEILE_AKTIV : ZEILE_RUHEND)}
        >
          <EintragSymbol icon={item.icon} />
          <span className="flex-1 truncate text-left">{item.label}</span>
          {item.badgeCount ? <CountBadge count={item.badgeCount} /> : null}
        </Link>
      ))}
    </div>
  );
}

export interface SideNavServerItem {
  id: string;
  name: string;
  /** Kürzel für die Kachel vor dem Namen (`serverInitials`). */
  initials: string;
  status: ServerStatus;
  href: string;
  active?: boolean;
}

export interface SideNavServerSectionProps {
  /** Überschrift der Gruppe, im Mockup „Deine Server". */
  title: string;
  items: readonly SideNavServerItem[];
  className?: string;
}

/**
 * Eigene Server als Sprungziele in der Seitenleiste (Mockup „Deine Server").
 *
 * Eigene Komponente statt eines `SideNavSection`-Eintrags: die Zeile zeigt
 * Kürzel-Kachel und Zustandspunkt statt eines Symbols, und der Zustand kommt
 * aus `serverStatusMeta` – damit dieselbe Farbe und dasselbe Pulsieren gelten
 * wie auf der Server-Karte.
 *
 * Ohne Server rendert die Gruppe nichts, damit bei einem frischen Konto keine
 * leere Überschrift stehen bleibt.
 */
export function SideNavServerSection({ title, items, className }: SideNavServerSectionProps) {
  if (items.length === 0) return null;

  return (
    <div className={cn('flex flex-col gap-0.5', className)}>
      <SectionHeading title={title} aside={String(items.length)} />

      {items.map((item) => {
        const meta = serverStatusMeta(item.status);

        return (
          <Link
            key={item.id}
            href={item.href}
            aria-current={item.active ? 'page' : undefined}
            className={cn(ZEILE_BASIS, 'py-2', item.active ? ZEILE_AKTIV : ZEILE_RUHEND)}
          >
            <span
              aria-hidden
              className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-sm bg-brand-gradient text-3xs font-bold text-canvas"
            >
              {item.initials}
            </span>
            <span className="flex-1 truncate text-left">{item.name}</span>
            <StatusDot tone={meta.tone} pulse={meta.pulse} className="shrink-0" />
            <span className="sr-only">{meta.label}</span>
          </Link>
        );
      })}
    </div>
  );
}
