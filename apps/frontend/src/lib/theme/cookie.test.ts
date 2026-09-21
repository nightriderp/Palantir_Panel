import { describe, expect, it } from 'vitest';
import { THEME_COOKIE, themeCookieZeile } from './cookie';

describe('themeCookieZeile', () => {
  it('schreibt Kennung, Pfad, Haltbarkeit und SameSite', () => {
    const zeile = themeCookieZeile('schmiedefeuer', false);

    expect(zeile).toContain(`${THEME_COOKIE}=schmiedefeuer`);
    expect(zeile).toContain('path=/');
    expect(zeile).toContain('samesite=lax');
    expect(zeile).toMatch(/max-age=\d+/);
  });

  it('hält die Wahl ein Jahr', () => {
    expect(themeCookieZeile('standard', false)).toContain(`max-age=${String(60 * 60 * 24 * 365)}`);
  });

  /*
   * `Secure` gehört in den Betrieb und darf in der Entwicklung nicht stehen:
   * Über `http://localhost` nimmt der Browser ein `Secure`-Cookie nicht an –
   * das Umschalten hätte dort schlicht keine Wirkung, und zwar nur dort.
   */
  it('setzt `secure` nur über HTTPS', () => {
    expect(themeCookieZeile('standard', true)).toContain('secure');
    expect(themeCookieZeile('standard', false)).not.toContain('secure');
  });

  it('kodiert die Kennung, statt sie roh einzusetzen', () => {
    expect(themeCookieZeile('a b;c', false)).toContain(`${THEME_COOKIE}=a%20b%3Bc`);
  });
});
