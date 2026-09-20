'use client';

import { useEffect, useState } from 'react';
import { Button, IconButton } from '../primitives/Button';

export interface DeployBannerProps {
  /** Version, mit der diese Seite ausgeliefert wurde (Server-seitig gesetzt). */
  current: string;
  /** Abstand zwischen zwei Nachfragen in Millisekunden. */
  intervalMs?: number;
}

/** Vorgabe: einmal pro Minute. Ein Deployment dauert länger als das. */
const DEFAULT_INTERVAL_MS = 60_000;

/**
 * Hinweis, dass das Panel inzwischen in einer neueren Version ausgeliefert wird.
 *
 * Nach einem Deployment läuft in offenen Browsern weiter das alte Frontend
 * gegen die neue API. Das geht so lange gut, bis ein Feld hinzukommt oder ein
 * Pfad sich ändert – und äußert sich dann als Fehler, den ein Neuladen
 * auflöst, aber niemand darauf kommt. Der Balken sagt es geradeheraus.
 *
 * Der Vergleich läuft über die Version, mit der **diese Seite** geladen wurde,
 * gegen die, die der Server gerade ausliefert (`GET /fassung`). Ein Neuladen
 * holt beides in Übereinstimmung.
 *
 * In der Entwicklung passiert nichts: Dort steht auf beiden Seiten
 * „Entwicklung", und der Balken erscheint nie.
 */
export function DeployBanner({ current, intervalMs = DEFAULT_INTERVAL_MS }: DeployBannerProps) {
  const [neueVersion, setNeueVersion] = useState<string | null>(null);
  const [weggeklickt, setWeggeklickt] = useState<string | null>(null);

  useEffect(() => {
    let abgebrochen = false;

    async function pruefe(): Promise<void> {
      try {
        const antwort = await fetch('/fassung', { cache: 'no-store' });
        if (!antwort.ok) return;

        const daten = (await antwort.json()) as { release?: unknown };
        const gemeldet = typeof daten.release === 'string' ? daten.release : null;

        // Nur eine *andere* Version ist eine Nachricht. Ein Netzfehler oder
        // eine unbrauchbare Antwort ist keine – dann bleibt der Balken weg,
        // statt einen Neustart zu behaupten, den es nicht gab.
        if (!abgebrochen && gemeldet !== null && gemeldet !== current) {
          setNeueVersion(gemeldet);
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

  // Weggeklickt gilt für genau diese Version: Erscheint später eine noch
  // neuere, meldet sich der Hinweis wieder. Ein „nie wieder" gibt es nicht -
  // eine veraltete Seite bleibt ein Problem, auch wenn man es wegwischt.
  if (neueVersion === null || weggeklickt === neueVersion) return null;

  return (
    /*
      Schwebende Karte unten rechts statt eines Balkens über der ganzen Seite.
      Der Balken schob bei jedem Deployment den gesamten Inhalt nach unten -
      mitten in die Arbeit hinein. Die Karte legt sich daneben, bleibt sichtbar
      und lässt sich wegklicken; auf dem Telefon nimmt sie die volle Breite.
    */
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-3 bottom-3 z-40 animate-fade-up sm:inset-x-auto sm:right-5 sm:bottom-5 sm:w-[22rem]"
    >
      <div className="flex flex-col gap-3 rounded-2xl border border-brand-line bg-surface/95 p-4 shadow-panel backdrop-blur">
        <div className="flex items-start gap-3">
          {/*
            Der pulsierende Punkt ist dieselbe Sprache wie am laufenden Server:
            hier ist gerade etwas passiert. Er ersetzt das Download-Symbol -
            heruntergeladen wird nichts, die neue Version liegt schon bereit.
          */}
          <span className="mt-1 flex h-2 w-2 shrink-0 animate-pulse-dot rounded-full bg-brand shadow-glow" />
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold text-ink">Neue Version verfügbar</p>
            <p className="mt-1 text-sm text-ink-muted">
              Diese Seite läuft noch mit{' '}
              <span className="rounded bg-fill px-1.5 py-0.5 font-mono text-xs text-ink-soft">
                {current}
              </span>
              , ausgeliefert wird{' '}
              <span className="rounded bg-brand-soft px-1.5 py-0.5 font-mono text-xs text-brand">
                {neueVersion}
              </span>
              .
            </p>
          </div>
          <IconButton
            icon="close"
            label="Hinweis schließen"
            size="sm"
            onClick={() => {
              setWeggeklickt(neueVersion);
            }}
          />
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            className="flex-1"
            onClick={() => window.location.reload()}
          >
            Jetzt neu laden
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setWeggeklickt(neueVersion);
            }}
          >
            Später
          </Button>
        </div>
      </div>
    </div>
  );
}
