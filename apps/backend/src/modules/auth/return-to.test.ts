import { describe, expect, it } from 'vitest';
import { LINK_RETURN_PATHS, sanitizeReturnTo } from './routes.js';

/**
 * Sicherheitsrelevant: `sanitizeReturnTo` verhindert einen Open-Redirect nach der
 * Provider-Verknüpfung. `frontendRedirect` baut das Ziel über `new URL(path, base)`
 * – ein absoluter Wert würde sonst nach außen zeigen. Nur die Pfade der Allowlist
 * dürfen durch; alles andere fällt auf die Übersicht zurück.
 */
describe('sanitizeReturnTo', () => {
  it('lässt genau die erlaubten internen Ziele durch', () => {
    for (const path of LINK_RETURN_PATHS) {
      expect(sanitizeReturnTo(path)).toBe(path);
    }
  });

  it('weist externe Ziele und Unfug auf die Übersicht ab', () => {
    for (const wert of [
      'https://evil.example',
      'http://evil.example',
      '//evil.example',
      '/servers/../../etc',
      '/beliebig',
      'javascript:alert(1)',
      '',
      '   ',
      undefined,
      null,
      42,
      '/profil?x=1',
    ]) {
      expect(sanitizeReturnTo(wert)).toBe('/servers');
    }
  });
});
