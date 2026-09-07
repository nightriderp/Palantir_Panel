import { describe, expect, it } from 'vitest';
import { type LiveStatusEntry, mergeLiveStatus } from './mergeLiveStatus';

/**
 * Fundpunkt event-flow-04 – wer gewinnt, Live-Kanal oder REST-Antwort?
 *
 * Die Regel ist bewusst simpel: der jüngere Stand, gemessen an der Reihenfolge
 * des Eintreffens im Browser. Vorher galt `live ?? dto`, also immer der Kanal.
 */

const DTO = { status: 'stopped', statusMessage: null, name: 'Welt' } as const;

function live(status: LiveStatusEntry['status'], revision: number): LiveStatusEntry {
  return { status, statusMessage: null, revision };
}

describe('mergeLiveStatus (event-flow-04)', () => {
  it('nimmt den Live-Status, wenn er jünger ist als die REST-Daten', () => {
    expect(mergeLiveStatus(DTO, 3, live('running', 4)).status).toBe('running');
  });

  it('lässt den Live-Status beim Erstladen gewinnen (DTO-Revision 0)', () => {
    expect(mergeLiveStatus(DTO, 0, live('running', 1)).status).toBe('running');
  });

  it('verwirft einen älteren Live-Status gegen eine jüngere REST-Antwort', () => {
    const dto = { ...DTO, status: 'starting' } as const;

    expect(mergeLiveStatus(dto, 7, live('stopped', 5)).status).toBe('starting');
  });

  it('gibt bei Gleichstand den DTO zurück – er trägt den vollständigen Datensatz', () => {
    const zusammengefuehrt = mergeLiveStatus(DTO, 4, live('running', 4));

    expect(zusammengefuehrt).toBe(DTO);
  });

  it('lässt das DTO-Objekt unverändert, wenn der Live-Status dasselbe sagt', () => {
    expect(mergeLiveStatus(DTO, 1, live('stopped', 9))).toBe(DTO);
  });

  it('übernimmt die Statusmeldung mit dem jüngeren Live-Stand', () => {
    const eintrag: LiveStatusEntry = {
      status: 'error',
      statusMessage: 'Start fehlgeschlagen.',
      revision: 2,
    };

    expect(mergeLiveStatus(DTO, 1, eintrag)).toEqual({
      status: 'error',
      statusMessage: 'Start fehlgeschlagen.',
      name: 'Welt',
    });
  });

  it('gibt den DTO zurück, solange kein Live-Stand vorliegt', () => {
    expect(mergeLiveStatus(DTO, 0, null)).toBe(DTO);
  });
});
