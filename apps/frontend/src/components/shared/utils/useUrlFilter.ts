'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Filter und Suche in der Adresszeile (Fundpunkt 213).
 *
 * Am laufenden System gemessen: Wer in der Übersicht auf „Offline" klickte und
 * „welt" in die Suche tippte, sah danach dieselbe Adresse wie vorher. Der
 * Zustand ließ sich niemandem schicken, ein Neuladen warf ihn weg, und der
 * Zurück-Knopf des Browsers sprang an der Auswahl vorbei auf die vorige Seite.
 *
 * **Warum `window.history` und nicht `useRouter().replace()`.** Ein
 * Router-Aufruf lässt Next die Route neu rendern – bei jedem getippten
 * Buchstaben. `history.replaceState` schreibt die Adresse, ohne die Seite
 * anzufassen; die Ansicht hält ihren Zustand ohnehin selbst. Aus demselben
 * Grund wie bei {@link useHighlight} steht hier kein `useSearchParams()`: Es
 * zöge jede Seite, die einen Filter hat, in eine Suspense-Grenze.
 *
 * **`replaceState`, nicht `pushState`.** Jeder Tastendruck ein Eintrag im
 * Verlauf wäre die schlechtere Wahl: Der Zurück-Knopf müsste sich dann durch
 * das getippte Wort zurückarbeiten. Geteilt und neu geladen wird trotzdem
 * genau das, was auf dem Bildschirm steht.
 *
 * Der Anfangswert kommt beim ersten Rendern **nicht** aus der Adresse: Server
 * und Browser müssen dasselbe rendern, sonst meckert React über die
 * Hydratation. Der Wert aus der Adresse wird direkt danach nachgezogen.
 */
export function useUrlFilter<T extends string>(
  /** Name des Abfrageparameters, z. B. `filter` oder `q`. */
  param: string,
  /** Wert, der **nicht** in der Adresse steht – der Normalfall der Ansicht. */
  standard: T,
  /**
   * Prüft einen Wert aus der Adresse. Ohne Prüfung landet dort, was jemand
   * hineinschreibt: Ein `?filter=<script>` gehört nicht in den Zustand einer
   * Ansicht, auch wenn React ihn nicht ausführt.
   */
  istGueltig: (wert: string) => wert is T,
): [T, (wert: T) => void] {
  const [wert, setWert] = useState<T>(standard);

  useEffect(() => {
    const ausAdresse = new URLSearchParams(window.location.search).get(param);

    if (ausAdresse !== null && istGueltig(ausAdresse)) {
      setWert(ausAdresse);
    }
    // Absichtlich nur beim ersten Rendern: Danach führt die Ansicht den Wert,
    // und ein erneutes Lesen würde eine gerade getippte Eingabe überschreiben.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setzen = useCallback(
    (naechster: T) => {
      setWert(naechster);

      const adresse = new URL(window.location.href);

      if (naechster === standard || naechster === '') {
        adresse.searchParams.delete(param);
      } else {
        adresse.searchParams.set(param, naechster);
      }

      window.history.replaceState(null, '', `${adresse.pathname}${adresse.search}`);
    },
    [param, standard],
  );

  return [wert, setzen];
}

/** Prüfung für ein freies Textfeld: alles ist erlaubt, aber nicht endlos. */
export function istSuchbegriff(wert: string): wert is string {
  return wert.length <= 120;
}
