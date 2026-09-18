'use client';

import { useCallback, useRef, useSyncExternalStore } from 'react';

/**
 * Sprungziel innerhalb einer Listenansicht (WORK_STATUS.md, Gefundener Punkt
 * 103).
 *
 * Eine Benachrichtigung verlinkt auf die Liste, in der ihr Gegenstand steht –
 * eine Sicherung in „Meine Backups", eine gemeldete Nachricht in der
 * Moderation. Ohne Detailroute landete der Empfänger bisher nur *irgendwo* in
 * dieser Liste und musste seinen Eintrag selbst suchen. Mit `?highlight=<id>`
 * hebt die Ansicht ihn hervor und scrollt ihn in den Blick.
 *
 * **Warum `window.location` und nicht `useSearchParams()`.** Der Parameter ist
 * reine Anzeige-Sache und wird erst im Browser gebraucht. `useSearchParams()`
 * zwingt jede Seite, die ihn benutzt, in eine Suspense-Grenze, sonst scheitert
 * das Vorrendern beim Bauen – dafür ist der Nutzen hier zu klein.
 *
 * Die Hervorhebung bleibt stehen, bis die Seite gewechselt wird; sie
 * verschwindet nicht nach ein paar Sekunden von allein. Wer aus einer Meldung
 * kommt, soll den Eintrag auch dann noch markiert finden, wenn er zwischendurch
 * woanders hingesehen hat.
 */
export interface Highlight {
  /** Gesuchte Id aus der Adresszeile; `null`, wenn keine angegeben ist. */
  readonly id: string | null;
  /** Ist dieser Eintrag gemeint? */
  matches(candidate: string): boolean;
  /**
   * Ref für den Eintrag: scrollt ihn einmalig in den Blick, sobald er im
   * Dokument steht. An **jede** Zeile hängen – die Funktion prüft selbst, ob
   * die Zeile gemeint ist.
   */
  ref(candidate: string): (element: HTMLElement | null) => void;
  /** Rahmen für den gemeinten Eintrag, sonst `undefined`. */
  className(candidate: string): string | undefined;
}

/** Name des Abfrageparameters – auch von `subjectHref()` in F6 benutzt. */
export const HIGHLIGHT_PARAM = 'highlight';

/** Rahmen der Hervorhebung: Markenfarbe, wie der Fokusrahmen der Eingabefelder. */
const HIGHLIGHT_CLASS = 'rounded-2xl ring-2 ring-brand ring-offset-2 ring-offset-canvas';

/*
 * Die Adresszeile ist eine externe Quelle, deshalb `useSyncExternalStore`:
 * Auf dem Server und beim Hydratisieren gilt `null`, im Browser der Wert aus
 * der Adresse – ohne Zustand, der erst in einem Effekt nachgezogen wird.
 * Niemand meldet Änderungen (kein `popstate`-Lauscher), also ist das Abo leer;
 * gelesen wird der Parameter bei jedem Rendern neu.
 */
function keinAbo(): () => void {
  return () => {};
}

function ausAdresse(): string | null {
  return new URLSearchParams(window.location.search).get(HIGHLIGHT_PARAM);
}

function aufDemServer(): null {
  return null;
}

export function useHighlight(): Highlight {
  const id = useSyncExternalStore(keinAbo, ausAdresse, aufDemServer);
  const gescrollt = useRef(false);

  const matches = useCallback((candidate: string) => id !== null && id === candidate, [id]);

  const ref = useCallback(
    (candidate: string) => (element: HTMLElement | null) => {
      if (element === null || gescrollt.current || id === null || id !== candidate) return;

      // Nur einmal je Aufruf der Seite: Ein Nachladen der Liste soll den Blick
      // nicht erneut wegziehen, wenn der Nutzer inzwischen weitergescrollt ist.
      gescrollt.current = true;
      element.scrollIntoView({ block: 'center', behavior: 'smooth' });
    },
    [id],
  );

  const className = useCallback(
    (candidate: string) => (matches(candidate) ? HIGHLIGHT_CLASS : undefined),
    [matches],
  );

  return { id, matches, ref, className };
}
