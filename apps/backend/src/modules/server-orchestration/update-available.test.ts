import { describe, expect, it } from 'vitest';
import { updateAvailable } from './dto.js';

/**
 * „Update verfügbar" (Mockup-Abgleich 3.4).
 *
 * Verglichen wird das Image, mit dem der Container **angelegt** wurde, gegen
 * das der heutigen Spiel-Definition. Die Fälle hier halten fest, wann daraus
 * eine Aussage wird und wann bewusst keine.
 */
describe('updateAvailable', () => {
  const AKTUELL = 'ghcr.io/palantir/echo:1.28';

  it('meldet eine ältere Fassung', () => {
    expect(updateAvailable('ghcr.io/palantir/echo:1.27', AKTUELL)).toBe(true);
  });

  it('schweigt bei gleicher Fassung', () => {
    expect(updateAvailable(AKTUELL, AKTUELL)).toBe(false);
  });

  it('schweigt ohne Container', () => {
    // Auch Server, die vor der Spalte angelegt wurden, haben `null`: Über die
    // lässt sich nachträglich nichts feststellen, und eine Vermutung wäre
    // schlechter als keine Aussage.
    expect(updateAvailable(null, AKTUELL)).toBe(false);
  });

  it('erkennt auch einen Wechsel der Registry', () => {
    expect(updateAvailable('docker.io/palantir/echo:1.28', AKTUELL)).toBe(true);
  });
});
