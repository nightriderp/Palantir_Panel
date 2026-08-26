import { PASSWORD_MIN_LENGTH } from '@palantir/validation';
import { describe, expect, it } from 'vitest';
import { generateTemporaryPassword, hashPassword, verifyPassword } from './passwords.js';

describe('Passwort-Hashing (Pflichtenheft §7, §18)', () => {
  it('nutzt Argon2id', async () => {
    const hash = await hashPassword('ein-langes-testpasswort');

    expect(hash.startsWith('$argon2id$')).toBe(true);
  });

  it('erzeugt für dasselbe Passwort unterschiedliche Hashes (Salt)', async () => {
    const [first, second] = await Promise.all([
      hashPassword('ein-langes-testpasswort'),
      hashPassword('ein-langes-testpasswort'),
    ]);

    expect(first).not.toBe(second);
  });

  it('erkennt das richtige Passwort und lehnt ein falsches ab', async () => {
    const hash = await hashPassword('ein-langes-testpasswort');

    expect(await verifyPassword(hash, 'ein-langes-testpasswort')).toBe(true);
    expect(await verifyPassword(hash, 'ein-langes-testpasswort ')).toBe(false);
    expect(await verifyPassword(hash, '')).toBe(false);
  });

  it('behandelt einen beschädigten Hash als „passt nicht" statt als Fehler', async () => {
    // Ein einzelner kaputter Datensatz soll eine reguläre Abweisung erzeugen,
    // keinen Serverfehler.
    await expect(verifyPassword('kein-argon2-hash', 'irgendwas')).resolves.toBe(false);
  });
});

describe('Einmal-Passwort für den Admin-Reset (Lastenheft §3.1)', () => {
  it('ist länger als die Mindestlänge aus dem Pflichtenheft', () => {
    expect(generateTemporaryPassword().length).toBeGreaterThan(PASSWORD_MIN_LENGTH);
  });

  it('vermeidet verwechselbare Zeichen', () => {
    // Der Admin liest das Passwort ab und gibt es weiter.
    for (let round = 0; round < 50; round += 1) {
      expect(generateTemporaryPassword()).not.toMatch(/[IlO01]/);
    }
  });

  it('ist bei jedem Aufruf ein anderes', () => {
    expect(generateTemporaryPassword()).not.toBe(generateTemporaryPassword());
  });
});
