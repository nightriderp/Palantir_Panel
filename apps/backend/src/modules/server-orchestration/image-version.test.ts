import { describe, expect, it } from 'vitest';
import { imageVersionLabel } from './image-version.js';

describe('Fassung aus der Image-Adresse', () => {
  it('liest die Marke hinter dem Doppelpunkt', () => {
    expect(imageVersionLabel('ghcr.io/nightriderp/palantir-game-minecraft:9')).toBe('9');
  });

  it('verwechselt den Port der Registry nicht mit der Marke', () => {
    // Der Doppelpunkt in `registry:5000` steht vor dem letzten Schraegstrich
    // und gehoert damit zum Rechnernamen, nicht zur Fassung.
    expect(imageVersionLabel('registry:5000/palantir/base-java')).toBeNull();
    expect(imageVersionLabel('registry:5000/palantir/base-java:5')).toBe('5');
  });

  it('gibt ohne Marke und ohne Adresse nichts zurueck', () => {
    expect(imageVersionLabel('palantir-game-minecraft')).toBeNull();
    expect(imageVersionLabel('palantir-game-minecraft:')).toBeNull();
    expect(imageVersionLabel(null)).toBeNull();
  });
});
