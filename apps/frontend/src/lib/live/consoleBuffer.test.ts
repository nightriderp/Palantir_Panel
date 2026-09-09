import { type ServerConsoleLine } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import {
  appendConsoleLine,
  appendConsoleLines,
  consoleLineFromLog,
  seedConsoleBacklog,
} from './consoleBuffer';

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

/*
 * Fundpunkt 184: Der Rückblick beim Öffnen kommt aus dem Container-Log und
 * kennt die Ids des Live-Kanals nicht.
 */
describe('consoleLineFromLog', () => {
  it('übersetzt eine Log-Zeile mit stabiler Id und dem Strom als Quelle', () => {
    const zeile = consoleLineFromLog(
      'server-1',
      { stream: 'stderr', message: 'Warnung', timestamp: '2026-09-09T14:46:00.000Z' },
      3,
      '2026-09-09T15:00:00.000Z',
    );

    expect(zeile).toEqual({
      id: 'backlog:server-1:3',
      serverId: 'server-1',
      source: 'stderr',
      text: 'Warnung',
      timestamp: '2026-09-09T14:46:00.000Z',
    });
  });

  it('nimmt den Ladezeitpunkt, wenn die Engine keinen Zeitstempel liefert', () => {
    const zeile = consoleLineFromLog(
      'server-1',
      { stream: 'stdout', message: 'ohne Zeit', timestamp: null },
      0,
      '2026-09-09T15:00:00.000Z',
    );

    expect(zeile.timestamp).toBe('2026-09-09T15:00:00.000Z');
  });
});

describe('seedConsoleBacklog', () => {
  it('legt den Rückblick vor die Live-Zeilen', () => {
    const live = [line('live-1', 'Done!')];
    const backlog = [line('backlog:0', 'Starting'), line('backlog:1', 'Loading')];

    expect(seedConsoleBacklog(live, backlog).map((entry) => entry.text)).toEqual([
      'Starting',
      'Loading',
      'Done!',
    ]);
  });

  it('lässt Zeilen weg, die schon live da sind – gleicher Zeitstempel, gleicher Text', () => {
    // Die Ids unterscheiden sich immer (das Log kennt keine); die Naht darf
    // trotzdem nicht doppelt erscheinen.
    const live = [line('live-1', 'Done!')];
    const backlog = [line('backlog:0', 'Starting'), line('backlog:1', 'Done!')];

    expect(seedConsoleBacklog(live, backlog).map((entry) => entry.id)).toEqual([
      'backlog:0',
      'live-1',
    ]);
  });

  it('hält die Grenze und behält dabei die jüngsten Zeilen', () => {
    const live = [line('live-1', 'neu')];
    const backlog = Array.from({ length: 5 }, (_, index) =>
      line(`backlog:${index}`, `alt ${index}`),
    );

    const after = seedConsoleBacklog(live, backlog, 3);

    expect(after.map((entry) => entry.text)).toEqual(['alt 3', 'alt 4', 'neu']);
  });

  it('lässt das Original unberührt', () => {
    const live = [line('live-1', 'neu')];
    seedConsoleBacklog(live, [line('backlog:0', 'alt')]);

    expect(live).toHaveLength(1);
  });
});

/**
 * Audit W2-5, `event-flow-07`: Die Zeilen-Id lautete `${serverId}-${n}` mit
 * einem Zähler, der bei jedem Backend-Start wieder bei 0 begann. Nach einem
 * Deploy erzeugte das Backend erneut `…-1`, `…-2`, … – der Puffer hielt sie für
 * schon gesehene Zeilen und verwarf Echo **und** Ausgabe still. Seit die Id die
 * Kennung des Prozesses trägt, kann das nicht mehr passieren.
 */
describe('Zeilen nach einem Backend-Neustart', () => {
  const SERVER = '11111111-1111-4111-8111-111111111111';

  it('verwirft die Zeilen des neuen Prozesses nicht', () => {
    const vorNeustart = appendConsoleLines(
      [],
      [
        line(`${SERVER}-a1b2c3d4e5f6-1`, '> list'),
        line(`${SERVER}-a1b2c3d4e5f6-2`, 'Es sind 2 Spieler online'),
      ],
    );

    // Nach dem Neustart beginnt der Zähler wieder bei 1 – die Prozesskennung
    // ist aber eine andere.
    const nachNeustart = appendConsoleLines(vorNeustart, [
      line(`${SERVER}-9f8e7d6c5b4a-1`, '> list'),
      line(`${SERVER}-9f8e7d6c5b4a-2`, 'Es sind 3 Spieler online'),
    ]);

    expect(nachNeustart).toHaveLength(4);
    expect(nachNeustart.at(-1)?.text).toBe('Es sind 3 Spieler online');
  });

  it('entdoppelt innerhalb desselben Prozesses weiterhin', () => {
    const puffer = appendConsoleLines([], [line(`${SERVER}-a1b2c3d4e5f6-1`, '> list')]);
    const erneut = appendConsoleLine(puffer, line(`${SERVER}-a1b2c3d4e5f6-1`, '> list'));

    expect(erneut).toHaveLength(1);
  });
});
