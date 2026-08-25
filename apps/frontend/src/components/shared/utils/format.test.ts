import { describe, expect, it } from 'vitest';
import {
  clampPercent,
  formatMegabytes,
  formatPercent,
  formatPing,
  formatPlayers,
  formatServerAddress,
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
