import { describe, expect, it } from 'vitest';
import { DEV_VERSION_LABEL, versionLabel } from './version';

describe('Versionsbeschriftung (aus dem Deployment-Tag)', () => {
  it('stellt einer Semver-Version ein v voran', () => {
    expect(versionLabel('0.8.0')).toBe('v0.8.0');
  });

  it('lässt ein Tag, das schon mit v beginnt, unverändert', () => {
    expect(versionLabel('v0.8.0')).toBe('v0.8.0');
  });

  it('übernimmt einen Rückfallwert wie eine kurze Commit-SHA unverändert', () => {
    // `deploy.sh` trägt die kurze SHA ein, wenn zum Commit kein Tag gehört.
    expect(versionLabel('5248ded')).toBe('5248ded');
  });

  it('meldet ohne gesetzte Umgebungsvariable die Entwicklung', () => {
    expect(versionLabel(undefined)).toBe(DEV_VERSION_LABEL);
    expect(versionLabel('')).toBe(DEV_VERSION_LABEL);
    expect(versionLabel('   ')).toBe(DEV_VERSION_LABEL);
  });
});
