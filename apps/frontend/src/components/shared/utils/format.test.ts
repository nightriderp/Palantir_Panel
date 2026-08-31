import { describe, expect, it } from 'vitest';
import {
  clampPercent,
  formatBytes,
  formatDate,
  formatDateTime,
  formatDuration,
  formatMegabytes,
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
    expect(formatMegabytes(512)).toBe('512 MB');
  });

  it('rechnet ab 1024 MB in Gigabyte um', () => {
    expect(formatMegabytes(2048)).toBe('2 GB');
    expect(formatMegabytes(1536)).toBe('1,5 GB');
  });

  it('rechnet sehr große Werte in Terabyte um', () => {
    expect(formatMegabytes(2 * 1024 * 1024)).toBe('2 TB');
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

describe('formatBytes', () => {
  it('liefert — für fehlende Angaben', () => {
    expect(formatBytes(null)).toBe('—');
    expect(formatBytes(undefined)).toBe('—');
  });

  it('rechnet mit Basis 1024 und rundet auf eine Nachkommastelle', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1,5 KB');
    expect(formatBytes(1024 * 1024)).toBe('1 MB');
    expect(formatBytes(1024 ** 3)).toBe('1 GB');
    expect(formatBytes(1024 ** 4)).toBe('1 TB');
  });

  it('bleibt bei sehr großen Werten in TB', () => {
    expect(formatBytes(5 * 1024 ** 4)).toBe('5 TB');
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
    expect(formatRelativeTime('2026-08-20T12:00:00Z', jetzt)).toBe(formatDate('2026-08-20T12:00:00Z'));
  });
});
