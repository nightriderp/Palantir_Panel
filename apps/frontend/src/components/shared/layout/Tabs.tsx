'use client';

import { type KeyboardEvent, useRef } from 'react';
import { cn } from '../utils/cn';

export interface TabItem<TKey extends string = string> {
  key: TKey;
  label: string;
  /**
   * Reiter gesperrt – z. B. weil das `permissions`-Objekt des DTO die Ansicht
   * nicht freigibt (Pflichtenheft §5.2). Der Reiter bleibt sichtbar, ist aber
   * nicht anwählbar.
   */
  locked?: boolean;
  /** Grund der Sperre, erscheint als Tooltip („Für deine Rolle nicht freigegeben."). */
  lockedReason?: string;
}

export interface TabsProps<TKey extends string = string> {
  items: ReadonlyArray<TabItem<TKey>>;
  activeKey: TKey;
  onChange: (key: TKey) => void;
  className?: string;
}

/**
 * Reiterleiste mit Unterstrich (Server-Detail, Benachrichtigungen, Profil).
 *
 * Scrollt auf schmalen Geräten waagerecht, statt umzubrechen.
 *
 * **Tastatur nach dem WAI-ARIA-Muster** (Review 2026-09-16, Befund 12.6): Die
 * Leiste ist **ein** Tabulator-Halt – nur der aktive Reiter liegt in der
 * Tab-Reihenfolge –, Pfeil links/rechts wechseln den Reiter, Pos1/Ende springen
 * an den Rand. Der Wechsel wählt sofort aus („automatic activation"): Jeder
 * Reiter hier ist ein Ansichtswechsel ohne Kosten, ein Enter obendrauf wäre
 * ein Schritt ohne Gewinn. Gesperrte Reiter werden übersprungen.
 */
export function Tabs<TKey extends string = string>({
  items,
  activeKey,
  onChange,
  className,
}: TabsProps<TKey>) {
  const knoepfe = useRef(new Map<TKey, HTMLButtonElement>());

  function wechsleZu(key: TKey): void {
    onChange(key);
    knoepfe.current.get(key)?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const waehlbar = items.filter((item) => !item.locked);
    if (waehlbar.length === 0) return;

    // Ausgangspunkt ist der Reiter mit dem Fokus, nicht `activeKey`: Der
    // aktive Schlüssel kommt an den Aufrufstellen aus der Adresse und damit
    // erst einen Router-Takt später an. Zwei schnelle Pfeildrücke rechneten
    // sonst beide vom alten Reiter aus und kamen nur einen Schritt weit.
    const mitFokus = waehlbar.findIndex(
      (item) => knoepfe.current.get(item.key) === document.activeElement,
    );
    const aktuell = mitFokus >= 0 ? mitFokus : waehlbar.findIndex((item) => item.key === activeKey);
    let ziel: number;
    switch (event.key) {
      case 'ArrowRight':
        ziel = aktuell < 0 ? 0 : (aktuell + 1) % waehlbar.length;
        break;
      case 'ArrowLeft':
        ziel =
          aktuell < 0 ? waehlbar.length - 1 : (aktuell - 1 + waehlbar.length) % waehlbar.length;
        break;
      case 'Home':
        ziel = 0;
        break;
      case 'End':
        ziel = waehlbar.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    const naechster = waehlbar[ziel];
    if (naechster !== undefined) wechsleZu(naechster.key);
  }

  return (
    <div
      role="tablist"
      onKeyDown={handleKeyDown}
      className={cn('flex gap-1 overflow-x-auto border-b border-line', className)}
    >
      {items.map((item) => {
        const active = item.key === activeKey;
        return (
          <button
            key={item.key}
            ref={(element) => {
              if (element === null) knoepfe.current.delete(item.key);
              else knoepfe.current.set(item.key, element);
            }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            disabled={item.locked}
            title={item.locked ? item.lockedReason : undefined}
            onClick={() => onChange(item.key)}
            className={cn(
              // Die Fläche des Reiters ist der Knopf: breiter Innenabstand statt
              // eines schmalen Worts mit Lücke daneben. Das trifft sich auf dem
              // Telefon besser und gibt der Leiste eine ruhige Kante.
              '-mb-px whitespace-nowrap rounded-t-lg border-b-2 px-4 py-2.5 text-base font-semibold transition-colors',
              active ? 'border-brand text-ink' : 'border-transparent text-ink-muted hover:text-ink',
              item.locked &&
                'cursor-not-allowed border-transparent text-ink-disabled hover:text-ink-disabled',
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
