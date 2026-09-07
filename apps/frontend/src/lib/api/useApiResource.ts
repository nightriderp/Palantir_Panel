'use client';

import {
  useCallback,
  useEffect,
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
): ApiResourceState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(dependencies !== null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  // Die Ladefunktion wird bei jedem Rendern neu erzeugt; maßgeblich für den
  // erneuten Lauf sind allein die angegebenen Abhängigkeiten.
  const loadRef = useRef(load);
  loadRef.current = load;

  const enabled = dependencies !== null;
  const dependencyKey = enabled ? JSON.stringify(dependencies) : null;

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

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
          setError(null);
        } else {
          setError(errorText(result));
        }
      } catch {
        // Abbrüche erzeugen wie bisher keinen Fehlerzustand – die Ansicht wird
        // gerade verlassen oder lädt schon mit neuen Abhängigkeiten.
        if (controller.signal.aborted) return;
        setError(UNKNOWN_ERROR_MESSAGE);
      }
      setLoading(false);
    }

    void laden();

    return () => controller.abort();
  }, [enabled, dependencyKey, reloadToken]);

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
  return useMemo(() => ({ data, loading, error, reload, setData }), [data, loading, error, reload]);
}
