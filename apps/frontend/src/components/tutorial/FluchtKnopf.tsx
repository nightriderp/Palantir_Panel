'use client';

import { useState } from 'react';
import { Button, useMediaQuery } from '@/components/shared';
import { fliehtNoch, fluchtText, fluchtVersatz } from './spott';

export interface FluchtKnopfProps {
  /** Der Knopf wurde tatsächlich getroffen – die Einweisung endet. */
  onTreffer: () => void;
  /** Jede geglückte Flucht, mit der neuen Anzahl. Zählt für die Urkunde. */
  onFlucht?: (versuche: number) => void;
}

/**
 * Der „Überspringen"-Knopf, der erst einmal wegläuft.
 *
 * Er rückt bei jeder Annäherung mit dem Zeiger ein Stück zur Seite – vier Mal,
 * dann bleibt er stehen und tut, was draufsteht ({@link fliehtNoch}). Das ist
 * der Scherz; alles Weitere ist die Rücksicht, ohne die er keiner wäre:
 *
 * - **Nur mit feinem Zeiger.** Auf dem Telefon gibt es kein „Darüberfahren";
 *   ein ausweichender Knopf wäre dort schlicht ein Knopf, der nicht geht.
 *   `(pointer: coarse)` schaltet die Flucht ab.
 * - **Nicht bei reduzierter Bewegung.** Wer Animationen abgeschaltet hat, will
 *   keinen springenden Knopf – dieselbe Rücksicht wie überall sonst im Panel.
 * - **Nie vor der Tastatur.** Ausgewichen wird bei `onMouseEnter`, nicht bei
 *   `onFocus`. Wer mit Tabulator kommt, landet direkt darauf; ein Knopf, der
 *   vor dem Fokus flieht, wäre mit der Tastatur nie erreichbar.
 * - **Der Klick zählt immer.** Wer schnell genug ist, hat gewonnen, auch beim
 *   ersten Versuch.
 *
 * Der Platzhalter drumherum hat eine feste Größe und der Knopf liegt
 * absolut darin: So verschiebt die Flucht nichts im Rest der Zeile.
 */
export function FluchtKnopf({ onTreffer, onFlucht }: FluchtKnopfProps) {
  const [versuche, setVersuche] = useState(0);

  const groberZeiger = useMediaQuery('(pointer: coarse)');
  const ruhigeOberflaeche = useMediaQuery('(prefers-reduced-motion: reduce)');
  const beweglich = !groberZeiger && !ruhigeOberflaeche;

  const versatz = fluchtVersatz(versuche);

  function ausweichen(): void {
    if (!beweglich || !fliehtNoch(versuche)) return;

    const naechste = versuche + 1;
    setVersuche(naechste);
    onFlucht?.(naechste);
  }

  return (
    <span className="relative inline-flex h-9 w-48 shrink-0 items-center justify-center">
      <Button
        variant="ghost"
        size="sm"
        className="absolute whitespace-nowrap transition-transform duration-200 ease-out"
        style={{ transform: `translate(${versatz.x}px, ${versatz.y}px)` }}
        onMouseEnter={ausweichen}
        onClick={onTreffer}
      >
        {fluchtText(versuche)}
      </Button>
    </span>
  );
}
