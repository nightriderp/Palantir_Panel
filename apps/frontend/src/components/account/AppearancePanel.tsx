'use client';

import { useState } from 'react';
import { Panel } from '@/components/shared';
import { themeAnwenden } from '@/lib/theme/cookie';
import { THEMES, type Theme } from '@/lib/theme/palette';

/**
 * Auswahl des Erscheinungsbilds (Profil).
 *
 * **Warum das Umschalten nichts nachlädt.** Die Variablensätze aller Themes
 * stehen bereits im Dokument (`themesCss()` im Wurzel-Layout). Ein Klick setzt
 * nur `data-theme` am `<html>`-Element um – die Seite wechselt die Farbe
 * augenblicklich und vollständig, ohne Neuladen, ohne Anfrage und ohne einen
 * Zustand dazwischen, in dem die halbe Oberfläche noch alt aussieht.
 *
 * **Warum die Wahl als Eigenschaft hereinkommt.** Welches Theme gilt, weiß der
 * Server (er hat das Cookie gelesen und das Attribut gesetzt). Läse diese
 * Komponente es stattdessen selbst aus dem Dokument, stünde beim Rendern auf
 * dem Server kein Dokument zur Verfügung – die erste Ausgabe zeigte die Marke
 * am Standard, die Hydrierung korrigierte sie, und React meldete zu Recht
 * einen Unterschied.
 */
export function AppearancePanel({ aktiv }: { aktiv: string }) {
  const [gewaehlt, setGewaehlt] = useState(aktiv);

  function waehlen(id: string): void {
    setGewaehlt(id);
    themeAnwenden(id);
  }

  return (
    <Panel>
      <fieldset>
        <legend className="text-xl font-semibold text-ink">Erscheinungsbild</legend>
        <p className="mt-0.5 text-sm text-ink-soft">
          Gilt für dieses Gerät und wirkt sofort. Die Wahl ändert nur Farben – wo etwas steht und
          was es bedeutet, bleibt gleich.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {THEMES.map((thema) => (
            <ThemeOption
              key={thema.id}
              thema={thema}
              gewaehlt={gewaehlt === thema.id}
              onWaehlen={() => waehlen(thema.id)}
            />
          ))}
        </div>
      </fieldset>
    </Panel>
  );
}

/**
 * Eine Kachel der Auswahl: Vorschau, Name, Beschreibung.
 *
 * Ein echtes `<input type="radio">` unter einem `<label>`, nur unsichtbar
 * gestellt. Die Kachel ist damit von Haus aus das, wonach sie aussieht – eine
 * Auswahl aus mehreren: Pfeiltasten wechseln, die Leertaste wählt,
 * Sprachausgaben sagen „2 von 2". Ein `<div>` mit `onClick` müsste jede dieser
 * Eigenschaften einzeln nachbauen, und die Tastaturbedienung wäre die erste,
 * die dabei vergessen wird.
 */
function ThemeOption({
  thema,
  gewaehlt,
  onWaehlen,
}: {
  thema: Theme;
  gewaehlt: boolean;
  onWaehlen: () => void;
}) {
  return (
    <label
      className={[
        'flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors',
        gewaehlt ? 'border-brand bg-brand-soft' : 'border-line bg-fill hover:border-line-strong',
      ].join(' ')}
    >
      <input
        type="radio"
        name="erscheinungsbild"
        value={thema.id}
        checked={gewaehlt}
        onChange={onWaehlen}
        className="sr-only"
      />

      <ThemeVorschau thema={thema} />

      <span className="min-w-0 flex-1">
        <span className="block text-base font-semibold text-ink">{thema.name}</span>
        <span className="mt-0.5 block text-xs text-ink-faint">{thema.beschreibung}</span>
      </span>
    </label>
  );
}

/**
 * Winziges Abbild der Oberfläche in den Farben eines Themes.
 *
 * ⚠️ **Die einzige Stelle, an der Farben als Wert im Markup stehen dürfen.**
 * Die Regel aus `tailwind.config.ts` – keine literalen Farbwerte in
 * Komponenten – zielt darauf, dass niemand eine Farbe am Design-System vorbei
 * festschreibt. Hier ist die Farbe nicht die Gestaltung dieser Komponente,
 * sondern ihr **Inhalt**: Die Vorschau muss ein Theme zeigen, das gerade nicht
 * gilt, und dessen Tokens gibt es als Klassen nicht. Die Werte kommen
 * unverändert aus der Palette; abgeschrieben ist keiner.
 */
function ThemeVorschau({ thema }: { thema: Theme }) {
  const { canvas, surfaceCard, ink, brand, accent, success, danger } = thema.palette;

  return (
    <span
      aria-hidden
      className="flex h-11 w-14 shrink-0 flex-col justify-between rounded-lg border border-line p-1.5"
      style={{ background: canvas }}
    >
      {/* Eine Karte mit Titelzeile … */}
      <span
        className="flex items-center gap-1 rounded-sm px-1 py-0.5"
        style={{ background: surfaceCard }}
      >
        <span className="h-1 w-1 rounded-full" style={{ background: success }} />
        <span className="h-0.5 flex-1 rounded-full" style={{ background: ink, opacity: 0.55 }} />
      </span>

      {/* … und die Farbpunkte, an denen man ein Theme wiedererkennt. */}
      <span className="flex gap-1">
        {[brand, accent, danger].map((farbe) => (
          <span key={farbe} className="h-1.5 w-1.5 rounded-full" style={{ background: farbe }} />
        ))}
      </span>
    </span>
  );
}
