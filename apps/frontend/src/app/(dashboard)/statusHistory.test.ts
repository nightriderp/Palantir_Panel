import { describe, expect, it } from 'vitest';
import {
  STATUS_HISTORY_LIMIT,
  appendStatusSample,
  statusSeries,
  statusSpanLabel,
} from './statusHistory';

describe('appendStatusSample', () => {
  it('haengt eine Messung an', () => {
    const verlauf = appendStatusSample([], { ts: 1, values: { cpu: 10 } });

    expect(verlauf).toHaveLength(1);
    expect(verlauf[0]?.values.cpu).toBe(10);
  });

  it('deckelt den Verlauf und wirft die aeltesten weg', () => {
    /*
     * Ohne Deckelung wuechse die Liste bei einem Fenster, das ueber Nacht offen
     * bleibt, endlos - bei fuenf Sekunden Takt sind das ueber zehntausend
     * Eintraege bis zum Morgen.
     */
    let verlauf = appendStatusSample([], { ts: 0, values: { cpu: 0 } }, 3);
    for (const ts of [1, 2, 3, 4]) {
      verlauf = appendStatusSample(verlauf, { ts, values: { cpu: ts } }, 3);
    }

    expect(verlauf).toHaveLength(3);
    expect(verlauf.map((sample) => sample.ts)).toEqual([2, 3, 4]);
  });

  it('haelt eine Viertelstunde im Fuenf-Sekunden-Takt', () => {
    expect(STATUS_HISTORY_LIMIT * 5).toBe(900);
  });
});

describe('statusSeries', () => {
  it('laesst Messungen ohne diese Kennzahl aus, statt sie als Null zu zeichnen', () => {
    /*
     * „Unbekannt" ist keine Null: Ein Node, der gerade nichts meldet, ist nicht
     * ein Node bei null Prozent. Traegt man dafuer eine 0 ein, zeigt die Kurve
     * einen Einbruch, wo in Wahrheit nur niemand geantwortet hat.
     */
    const punkte = statusSeries(
      [
        { ts: 1, values: { cpu: 40 } },
        { ts: 2, values: {} },
        { ts: 3, values: { cpu: 60 } },
      ],
      'cpu',
    );

    expect(punkte).toEqual([
      { ts: 1, value: 40 },
      { ts: 3, value: 60 },
    ]);
  });
});

describe('statusSpanLabel', () => {
  it('sagt, dass noch gesammelt wird, solange eine Linie nicht reicht', () => {
    expect(statusSpanLabel([{ ts: 1, value: 1 }])).toBe('sammelt noch …');
  });

  it('nennt Sekunden unterhalb einer Minute nicht als „0 Min."', () => {
    expect(
      statusSpanLabel([
        { ts: 0, value: 1 },
        { ts: 20_000, value: 2 },
      ]),
    ).toBe('letzte Sekunden');
  });

  it('nennt die Spanne in Minuten', () => {
    expect(
      statusSpanLabel([
        { ts: 0, value: 1 },
        { ts: 12 * 60_000, value: 2 },
      ]),
    ).toBe('letzte 12 Min.');
  });
});
