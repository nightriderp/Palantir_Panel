'use client';

import { useState } from 'react';
import { nextRevision } from '../revision';

/**
 * Alter der REST-Daten einer Ansicht bestimmen (Fundpunkt event-flow-04).
 *
 * `useApiResource` selbst bleibt unangetastet – es weiß nichts vom Live-Kanal,
 * und sein Zustand wird von mehreren Arbeitspaketen gleichzeitig benutzt.
 * Stattdessen merken sich die Ansichten hier, **wann** ihnen ein DTO zum ersten
 * Mal untergekommen ist. Als Erkennungsmerkmal dient die Objekt-Identität:
 * `useApiResource` liefert bei jedem Laden und bei jedem `setData` ein neues
 * Objekt, ein unveränderter Stand bleibt dagegen dasselbe.
 *
 * **Der erste Stand bekommt bewusst die `0`.** Beim Erstladen ist der DTO das
 * ältere Datum: Die Anfrage lief bereits, als das Ereignis eintraf. Der
 * bisherige Vorrang des Live-Kanals (`live ?? dto`) bleibt für diesen Fall also
 * erhalten. Erst jeder **weitere** Stand – die Antwort einer Lifecycle-Aktion,
 * ein „Nochmal versuchen", ein erneutes Laden – ist jünger als alles, was der
 * Browser bis dahin erfahren hat, und bekommt eine eigene Nummer.
 *
 * Der gemerkte Stand liegt im State, nicht in einer Ref: Er wird beim Rendern
 * gelesen und aus den Props fortgeschrieben, und genau das verbietet der
 * React-Compiler für Refs. Ein `setState` während des Renderns lässt React die
 * Komponente sofort noch einmal rechnen – der zweite Durchlauf sieht dann das
 * bekannte Objekt und gibt die gemerkte Nummer zurück.
 */
export function useDtoRevision(dto: object | null): number {
  const [gesehen, setGesehen] = useState<{ wert: object | null; revision: number }>({
    wert: null,
    revision: 0,
  });

  if (dto !== null && dto !== gesehen.wert) {
    // Erstes Sehen: 0 (siehe oben). Jeder Folgestand: eigene Nummer.
    const revision = gesehen.wert === null ? 0 : nextRevision();
    setGesehen({ wert: dto, revision });

    return revision;
  }

  return gesehen.revision;
}

/**
 * Dasselbe je Listeneintrag (Übersicht, Seitenleiste).
 *
 * Eine gemeinsame Nummer für die ganze Liste wäre falsch: `setData` nach einer
 * Lifecycle-Aktion baut zwar ein neues Array, tauscht darin aber nur **einen**
 * Eintrag aus. Bekämen alle anderen dabei eine frische Nummer, würde der
 * Start eines Servers den Live-Status aller übrigen verwerfen.
 *
 * Das zurückgegebene Objekt wird nur neu gebaut, wenn sich tatsächlich etwas
 * geändert hat – es taugt damit als Abhängigkeit eines `useMemo`.
 */
export function useDtoRevisions<TItem extends { id: string }>(
  items: readonly TItem[],
): Record<string, number> {
  const [stand, setStand] = useState<{
    gesehen: Map<string, { wert: TItem; revision: number }>;
    ergebnis: Record<string, number>;
  }>(() => ({ gesehen: new Map(), ergebnis: {} }));

  const naechste = new Map<string, { wert: TItem; revision: number }>();
  let geaendert = items.length !== stand.gesehen.size;

  for (const item of items) {
    const vorher = stand.gesehen.get(item.id);

    if (vorher !== undefined && vorher.wert === item) {
      naechste.set(item.id, vorher);
      continue;
    }

    naechste.set(item.id, {
      wert: item,
      revision: vorher === undefined ? 0 : nextRevision(),
    });
    geaendert = true;
  }

  if (geaendert) {
    // Wie in `useDtoRevision`: Stand während des Renderns fortschreiben, React
    // rechnet sofort erneut und liefert dann das gemerkte Ergebnis.
    const ergebnis = Object.fromEntries(
      [...naechste].map(([id, eintrag]) => [id, eintrag.revision]),
    );
    setStand({ gesehen: naechste, ergebnis });

    return ergebnis;
  }

  return stand.ergebnis;
}
