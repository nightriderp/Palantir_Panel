import type { Permission } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import { accountsFromRows, type AccountRow } from './repository.js';

/** Die Rollen, wie sie auf der Instanz stehen (Stand 2026-09-23). */
const NUTZER: readonly Permission[] = [
  'server.create',
  'server.view.own',
  'server.manage.own',
  'server.delete.own',
  'backup.manage.own',
  'server.view.any',
  'node.view',
];
const ADMIN: readonly Permission[] = [...NUTZER, 'server.manage.any', 'user.manage'];

function zeile(userId: string, overrides: Partial<AccountRow> = {}): AccountRow {
  return {
    userId,
    isOwner: false,
    banned: false,
    roleName: 'Nutzer',
    permissions: NUTZER,
    ...overrides,
  };
}

/**
 * Wer auf Discord alle Server-Kanäle sieht (Pflichtenheft §14a.3).
 *
 * Befund des Betreibers vom 2026-09-23: Die Rolle „Nutzer" trägt
 * `server.view.any`, und bis dahin sah deshalb jeder Nutzer jede Kategorie.
 */
describe('accountsFromRows', () => {
  it('macht ein Konto mit server.view.any nicht zum Admin', () => {
    const { adminUserIds } = accountsFromRows([zeile('b')], []);

    expect(adminUserIds.has('b')).toBe(false);
  });

  it('zählt server.manage.any und das Owner-Konto als Admin', () => {
    const { adminUserIds } = accountsFromRows(
      [
        zeile('admin', { roleName: 'Admin', permissions: ADMIN }),
        // Der Owner steht außerhalb der Rollen, auch mit der Rolle „Gast".
        zeile('owner', { isOwner: true, roleName: 'Gast', permissions: [] }),
      ],
      [],
    );

    expect([...adminUserIds].sort()).toEqual(['admin', 'owner']);
  });

  it('zählt ein gesperrtes Konto nie als Admin', () => {
    const { adminUserIds } = accountsFromRows(
      [zeile('admin', { roleName: 'Admin', permissions: ADMIN, banned: true })],
      [],
    );

    expect(adminUserIds.size).toBe(0);
  });

  it('führt nur freigeschaltete Konten mit ihrer Discord-Id', () => {
    const { linkedDiscordIds } = accountsFromRows(
      [
        zeile('a'),
        zeile('wartend', { roleName: 'Gast', permissions: [] }),
        zeile('gesperrt', { banned: true }),
      ],
      [
        { userId: 'a', discordUserId: 'd-a' },
        { userId: 'wartend', discordUserId: 'd-w' },
        { userId: 'gesperrt', discordUserId: 'd-g' },
      ],
    );

    expect([...linkedDiscordIds]).toEqual([['a', 'd-a']]);
  });

  it('fasst mehrere Rollen eines Kontos zusammen', () => {
    const { adminUserIds } = accountsFromRows(
      [zeile('x'), zeile('x', { roleName: 'Admin', permissions: ADMIN })],
      [],
    );

    expect(adminUserIds.has('x')).toBe(true);
  });
});
