import { describe, expect, it } from 'vitest';
import {
  clampPercent,
  formatBytes,
  formatChatTime,
  formatCores,
  formatDate,
  formatImageUpdate,
  formatImageVersion,
  formatDateTime,
  formatDuration,
  formatUptimeClock,
  formatMegabytes,
  formatMegabytesKurz,
  formatPercent,
  formatPing,
  formatPlayers,
  formatRelativeTime,
  formatServerAddress,
  formatTime,
  serverInitials,
} from './format';

describe('clampPercent', () => {
  it('begrenzt auf 0 bis 100 und rundet', () => {
    expect(clampPercent(-12)).toBe(0);
    expect(clampPercent(42.4)).toBe(42);
    expect(clampPercent(42.6)).toBe(43);
    expect(clampPercent(180)).toBe(100);
  });
});

describe('formatMegabytes', () => {
  it('bleibt unterhalb von 1 GB bei Megabyte', () => {
    // 512 MiB sind 537 MB - umgerechnet, nicht umbeschriftet.
    expect(formatMegabytes(512)).toBe('537 MB');
  });

  it('rechnet in Gigabyte um', () => {
    expect(formatMegabytes(2048)).toBe('2,15 GB');
    expect(formatMegabytes(1536)).toBe('1,61 GB');
  });

  it('rechnet sehr große Werte in Terabyte um', () => {
    expect(formatMegabytes(2 * 1024 * 1024)).toBe('2,2 TB');
  });

  it('zeigt fehlende Werte als Gedankenstrich', () => {
    expect(formatMegabytes(null)).toBe('—');
    expect(formatMegabytes(undefined)).toBe('—');
  });
});

describe('formatPercent / formatPing / formatPlayers', () => {
  it('formatiert Prozentwerte', () => {
    expect(formatPercent(73.2)).toBe('73 %');
    expect(formatPercent(null)).toBe('—');
  });

  it('formatiert Latenzen', () => {
    expect(formatPing(24)).toBe('24 ms');
    expect(formatPing(null)).toBe('—');
  });

  it('formatiert Spielerzahlen', () => {
    expect(formatPlayers(3, 20)).toBe('3 / 20');
    expect(formatPlayers(3, null)).toBe('3');
    expect(formatPlayers(null, 20)).toBe('—');
  });
});

describe('formatServerAddress', () => {
  it('hängt den Port an, wenn einer sichtbar ist', () => {
    expect(formatServerAddress({ hostname: 'welt.example.org', port: 25565 })).toBe(
      'welt.example.org:25565',
    );
  });

  it('lässt den Port bei Hostname-Routing weg (Pflichtenheft §13)', () => {
    expect(formatServerAddress({ hostname: 'welt.example.org', port: null })).toBe(
      'welt.example.org',
    );
  });

  it('liefert null, wenn keine Adresse freigegeben ist', () => {
    expect(formatServerAddress(null)).toBeNull();
  });
});

describe('serverInitials', () => {
  it('nimmt die ersten beiden verwertbaren Zeichen', () => {
    expect(serverInitials('Grüne Insel')).toBe('GR');
    expect(serverInitials('7 Days')).toBe('7D');
  });

  it('fällt auf ?? zurück, wenn der Name keine Buchstaben enthält', () => {
    expect(serverInitials('--- ***')).toBe('??');
  });
});

describe('Datums- und Zeitformate', () => {
  const iso = '2026-08-26T12:05:00.000Z';

  it('meldet „—“ bei fehlender oder unlesbarer Angabe', () => {
    for (const format of [formatDate, formatDateTime, formatTime]) {
      expect(format(null)).toBe('—');
      expect(format(undefined)).toBe('—');
      expect(format('kein Datum')).toBe('—');
    }
  });

  it('schreibt das Datum aus', () => {
    expect(formatDate(iso)).toMatch(/^\d{1,2}\. \p{L}+ \d{4}$/u);
  });

  it('gibt Datum und Uhrzeit in deutscher Schreibweise aus', () => {
    expect(formatDateTime(iso)).toMatch(/^\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}$/);
  });

  it('gibt die Uhrzeit ohne Datum aus', () => {
    expect(formatTime(iso)).toMatch(/^\d{2}:\d{2}$/);
  });
});

describe('formatUptimeClock', () => {
  it('zeigt Sekunden, solange es keine Minute ist', () => {
    expect(formatUptimeClock(22)).toBe('22 s');
  });

  it('zeigt Minuten mit laufender Sekunde - es ist eine Uhr', () => {
    // `formatDuration` gaebe hier "4 min" und staende eine Minute lang still.
    expect(formatUptimeClock(249)).toBe('4:09 min');
  });

  it('zeigt Stunden mit zweistelliger Minute', () => {
    expect(formatUptimeClock(12 * 3600 + 4 * 60 + 9)).toBe('12 h 04 min');
  });

  it('zeigt Tage, Stunden und Minuten', () => {
    expect(formatUptimeClock(3 * 86_400 + 12 * 3600 + 4 * 60)).toBe('3 d 12 h 04 min');
  });

  it('meldet fehlende und negative Angaben als Strich', () => {
    expect(formatUptimeClock(null)).toBe('—');
    expect(formatUptimeClock(-5)).toBe('—');
  });
});

describe('formatMegabytesKurz', () => {
  it('liefert — für fehlende Angaben', () => {
    expect(formatMegabytesKurz(null)).toBe('—');
    expect(formatMegabytesKurz(undefined)).toBe('—');
  });

  it('rundet auf höchstens zwei geltende Ziffern, damit der Wert in den Ring passt', () => {
    // 5 830 MiB = 6,11 GB in der vollen Fassung – im Ring nur „6,1 GB".
    expect(formatMegabytesKurz(5830)).toBe('6,1 GB');
    expect(formatMegabytesKurz(805)).toBe('844 MB');
    expect(formatMegabytesKurz(2048)).toBe('2,1 GB');
    expect(formatMegabytesKurz(2 * 1024 * 1024)).toBe('2,2 TB');
  });

  it('lässt ab zehn die Nachkommastelle weg, statt „10,0 GB" zu schreiben', () => {
    expect(formatMegabytesKurz(9536)).toBe('10 GB');
    expect(formatMegabytesKurz(15_000)).toBe('16 GB');
  });

  it('bleibt bei jedem Wert unter sieben Zeichen', () => {
    for (const mb of [1, 12, 123, 805, 1024, 5830, 9536, 15_000, 123_456, 2 * 1024 * 1024]) {
      expect(formatMegabytesKurz(mb).length).toBeLessThanOrEqual(6);
    }
  });
});

describe('formatBytes', () => {
  it('liefert — für fehlende Angaben', () => {
    expect(formatBytes(null)).toBe('—');
    expect(formatBytes(undefined)).toBe('—');
  });

  it('rechnet mit Basis 1000 und drei geltenden Ziffern', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1000)).toBe('1 kB');
    expect(formatBytes(1500)).toBe('1,5 kB');
    expect(formatBytes(1000 ** 2)).toBe('1 MB');
    expect(formatBytes(1000 ** 3)).toBe('1 GB');
    expect(formatBytes(1000 ** 4)).toBe('1 TB');
  });

  it('bleibt bei sehr großen Werten in TB', () => {
    expect(formatBytes(5 * 1000 ** 4)).toBe('5 TB');
  });
});

describe('formatDuration', () => {
  it('liefert — bei fehlender oder negativer Angabe', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(-5)).toBe('—');
  });

  it('staffelt Sekunden, Minuten, Stunden und Tage', () => {
    expect(formatDuration(45)).toBe('45 s');
    expect(formatDuration(120)).toBe('2 min');
    expect(formatDuration(3600 * 2 + 60 * 15)).toBe('2 h 15 min');
    expect(formatDuration(86400 * 3 + 3600 * 4)).toBe('3 d 4 h');
  });
});

describe('formatRelativeTime', () => {
  const jetzt = new Date('2026-08-31T12:00:00Z');

  it('liefert — ohne brauchbare Angabe', () => {
    expect(formatRelativeTime(null, jetzt)).toBe('—');
    expect(formatRelativeTime('kein Datum', jetzt)).toBe('—');
  });

  it('fasst die letzte Dreiviertelminute zusammen', () => {
    expect(formatRelativeTime('2026-08-31T11:59:30Z', jetzt)).toBe('gerade eben');
  });

  it('staffelt Minuten, Stunden und Tage', () => {
    expect(formatRelativeTime('2026-08-31T11:48:00Z', jetzt)).toBe('vor 12 Min.');
    expect(formatRelativeTime('2026-08-31T09:00:00Z', jetzt)).toBe('vor 3 Std.');
    expect(formatRelativeTime('2026-08-30T12:00:00Z', jetzt)).toBe('gestern');
  });

  it('wechselt ab einer Woche auf das Datum', () => {
    expect(formatRelativeTime('2026-08-20T12:00:00Z', jetzt)).toBe(
      formatDate('2026-08-20T12:00:00Z'),
    );
  });
});

describe('formatChatTime', () => {
  const jetzt = new Date(2026, 7, 31, 14, 0);

  it('zeigt am selben Tag nur die Uhrzeit', () => {
    expect(formatChatTime(new Date(2026, 7, 31, 9, 5).toISOString(), jetzt)).toBe('09:05');
  });

  it('nimmt an anderen Tagen das Datum dazu', () => {
    expect(formatChatTime(new Date(2026, 7, 30, 9, 5).toISOString(), jetzt)).toBe(
      '30.08.2026, 09:05',
    );
  });

  it('liefert — ohne brauchbare Angabe', () => {
    expect(formatChatTime(null, jetzt)).toBe('—');
  });
});

/*
 * Fundpunkt 205: `cpuPercent` zaehlt in Prozent eines Kerns. Die Serverkarte
 * klemmte den Wert bei 100 fest, die Detailkachel schrieb "250 %" hin - beides
 * beschreibt denselben Zustand falsch.
 */
describe('formatCores', () => {
  it('nutzt deutsches Dezimalkomma und die Einzahl', () => {
    expect(formatCores(7.5)).toBe('7,5 Kerne');
    // Fundpunkt 220 (UI-35): Die Serverdetails schrieben „1 Kerne".
    expect(formatCores(1)).toBe('1 Kern');
    expect(formatCores(2)).toBe('2 Kerne');
  });
});

describe('Image-Fassung', () => {
  it('setzt ein „v" davor und schreibt die Marke dreistellig', () => {
    // Betreiber-Wunsch 20.09.2026: die gewohnte Form vX.X.X. Die Zahl selbst
    // bleibt, was die Registry hergibt - nur die Schreibweise ist dreiteilig.
    expect(formatImageVersion('9')).toBe('v9.0.0');
    expect(formatImageVersion('9.1')).toBe('v9.1.0');
    expect(formatImageVersion('9.1.2')).toBe('v9.1.2');
  });

  it('laesst eine Marke in Ruhe, die keine reine Zaehlung ist', () => {
    // Aus „latest" eine Versionsnummer zu formen hiesse, etwas zu behaupten,
    // das die Registry nicht hergibt.
    expect(formatImageVersion('latest')).toBe('vlatest');
    expect(formatImageVersion('2026-09-20')).toBe('v2026-09-20');
    expect(formatImageVersion('1.2.3.4')).toBe('v1.2.3.4');
  });

  it('zeigt ohne bekannte Fassung nichts an', () => {
    expect(formatImageVersion(null)).toBeNull();
    expect(formatImageVersion(undefined)).toBeNull();
    expect(formatImageVersion('')).toBeNull();
  });

  it('nennt beim Update beide Fassungen', () => {
    expect(formatImageUpdate('7', '9')).toBe('v7.0.0 läuft, angeboten wird v9.0.0.');
  });

  it('ergänzt nichts, wenn eine Zahl fehlt oder beide gleich sind', () => {
    expect(formatImageUpdate('9', '9')).toBeNull();
    expect(formatImageUpdate(null, '9')).toBeNull();
    expect(formatImageUpdate('9', null)).toBeNull();
  });
});
