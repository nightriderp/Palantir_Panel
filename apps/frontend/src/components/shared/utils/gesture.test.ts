import { describe, expect, it } from 'vitest';
import { project, rubberband } from './gesture';

/**
 * Die beiden Funktionen entscheiden, wohin die Schublade beim Loslassen fährt
 * und wie weit sie sich über die Kante ziehen lässt. Beides ist reine Rechnung
 * und damit prüfbar, ohne einen Finger zu simulieren.
 */
describe('project', () => {
  it('steht still, wenn kein Schwung da ist', () => {
    expect(project(0)).toBe(0);
  });

  it('trägt in Wischrichtung weiter', () => {
    expect(project(1200)).toBeGreaterThan(0);
    expect(project(-1200)).toBeLessThan(0);
  });

  it('trägt umso weiter, je schneller gewischt wurde', () => {
    expect(project(2000)).toBeGreaterThan(project(500));
  });
});

describe('rubberband', () => {
  it('gibt am Anfang fast eins zu eins nach', () => {
    const weg = rubberband(10, 250);
    expect(weg).toBeGreaterThan(4);
    expect(weg).toBeLessThan(10);
  });

  it('bremst mit wachsender Strecke immer stärker', () => {
    const nah = rubberband(20, 250) / 20;
    const fern = rubberband(200, 250) / 200;
    expect(fern).toBeLessThan(nah);
  });

  it('bleibt auch bei großer Strecke unter der Bezugsgröße', () => {
    expect(rubberband(10_000, 250)).toBeLessThan(250);
  });

  it('behält die Richtung bei', () => {
    expect(rubberband(-40, 250)).toBeLessThan(0);
  });
});
