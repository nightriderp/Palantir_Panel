import { describe, expect, it } from 'vitest';
import { desktopBedienbar, desktopHinweis } from './desktop';

/**
 * Der Schalter für Browser-Mitteilungen steht an zwei Stellen (Karte über dem
 * Posteingang, Zeile in den Einstellungen). Beschriftung und Bedienbarkeit
 * liegen deshalb als reine Funktionen hier, statt in einer der beiden Ansichten
 * – sonst driften die Texte auseinander.
 */
describe('desktopBedienbar', () => {
  it('ist bedienbar, solange nichts dagegen spricht', () => {
    expect(desktopBedienbar('default')).toBe(true);
    expect(desktopBedienbar('granted')).toBe(true);
  });

  it('ist tot ohne Unterstützung oder nach einer Sperre', () => {
    expect(desktopBedienbar('unsupported')).toBe(false);
    expect(desktopBedienbar('denied')).toBe(false);
  });
});

describe('desktopHinweis', () => {
  it('sagt bei einer Sperre, wo sie aufzuheben ist', () => {
    expect(desktopHinweis('denied')).toContain('Browser');
    expect(desktopHinweis('denied')).toContain('freigeben');
  });

  it('unterscheidet fehlende Unterstützung von der Sperre', () => {
    expect(desktopHinweis('unsupported')).not.toBe(desktopHinweis('denied'));
  });

  it('erklärt sonst, was der Schalter bewirkt', () => {
    expect(desktopHinweis('default')).toBe(desktopHinweis('granted'));
    expect(desktopHinweis('granted')).toContain('außerhalb des Panels');
  });
});
