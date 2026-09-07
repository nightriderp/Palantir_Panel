import { renderHook, waitFor } from '@testing-library/react';
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
    // Katalogtext, nicht der Freitext aus dem Envelope (CLAUDE.md §5).
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
