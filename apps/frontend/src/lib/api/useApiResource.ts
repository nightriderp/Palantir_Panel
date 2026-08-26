'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { type ApiResult, isAborted } from './client';

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

    void loadRef.current(controller.signal).then((result) => {
      if (controller.signal.aborted || isAborted(result)) return;

      if (result.success) {
        setData(result.data);
        setError(null);
      } else {
        setError(result.error.message);
      }
      setLoading(false);
    });

    return () => controller.abort();
  }, [enabled, dependencyKey, reloadToken]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  return { data, loading, error, reload, setData };
}
