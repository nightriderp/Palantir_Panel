import { type ServerConsoleLine } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import { appendConsoleLine, appendConsoleLines } from './consoleBuffer';

function line(id: string, text = `Zeile ${id}`): ServerConsoleLine {
  return {
    id,
    serverId: 'server-1',
    source: 'stdout',
    text,
    timestamp: '2026-08-26T10:00:00.000Z',
  };
}

describe('appendConsoleLine', () => {
  it('hängt an und lässt das Original unberührt', () => {
    const before = [line('1')];
    const after = appendConsoleLine(before, line('2'));

    expect(after.map((entry) => entry.id)).toEqual(['1', '2']);
    expect(before.map((entry) => entry.id)).toEqual(['1']);
  });

  it('übergeht eine bereits vorhandene Id', () => {
    const after = appendConsoleLine([line('1'), line('2')], line('1', 'Wiederholung'));
    expect(after.map((entry) => entry.id)).toEqual(['1', '2']);
    expect(after[0]?.text).toBe('Zeile 1');
  });

  it('wirft die ältesten Zeilen weg, sobald die Grenze erreicht ist', () => {
    const filled = appendConsoleLines([], [line('1'), line('2'), line('3')], 3);
    const after = appendConsoleLine(filled, line('4'), 3);

    expect(after.map((entry) => entry.id)).toEqual(['2', '3', '4']);
  });
});

describe('appendConsoleLines', () => {
  it('hängt mehrere Zeilen in der gegebenen Reihenfolge an', () => {
    const after = appendConsoleLines([line('1')], [line('2'), line('3')]);
    expect(after.map((entry) => entry.id)).toEqual(['1', '2', '3']);
  });

  it('hält die Grenze auch bei einem großen Schwung ein', () => {
    const many = Array.from({ length: 10 }, (_, index) => line(String(index)));
    const after = appendConsoleLines([], many, 4);

    expect(after).toHaveLength(4);
    expect(after.map((entry) => entry.id)).toEqual(['6', '7', '8', '9']);
  });
});
