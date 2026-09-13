import { describe, expect, it } from 'vitest';
import { avatarUrl } from './api';

/**
 * Die Adresse trägt den Zeitstempel als Parameter. Ohne ihn zeigte der Browser
 * nach einem neuen Bild weiter das alte aus seinem Zwischenspeicher – der
 * Pfad bleibt ja derselbe.
 */
describe('avatarUrl', () => {
  const id = '22222222-0000-4000-8000-00000000000a';

  it('liefert null, wenn das Konto kein Bild hat', () => {
    expect(avatarUrl(id, null)).toBeNull();
    expect(avatarUrl(id, undefined)).toBeNull();
  });

  it('hängt den Zeitstempel an', () => {
    const url = avatarUrl(id, '2026-09-13T18:00:00.000Z');

    expect(url).toContain(`/users/${id}/avatar`);
    expect(url).toContain('v=2026-09-13T18%3A00%3A00.000Z');
  });

  it('wechselt mit dem Zeitstempel', () => {
    expect(avatarUrl(id, '2026-09-13T18:00:00.000Z')).not.toBe(
      avatarUrl(id, '2026-09-13T19:00:00.000Z'),
    );
  });
});
