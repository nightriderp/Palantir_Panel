'use client';

import { type PublicInstanceStatsDto } from '@palantir/contracts';
import { useEffect, useState } from 'react';
import { LogoMark, formatNumber } from '@/components/shared';
import { fetchPublicStats } from '@/lib/api/instance';

/**
 * Markenspalte neben dem Anmeldeformular (Referenz-Mockup, Login-Ansicht).
 *
 * Erscheint erst ab `lg`. Auf dem Smartphone bleibt sie bewusst weg: dort zählt
 * der Weg zum Formular, nicht die Bühne (Lastenheft §4, Mobile-First).
 *
 * Die drei Kennzahlen am Fuß („Spiele", „Tage im Dienst", „Arcade-Partien")
 * kommen aus `/public/stats` – der einzigen Route neben ALTCHA und Health, die
 * ohne Sitzung antwortet (Mockup-Abgleich 2.1). Sie werden erst **nach** dem
 * ersten Rendern geholt: Vorher steht dort nichts, und die Anmeldung wartet
 * nicht auf sie. Antwortet die Route nicht, bleibt die Zeile weg – ein
 * Fehlerhinweis über einer Anmeldemaske hülfe niemandem.
 *
 * **Abweichung vom Mockup:** Der Leitsatz wechselt dort bei jedem Aufruf
 * zufällig. Das fehlt hier: Ein zufälliger Text würde sich zwischen Server- und
 * Client-Darstellung unterscheiden.
 */
export function AuthBrandColumn() {
  return (
    <aside className="relative hidden overflow-hidden bg-surface-deep p-14 lg:flex lg:flex-col lg:justify-between">
      {/* Lichtschein oben rechts, wie im Mockup. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-32 -top-32 h-[460px] w-[460px] rounded-full bg-brand-soft blur-3xl"
      />

      <div className="relative z-10 flex items-center gap-2.5">
        <LogoMark />
        <span className="text-xl font-bold tracking-[0.02em]">Palantir</span>
      </div>

      <div className="relative z-10">
        <div className="mb-6 h-[3px] w-9 rounded-sm bg-brand-gradient" />
        {/* Bewusst kein <h1>: die Hauptüberschrift der Seite ist der Titel des
            Formulars (AuthHeading). Diese Spalte fehlt auf dem Smartphone ganz –
            eine Überschriftsebene, die je nach Breite verschwindet, wäre für
            Screenreader irreführend. */}
        <p className="mb-4.5 max-w-[460px] text-5xl font-bold">Steuere deine Server.</p>
        <p className="max-w-[420px] text-lg leading-relaxed text-ink-muted">
          Ein kleiner Kreis, ein paar Gameserver – und ein Panel, das dir auf einen Blick die
          Wahrheit sagt.
        </p>
      </div>

      <div className="relative z-10 flex flex-col gap-3">
        <InstanceStats />
        <span className="font-mono text-xs text-ink-faint">Palantir · selbst gehostet</span>
      </div>
    </aside>
  );
}

/**
 * Kennzahlen der Instanz, nach dem Laden nachgereicht.
 *
 * Bewusst ohne Ladehinweis: Eine Zeile, die „wird geladen" sagt und danach drei
 * Zahlen zeigt, ist unruhiger als eine, die einfach erscheint.
 */
function InstanceStats() {
  const [stats, setStats] = useState<PublicInstanceStatsDto | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    void fetchPublicStats(controller.signal).then((result) => {
      if (result.success) setStats(result.data);
    });

    return () => controller.abort();
  }, []);

  if (stats === null) {
    return null;
  }

  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-2 font-mono text-xs text-ink-faint">
      <StatEntry
        value={formatNumber(stats.gameTypes)}
        label={stats.gameTypes === 1 ? 'Spiel' : 'Spiele'}
      />
      {stats.daysInService === null ? null : (
        <StatEntry value={formatNumber(stats.daysInService)} label="Tage im Dienst" />
      )}
      <StatEntry value={formatNumber(stats.arcadeRounds)} label="Arcade-Partien" />
    </dl>
  );
}

function StatEntry({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="sr-only">{label}</dt>
      <dd className="flex items-baseline gap-1.5">
        <span className="text-sm font-semibold text-ink-muted">{value}</span>
        <span>{label}</span>
      </dd>
    </div>
  );
}
