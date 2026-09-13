'use client';

import { useEffect, useState } from 'react';
import { Button } from '../primitives/Button';
import { Icon } from '../icons/Icon';

export interface DeployBannerProps {
  /** Fassung, mit der diese Seite ausgeliefert wurde (Server-seitig gesetzt). */
  current: string;
  /** Abstand zwischen zwei Nachfragen in Millisekunden. */
  intervalMs?: number;
}

/** Vorgabe: einmal pro Minute. Ein Deployment dauert länger als das. */
const DEFAULT_INTERVAL_MS = 60_000;

/**
 * Hinweis, dass das Panel inzwischen in einer neueren Fassung ausgeliefert wird.
 *
 * Nach einem Deployment läuft in offenen Browsern weiter das alte Frontend
 * gegen die neue API. Das geht so lange gut, bis ein Feld hinzukommt oder ein
 * Pfad sich ändert – und äußert sich dann als Fehler, den ein Neuladen
 * auflöst, aber niemand darauf kommt. Der Balken sagt es geradeheraus.
 *
 * Der Vergleich läuft über die Fassung, mit der **diese Seite** geladen wurde,
 * gegen die, die der Server gerade ausliefert (`GET /fassung`). Ein Neuladen
 * holt beides in Übereinstimmung.
 *
 * In der Entwicklung passiert nichts: Dort steht auf beiden Seiten
 * „Entwicklung", und der Balken erscheint nie.
 */
export function DeployBanner({ current, intervalMs = DEFAULT_INTERVAL_MS }: DeployBannerProps) {
  const [neueFassung, setNeueFassung] = useState<string | null>(null);

  useEffect(() => {
    let abgebrochen = false;

    async function pruefe(): Promise<void> {
      try {
        const antwort = await fetch('/fassung', { cache: 'no-store' });
        if (!antwort.ok) return;

        const daten = (await antwort.json()) as { release?: unknown };
        const gemeldet = typeof daten.release === 'string' ? daten.release : null;

        // Nur eine *andere* Fassung ist eine Nachricht. Ein Netzfehler oder
        // eine unbrauchbare Antwort ist keine – dann bleibt der Balken weg,
        // statt einen Neustart zu behaupten, den es nicht gab.
        if (!abgebrochen && gemeldet !== null && gemeldet !== current) {
          setNeueFassung(gemeldet);
        }
      } catch {
        // Absicht: Ein misslungener Abruf darf die Seite nicht stören.
      }
    }

    void pruefe();
    const timer = window.setInterval(() => void pruefe(), intervalMs);
    return () => {
      abgebrochen = true;
      window.clearInterval(timer);
    };
  }, [current, intervalMs]);

  if (neueFassung === null) return null;

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-3 border-b border-brand-line bg-brand-soft px-4 py-2.5 text-sm md:px-7"
    >
      <Icon name="download" size={14} className="shrink-0 text-brand" />
      <span className="min-w-0 flex-1">
        Das Panel läuft jetzt in <span className="font-mono text-brand">{neueFassung}</span> – diese
        Seite zeigt noch <span className="font-mono text-ink-muted">{current}</span>.
      </span>
      <Button size="sm" variant="primary" onClick={() => window.location.reload()}>
        Neu laden
      </Button>
    </div>
  );
}
