import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { UNKNOWN_ERROR_MESSAGE } from '@/lib/auth/errors';
import { type ApiResult } from './client';
import { useApiResource } from './useApiResource';

/**
 * Ladehaken: Was passiert, wenn die Ladefunktion nicht liefert, sondern wirft?
 *
 * Regulär endet jeder Aufruf in einem `ApiResult` – auch im Fehlerfall. Darauf
 * war Verlass, bis ein fehlerhaft kodiertes CSRF-Cookie `apiRequest` mit einem
 * `URIError` ablehnen ließ (Fundpunkt frontend-lib-12): Der Haken hatte kein
 * `catch`, `loading` blieb für immer `true`, die Ansicht zeigte ewig „wird
 * geladen …", und die Ablehnung landete unbehandelt in der Konsole.
 *
 * Dass die Tests hier überhaupt durchlaufen, ist Teil des Nachweises: Vitest
 * lässt einen Lauf mit unbehandelter Promise-Ablehnung scheitern.
 */

const DATEN: ApiResult<string> = { success: true, data: 'inhalt', error: null };

const ABGELEHNT: ApiResult<string> = {
  success: false,
  data: null,
  error: { code: 'AUTH_REQUIRED', message: 'egal' },
} as ApiResult<string>;

describe('useApiResource – abgelehnte Ladefunktion (Fundpunkt frontend-lib-12)', () => {
  it('lädt im Normalfall und meldet keinen Fehler', async () => {
    const { result } = renderHook(() => useApiResource<string>(async () => DATEN, []));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.data).toBe('inhalt');
    expect(result.current.error).toBeNull();
  });

  it('geht bei einer abgelehnten Ladefunktion in den Fehlerzustand statt ewig zu laden', async () => {
    const rejections: unknown[] = [];
    const merken = (grund: unknown): void => {
      rejections.push(grund);
    };
    process.on('unhandledRejection', merken);

    try {
      const { result } = renderHook(() =>
        useApiResource<string>(() => Promise.reject(new URIError('URI malformed')), []),
      );

      await waitFor(() => {
        expect(result.current.error).toBe(UNKNOWN_ERROR_MESSAGE);
      });
      expect(result.current.loading).toBe(false);
      expect(result.current.data).toBeNull();

      // Eine unbehandelte Ablehnung würde am Ende dieses Ticks gemeldet.
      await new Promise((fertig) => setTimeout(fertig, 10));
      expect(rejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', merken);
    }
  });

  it('fängt auch eine Ladefunktion, die sofort wirft', async () => {
    const { result } = renderHook(() =>
      useApiResource<string>(() => {
        throw new URIError('URI malformed');
      }, []),
    );

    await waitFor(() => {
      expect(result.current.error).toBe(UNKNOWN_ERROR_MESSAGE);
    });
    expect(result.current.loading).toBe(false);
  });

  it('übersetzt einen regulären Fehler-Envelope weiterhin über den Fehlercode', async () => {
    const { result } = renderHook(() => useApiResource<string>(async () => ABGELEHNT, []));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    // Katalogtext, nicht der Freitext aus dem Envelope (Entwicklungsregeln §5).
    expect(result.current.error).not.toBe('egal');
    expect(result.current.error).not.toBeNull();
  });

  it('lädt gar nicht, solange die Abhängigkeiten null sind', async () => {
    const { result } = renderHook(() => useApiResource<string>(async () => DATEN, null));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  /**
   * Audit-Fundstelle frontend-lib-03: Das Ergebnis war ein Objektliteral und
   * bekam bei jedem Rendern eine neue Identität. Wer es in die Abhängigkeiten
   * eines `useCallback`/`useEffect` legte, baute sich damit eine Schleife – im
   * Arcade setzte jedes Rendern das laufende Spiel zurück.
   */
  it('liefert über ein erneutes Rendern hinweg dieselben Referenzen', async () => {
    const { result, rerender } = renderHook(() => useApiResource<string>(async () => DATEN, []));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const vorher = result.current;
    rerender();
    rerender();

    expect(result.current).toBe(vorher);
    expect(result.current.reload).toBe(vorher.reload);
    expect(result.current.setData).toBe(vorher.setData);
  });

  it('erneuert das Ergebnis, sobald sich Daten oder Zustand ändern', async () => {
    const { result } = renderHook(() => useApiResource<string>(async () => DATEN, []));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const vorher = result.current;
    act(() => {
      result.current.setData('neu');
    });

    expect(result.current).not.toBe(vorher);
    expect(result.current.data).toBe('neu');
    // Die Funktionen bleiben trotzdem dieselben.
    expect(result.current.reload).toBe(vorher.reload);
    expect(result.current.setData).toBe(vorher.setData);
  });

  it('räumt den Fehler bei erneutem Laden wieder ab', async () => {
    let scheitert = true;
    const { result } = renderHook(() =>
      useApiResource<string>(
        () => (scheitert ? Promise.reject(new Error('kaputt')) : Promise.resolve(DATEN)),
        [],
      ),
    );

    await waitFor(() => {
      expect(result.current.error).toBe(UNKNOWN_ERROR_MESSAGE);
    });

    scheitert = false;
    result.current.reload();

    await waitFor(() => {
      expect(result.current.error).toBeNull();
    });
    expect(result.current.data).toBe('inhalt');
  });
});

/**
 * Anfangsbestand: Was die Anwendung schon hat, muss sie nicht erst laden
 * lassen.
 *
 * Der Rahmen des Dashboards hält die Serverliste für Kopf- und Seitenleiste,
 * und `/servers` holte dieselbe Liste noch einmal – mit „Server werden
 * geladen …" davor, obwohl die Karten längst hätten stehen können.
 */
describe('useApiResource – Anfangsbestand aus dem Rahmen', () => {
  it('zeigt den Bestand sofort, während der eigene Abruf noch läuft', async () => {
    let aufloesen: ((ergebnis: ApiResult<string>) => void) | null = null;
    const haengend = new Promise<ApiResult<string>>((r) => {
      aufloesen = r;
    });

    const { result } = renderHook(() =>
      useApiResource<string>(async () => haengend, [], 'geliehen'),
    );

    // Noch nichts geholt – und trotzdem steht schon etwas da.
    expect(result.current.data).toBe('geliehen');
    expect(result.current.loading).toBe(true);

    await act(async () => {
      aufloesen?.(DATEN);
      await haengend;
    });

    expect(result.current.data).toBe('inhalt');
    expect(result.current.loading).toBe(false);
  });

  it('nimmt einen Bestand mit, der erst später eintrifft', async () => {
    // Der Rahmen lädt selbst asynchron; beim ersten Rendern der Seite darunter
    // ist er oft noch leer. Ein `useState(bestand)` hätte ihn verpasst.
    let aufloesen: ((ergebnis: ApiResult<string>) => void) | null = null;
    const haengend = new Promise<ApiResult<string>>((r) => {
      aufloesen = r;
    });

    const { result, rerender } = renderHook(
      ({ bestand }: { bestand: string | null }) =>
        useApiResource<string>(async () => haengend, [], bestand),
      { initialProps: { bestand: null as string | null } },
    );

    expect(result.current.data).toBeNull();

    rerender({ bestand: 'nachgereicht' });
    expect(result.current.data).toBe('nachgereicht');

    await act(async () => {
      aufloesen?.(DATEN);
      await haengend;
    });

    expect(result.current.data).toBe('inhalt');
  });

  it('der eigene Stand gewinnt gegen einen später nachgeschobenen Bestand', async () => {
    const { result, rerender } = renderHook(
      ({ bestand }: { bestand: string | null }) =>
        useApiResource<string>(async () => DATEN, [], bestand),
      { initialProps: { bestand: null as string | null } },
    );

    await waitFor(() => {
      expect(result.current.data).toBe('inhalt');
    });

    rerender({ bestand: 'veraltet' });
    expect(result.current.data).toBe('inhalt');
  });

  /**
   * ⚠️ Der Fall, an dem eine naive Umsetzung zerbricht.
   *
   * Eine Aktion schreibt die Liste mit `setData((current) => …)` fort. Setzte
   * das auf dem *eigenen* Stand auf, bekäme sie `null`, solange nur der
   * geliehene Bestand sichtbar ist – aus `(current ?? []).map(…)` würde `[]`,
   * und die Übersicht wäre nach einem Klick auf „Starten" schlagartig leer.
   */
  it('setData setzt auf dem sichtbaren Stand auf, nicht auf dem eigenen', async () => {
    const nieFertig = new Promise<ApiResult<string[]>>(() => {});

    const { result } = renderHook(() =>
      useApiResource<string[]>(async () => nieFertig, [], ['a', 'b']),
    );

    expect(result.current.data).toEqual(['a', 'b']);

    act(() => {
      result.current.setData((aktuell) => (aktuell ?? []).map((eintrag) => `${eintrag}!`));
    });

    expect(result.current.data).toEqual(['a!', 'b!']);
  });
});
