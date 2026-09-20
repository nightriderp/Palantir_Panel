'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { UNKNOWN_ERROR_MESSAGE } from '@/lib/auth/errors';
import { type ApiResult, errorText, isAborted } from './client';

/**
 * Eine Ressource per REST laden, samt Lade- und Fehlerzustand.
 *
 * Bewusst klein gehalten: F3 braucht Laden, Fehlermeldung, erneutes Laden und
 * das lokale Ersetzen der Daten nach einer Aktion – mehr nicht. Abgebrochene
 * Aufrufe (Ansicht verlassen, neuer Pfad im Datei-Manager) erzeugen keinen
 * Fehlerzustand.
 */

export interface ApiResourceState<T> {
  data: T | null;
  loading: boolean;
  /** Deutsche Fehlermeldung aus dem Envelope; `null`, wenn alles gut ging. */
  error: string | null;
  /** Erneut laden, z. B. nach einer Aktion oder über „Nochmal versuchen". */
  reload: () => void;
  /**
   * Daten ohne Netzaufruf ersetzen, wenn eine Aktion den neuen Stand liefert.
   * Nimmt wie `useState` auch eine Funktion entgegen, damit ein Update nicht
   * auf einem veralteten Stand aufsetzt.
   */
  setData: Dispatch<SetStateAction<T | null>>;
}

export function useApiResource<T>(
  load: (signal: AbortSignal) => Promise<ApiResult<T>>,
  /**
   * Werte, bei deren Änderung neu geladen wird (Server-Id, Pfad, Filter).
   * Ist die Liste `null`, wird gar nicht geladen – etwa solange die Id fehlt.
   */
  dependencies: readonly unknown[] | null,
  /**
   * Bereits vorhandener Stand, der gilt, **bis** der eigene Abruf zurück ist.
   *
   * Gedacht für Daten, die eine Ebene höher ohnehin schon im Speicher liegen:
   * Der Rahmen des Dashboards hält die Serverliste für Kopf- und Seitenleiste,
   * und die Serverübersicht holte dieselbe Liste noch einmal – und zeigte
   * derweil „Server werden geladen …", obwohl der Inhalt längst da war. Mit
   * dem Anfangsbestand steht die Ansicht sofort und tauscht still gegen den
   * frischen Stand, sobald er eintrifft.
   *
   * Bewusst **kein Zwischenspeicher im Hook**: Wer den Bestand hat, reicht ihn
   * herein; der Hook merkt sich nichts über seine Lebensdauer hinaus. Der
   * Abruf läuft unverändert – `loading` bleibt `true`, solange er läuft.
   *
   * ⚠️ Ein später eintreffender Bestand wird mitgenommen. Der Rahmen lädt
   * selbst asynchron; beim ersten Rendern der Übersicht ist er oft noch `null`
   * und kommt erst eine Runde später. Ein `useState(anfangsbestand)` hätte ihn
   * verpasst – deshalb wird er beim Lesen zugemischt, nicht beim Anlegen.
   */
  anfangsbestand: T | null = null,
): ApiResourceState<T> {
  const [eigeneDaten, setData] = useState<T | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  /*
   * Der eigene Stand gewinnt, sobald es einen gibt – auch wenn der Rahmen
   * danach noch etwas nachschiebt. Sonst könnte eine Aktion, die die Liste
   * gerade fortgeschrieben hat, von einem älteren Bestand überholt werden.
   */
  const data = eigeneDaten ?? anfangsbestand;

  /*
   * `setData` mit einer Funktion muss auf dem **sichtbaren** Stand aufsetzen,
   * nicht auf dem eigenen. Sonst liefe eine Aktion auf einer geliehenen Liste
   * ins Leere: `setData((current) => (current ?? []).map(…))` bekäme `null`,
   * ergäbe `[]` – und die Übersicht wäre nach einem Klick auf „Starten"
   * schlagartig leer, bis der Abruf zurückkommt.
   */
  const sichtbarRef = useRef(data);
  useLayoutEffect(() => {
    sichtbarRef.current = data;
  });

  const setDataAufSichtbarem = useCallback<Dispatch<SetStateAction<T | null>>>((aktion) => {
    setData((eigener) =>
      typeof aktion === 'function'
        ? (aktion as (vorher: T | null) => T | null)(eigener ?? sichtbarRef.current)
        : aktion,
    );
  }, []);

  // Die Ladefunktion wird bei jedem Rendern neu erzeugt; maßgeblich für den
  // erneuten Lauf sind allein die angegebenen Abhängigkeiten. Nachgezogen wird
  // sie im Layout-Effekt – der läuft vor dem Lade-Effekt, und ein Schreiben
  // während des Renderns verbietet der React-Compiler.
  const loadRef = useRef(load);
  useLayoutEffect(() => {
    loadRef.current = load;
  });

  /*
   * Ein Ladelauf ist über seinen Schlüssel identifiziert: Abhängigkeiten plus
   * Zähler für „nochmal". `null` heißt: gerade nicht laden. Lade- und
   * Fehlerzustand werden daraus abgeleitet statt im Effekt gesetzt – der
   * Effekt merkt sich nur, welcher Lauf zuletzt abgeschlossen hat.
   */
  const dependencyKey = dependencies === null ? null : JSON.stringify(dependencies);
  const runKey = dependencyKey === null ? null : `${reloadToken}:${dependencyKey}`;

  const [settled, setSettled] = useState<{ key: string | null; error: string | null } | null>(null);

  // Beim Abschalten wird der letzte Abschluss entwertet: Ein späteres
  // Wiedereinschalten mit demselben Schlüssel lädt neu und zeigt das auch.
  // Die Fehlermeldung bleibt derweil stehen, wie bisher.
  if (runKey === null && settled !== null && settled.key !== null) {
    setSettled({ key: null, error: settled.error });
  }

  const loading = runKey !== null && settled?.key !== runKey;
  const error = loading ? null : (settled?.error ?? null);

  useEffect(() => {
    if (runKey === null) return;

    const controller = new AbortController();

    /*
     * Die Ladefunktion liefert normalerweise auch im Fehlerfall ein Ergebnis
     * (`ApiResult`) statt zu werfen. Verlässlich ist das aber nicht: Schon ein
     * fehlerhaft kodiertes CSRF-Cookie ließ `apiRequest` mit einem `URIError`
     * ablehnen (Fundpunkt frontend-lib-12), und jeder eigene Loader kann
     * werfen. Ohne diesen Zweig blieb `loading` dann für immer `true`, die
     * Ansicht zeigte ewig „wird geladen …", und die Ablehnung landete
     * unbehandelt in der Konsole. Deshalb: jeder Ausgang endet im selben
     * sichtbaren Zustand.
     */
    async function laden(): Promise<void> {
      try {
        const result = await loadRef.current(controller.signal);
        if (controller.signal.aborted || isAborted(result)) return;

        if (result.success) {
          setData(result.data);
          setSettled({ key: runKey, error: null });
        } else {
          setSettled({ key: runKey, error: errorText(result) });
        }
      } catch {
        // Abbrüche erzeugen wie bisher keinen Fehlerzustand – die Ansicht wird
        // gerade verlassen oder lädt schon mit neuen Abhängigkeiten.
        if (controller.signal.aborted) return;
        setSettled({ key: runKey, error: UNKNOWN_ERROR_MESSAGE });
      }
    }

    void laden();

    return () => controller.abort();
  }, [runKey]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  /*
   * Ein Objektliteral im `return` bekäme bei jedem Rendern eine neue Identität –
   * auch wenn sich an Daten, Lade- und Fehlerzustand nichts geändert hat. Wer
   * das Ergebnis in die Abhängigkeiten eines `useCallback`/`useEffect` legt,
   * baut sich damit eine Endlosschleife: Im Arcade lief genau so bei jedem
   * Rendern ein `reset()`, der Endbildschirm verschwand nach einem Frame und
   * eine laufende Partie brach ab, sobald die Bestenliste nachlud
   * (Audit-Fundstelle frontend-lib-03).
   *
   * `reload` und `setData` sind ohnehin stabil (`useCallback` bzw. der Setter
   * aus `useState`); gemerkt wird deshalb nur das umgebende Objekt.
   */
  return useMemo(
    () => ({ data, loading, error, reload, setData: setDataAufSichtbarem }),
    [data, loading, error, reload, setDataAufSichtbarem],
  );
}
