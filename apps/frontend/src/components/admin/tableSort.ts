'use client';

import { useCallback, useMemo } from 'react';
import { useUrlFilter } from '@/components/shared';

/**
 * Sortierung und Seitenteilung der Admin-Tabellen (Fundpunkt 212).
 *
 * Am laufenden System gemessen: Keine der Tabellen ließ sich sortieren, und
 * keine teilte sich in Seiten. Bei einer Handvoll Zeilen fällt das nicht auf;
 * bei zweihundert Konten ist „wer ist zuletzt dazugekommen" eine Frage, die
 * niemand mehr beantworten kann, ohne die ganze Liste durchzusehen.
 *
 * **Warum im Browser und nicht in der Datenbank.** Die Listen kommen bereits
 * vollständig (die Nutzerliste holt bis zu 200 Zeilen, die Speicherübersicht
 * einen fertigen Schnappschuss). Solange das so ist, wäre eine Sortierung über
 * die Route ein zweiter Weg zu denselben Daten – mit Vertrag, Parametern und
 * einer zweiten Stelle, an der die Reihenfolge entsteht. Wächst eine Liste über
 * das, was ein Abruf trägt, gehört beides ins Backend; das steht als eigener
 * Punkt (Seitenteilung der Serverliste, Fundpunkt 231).
 *
 * Die Auswahl steht in der Adresse (`?sort=name&dir=desc&seite=2`), damit sie
 * denselben Weg nimmt wie Filter und Suche: teilbar, neu ladbar, mit
 * Zurück-Knopf.
 *
 * Stehen **zwei** Tabellen auf einer Seite (Sicherungen: je eine für Konten und
 * für Server), bekommt die zweite ein `praefix`. Ohne das schrieben beide in
 * dasselbe `?sort=` und stellten sich gegenseitig um.
 */

export type SortRichtung = 'asc' | 'desc';

export interface TabellenSortierung<TSchluessel extends string> {
  readonly schluessel: TSchluessel;
  readonly richtung: SortRichtung;
  /** Klick auf eine Kopfzelle: dieselbe Spalte dreht die Richtung um. */
  umschalten(schluessel: TSchluessel): void;
  /** `aria-sort`-Wert für die Kopfzelle dieser Spalte. */
  ariaSort(schluessel: TSchluessel): 'ascending' | 'descending' | 'none';
  /** Sortiert eine Liste nach der aktuellen Auswahl. */
  sortiere<TZeile>(
    zeilen: readonly TZeile[],
    werte: Record<TSchluessel, (zeile: TZeile) => string | number | null>,
  ): TZeile[];
}

export function useTabellenSortierung<TSchluessel extends string>(
  /** Erlaubte Spalten – alles andere aus der Adresse wird verworfen. */
  spalten: readonly TSchluessel[],
  standard: TSchluessel,
  standardRichtung: SortRichtung = 'asc',
  /** Kennung der Tabelle, wenn mehrere auf einer Seite stehen (z. B. `server`). */
  praefix = '',
): TabellenSortierung<TSchluessel> {
  const istSpalte = useCallback(
    (wert: string): wert is TSchluessel => (spalten as readonly string[]).includes(wert),
    [spalten],
  );
  const istRichtung = useCallback(
    (wert: string): wert is SortRichtung => wert === 'asc' || wert === 'desc',
    [],
  );

  const [schluessel, setSchluessel] = useUrlFilter<TSchluessel>(
    `${praefix}sort`,
    standard,
    istSpalte,
  );
  const [richtung, setRichtung] = useUrlFilter<SortRichtung>(
    `${praefix}dir`,
    standardRichtung,
    istRichtung,
  );

  const umschalten = useCallback(
    (naechster: TSchluessel) => {
      if (naechster === schluessel) {
        setRichtung(richtung === 'asc' ? 'desc' : 'asc');

        return;
      }

      setSchluessel(naechster);
      setRichtung(standardRichtung);
    },
    [schluessel, richtung, setSchluessel, setRichtung, standardRichtung],
  );

  const ariaSort = useCallback(
    (spalte: TSchluessel): 'ascending' | 'descending' | 'none' =>
      spalte !== schluessel ? 'none' : richtung === 'asc' ? 'ascending' : 'descending',
    [schluessel, richtung],
  );

  const sortiere = useCallback(
    <TZeile>(
      zeilen: readonly TZeile[],
      werte: Record<TSchluessel, (zeile: TZeile) => string | number | null>,
    ): TZeile[] => {
      const lies = werte[schluessel];
      const faktor = richtung === 'asc' ? 1 : -1;

      return [...zeilen].sort((links, rechts) => {
        const a = lies(links);
        const b = lies(rechts);

        // Leere Werte immer ans Ende, gleich in welcher Richtung: Eine Zeile
        // ohne Angabe ist kein „kleinster" Wert, sie hat schlicht keinen.
        if (a === null && b === null) return 0;
        if (a === null) return 1;
        if (b === null) return -1;

        if (typeof a === 'number' && typeof b === 'number') {
          return (a - b) * faktor;
        }

        return String(a).localeCompare(String(b), 'de', { sensitivity: 'base' }) * faktor;
      });
    },
    [schluessel, richtung],
  );

  return useMemo(
    () => ({ schluessel, richtung, umschalten, ariaSort, sortiere }),
    [schluessel, richtung, umschalten, ariaSort, sortiere],
  );
}

/** Wie viele Zeilen eine Seite fasst. */
export const SEITENGROESSE = 25;

export interface Seitenteilung<TZeile> {
  readonly seite: number;
  readonly seiten: number;
  readonly zeilen: readonly TZeile[];
  readonly gesamt: number;
  blaettere(zu: number): void;
}

export function useSeitenteilung<TZeile>(
  zeilen: readonly TZeile[],
  /** Kennung der Tabelle, wenn mehrere auf einer Seite stehen. */
  praefix = '',
  groesse = SEITENGROESSE,
): Seitenteilung<TZeile> {
  const [roh, setRoh] = useUrlFilter<string>(`${praefix}seite`, '', (wert): wert is string =>
    /^\d{1,4}$/.test(wert),
  );

  const seiten = Math.max(1, Math.ceil(zeilen.length / groesse));
  // Zwischen zwei Abrufen kann die Liste kürzer werden: Eine Seite, die es
  // nicht mehr gibt, zeigt die letzte vorhandene statt einer leeren Tabelle.
  const seite = Math.min(Math.max(1, Number(roh) || 1), seiten);

  const blaettere = useCallback(
    (zu: number) => {
      setRoh(zu <= 1 ? '' : String(zu));
    },
    [setRoh],
  );

  return {
    seite,
    seiten,
    gesamt: zeilen.length,
    zeilen: zeilen.slice((seite - 1) * groesse, seite * groesse),
    blaettere,
  };
}
