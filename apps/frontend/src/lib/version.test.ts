import { describe, expect, it } from 'vitest';
import { APP_VERSION, APP_VERSION_LABEL } from './version';

describe('App-Version', () => {
  it('ist eine Semver-artige Zeichenkette', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('trägt in der Beschriftung ein vorangestelltes v', () => {
    expect(APP_VERSION_LABEL).toBe(`v${APP_VERSION}`);
  });
});
