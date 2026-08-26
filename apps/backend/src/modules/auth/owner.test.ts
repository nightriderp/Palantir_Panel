/**
 * Ersteinrichtung des Owner-Kontos (Lastenheft §2, Pflichtenheft §12.3).
 *
 * Der Kern dieser Tests ist die Zusicherung „genau ein Konto trägt diesen
 * Status". Sie hängt in der Datenbank am partiellen Unique-Index
 * `users_single_owner_idx`; das Fake-Repository bildet ihn nach, damit die
 * Regel auch ohne laufende Datenbank prüfbar bleibt (CLAUDE.md §4).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { isAuthError } from './errors.js';
import { grantOwner, grantOwnerByUsername } from './owner.js';
import { type FakeAuthRepository, createFakeAuthRepository } from './test-doubles.js';

let repository: FakeAuthRepository;

/** Erwartet, dass ein Aufruf mit genau diesem Fehlercode scheitert. */
async function expectErrorCode(work: Promise<unknown>, code: string): Promise<void> {
  await expect(work).rejects.toSatisfy(
    (error: unknown) => isAuthError(error) && error.code === code,
    `Fehlercode ${code}`,
  );
}

beforeEach(() => {
  repository = createFakeAuthRepository();
});

describe('Owner-Ersteinrichtung (Lastenheft §2, Pflichtenheft §12.3)', () => {
  it('hebt ein vorhandenes Konto zum Owner', async () => {
    await repository.createUser({ username: 'betreiber', displayName: 'Betreiber' });

    const result = await grantOwnerByUsername(repository, 'betreiber');

    expect(result.granted).toBe(true);
    expect(result.user.isOwner).toBe(true);
    expect((await repository.findOwner())?.username).toBe('betreiber');
  });

  it('kennt die Anmeldekennung ohne Rücksicht auf Groß-/Kleinschreibung', async () => {
    // Deckungsgleich mit dem Login und dem Unique-Index
    // `users_username_lower_idx` (Pflichtenheft §7).
    await repository.createUser({ username: 'betreiber', displayName: 'Betreiber' });

    const result = await grantOwnerByUsername(repository, 'Betreiber');

    expect(result.user.isOwner).toBe(true);
  });

  it('legt kein Konto an, wenn es die Anmeldekennung nicht gibt', async () => {
    await expectErrorCode(grantOwnerByUsername(repository, 'gibtsnicht'), 'USER_NOT_FOUND');

    expect(repository.users).toHaveLength(0);
  });

  it('lässt genau ein Owner-Konto zu', async () => {
    const first = await repository.createUser({ username: 'erster', displayName: 'Erster' });
    await repository.createUser({ username: 'zweiter', displayName: 'Zweiter' });

    await grantOwner(repository, first);

    await expectErrorCode(grantOwnerByUsername(repository, 'zweiter'), 'OWNER_ALREADY_EXISTS');

    // Der bestehende Owner bleibt unangetastet – kein stiller Wechsel.
    expect(repository.users.filter((user) => user.isOwner).map((user) => user.id)).toEqual([
      first.id,
    ]);
  });

  it('ist idempotent: ein zweiter Lauf auf demselben Konto ist kein Fehler', async () => {
    // Dasselbe Verhalten wie beim Seed-Lauf der Rollen – ein wiederholter
    // Einrichtungsschritt darf nicht scheitern.
    await repository.createUser({ username: 'betreiber', displayName: 'Betreiber' });

    expect((await grantOwnerByUsername(repository, 'betreiber')).granted).toBe(true);

    const second = await grantOwnerByUsername(repository, 'betreiber');

    expect(second.granted).toBe(false);
    expect(second.user.isOwner).toBe(true);
    expect(repository.users.filter((user) => user.isOwner)).toHaveLength(1);
  });

  it('nennt im Fehlertext das Konto, das den Status trägt', async () => {
    const first = await repository.createUser({ username: 'erster', displayName: 'Erster' });
    await repository.createUser({ username: 'zweiter', displayName: 'Zweiter' });
    await grantOwner(repository, first);

    await expect(grantOwnerByUsername(repository, 'zweiter')).rejects.toThrow(/Erster/);
  });

  it('kennt keinen Weg, den Owner-Status wieder zu entziehen', () => {
    // Rein typseitige Zusicherung: Der Sonderstatus ist der Schutz davor, dass
    // sich niemand mehr anmelden kann (Lastenheft §2). Ein `clearOwner` im
    // Repository würde diesen Test brechen.
    expect(Object.keys(repository)).not.toContain('clearOwner');
    expect(Object.keys(repository)).not.toContain('removeOwner');
  });
});
