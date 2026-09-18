import { describe, expect, it } from 'vitest';
import { liveAnzeige } from './liveBadge';

/**
 * Die Anzeige flackerte beim Wiederverbinden: Ein Fehlversuch dauert wenige
 * Millisekunden, die erste Wartezeit eine halbe Sekunde – bei drei Texten für
 * drei Zustände sprang die Beschriftung mehrmals pro Sekunde. Geprüft wird
 * deshalb vor allem, dass `connecting` und `closed` dasselbe ergeben.
 */
describe('liveAnzeige', () => {
  it('meldet die stehende Verbindung', () => {
    const anzeige = liveAnzeige('open', false);
    expect(anzeige.label).toBe('Live verbunden');
    expect(anzeige.tone).toBe('success');
  });

  it('sieht bei kurzem Aussetzer gleich aus, egal ob gerade verbunden oder geschlossen', () => {
    const beimVersuch = liveAnzeige('connecting', false);
    const nachAbbruch = liveAnzeige('closed', false);

    expect(beimVersuch).toEqual(nachAbbruch);
    expect(beimVersuch.label).toBe('Wird verbunden …');
  });

  it('wird erst nach der Schwelle zum Ausfall', () => {
    expect(liveAnzeige('closed', true).label).toBe('Nicht verbunden');
    expect(liveAnzeige('connecting', true).label).toBe('Nicht verbunden');
    expect(liveAnzeige('closed', true).tone).toBe('danger');
  });

  it('sagt im Ausfall, was das für die Bedienung heißt', () => {
    // „Nicht verbunden" allein beantwortet die Frage nicht, was jetzt anders ist.
    expect(liveAnzeige('closed', true).title).toContain('veraltet');
  });

  it('hat für die schmale Kopfleiste je Zustand ein eigenes Wort (Befund 12.8)', () => {
    const woerter = [
      liveAnzeige('open', false).shortLabel,
      liveAnzeige('closed', false).shortLabel,
      liveAnzeige('closed', true).shortLabel,
    ];
    expect(new Set(woerter).size).toBe(3);
    for (const wort of woerter) expect(wort.length).toBeLessThanOrEqual(12);
  });

  it('bleibt bei bestätigtem Ausfall ruhig', () => {
    expect(liveAnzeige('closed', true).pulse).toBe(false);
    expect(liveAnzeige('connecting', false).pulse).toBe(true);
  });
});
