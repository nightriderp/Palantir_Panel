/**
 * Zusicherungen, die in der Datenbank stehen (Audit-Maßnahme W2-28,
 * `backend-db-11`).
 *
 * `schema/users.test.ts` und `schema/auth.test.ts` prüfen bislang den **Text**
 * der Migrationen – sie belegen, dass die Objekte angelegt und nirgends wieder
 * gedroppt werden. Was sie nicht belegen können: dass die Bedingungen im
 * laufenden PostgreSQL auch greifen. Genau das steht hier, und zwar gegen die
 * Migrationskette, nicht gegen ein Schema-Abbild.
 *
 * Zwei Zusicherungen sind sicherheitsrelevant und deshalb ausdrücklich
 * abgedeckt:
 *
 * - Das Audit-Log ist **append-only** (Trigger `audit_log_append_only` /
 *   `audit_log_no_truncate`, Migration 0005). Ausnahme ist allein die
 *   Archivierung: Sie weist sich über `palantir.audit_archive` aus und darf nur
 *   Einträge älter als 24 Monate entfernen.
 * - `auth_methods` lässt keine widersprüchlichen Login-Methoden zu (drei
 *   Check-Bedingungen, Migration 0006).
 *
 * Läuft nur mit `DATABASE_URL` **und** `PALANTIR_TEST_DB=1`.
 */

import { expect, it } from 'vitest';
import { type Ausfuehren, describeDatenbank } from '../test-support/db.js';
import { legeNutzerAn } from '../test-support/fixtures.js';

/** Legt einen Audit-Eintrag an und gibt dessen Id zurück. */
async function legeEintragAn(roh: Ausfuehren, alterInMonaten = 0): Promise<string> {
  const zeilen = await roh(
    `insert into audit_log (action, actor_display_name, "timestamp")
       values ($1, $2, now() - make_interval(months => $3::int))
       returning id`,
    ['auth.loginSucceeded', 'Testlauf', alterInMonaten],
  );

  const id = zeilen[0]?.id;

  if (typeof id !== 'string') {
    throw new Error('Der Audit-Eintrag konnte nicht angelegt werden.');
  }

  return id;
}

describeDatenbank('Zusicherungen der Datenbank', (kontext) => {
  it('nimmt neue Audit-Einträge an', async () => {
    const id = await legeEintragAn(kontext.roh);
    const zeilen = await kontext.roh(
      'select count(*)::int as anzahl from audit_log where id = $1',
      [id],
    );

    expect(zeilen[0]?.anzahl).toBe(1);
  });

  it('verweigert jede Änderung an einem Audit-Eintrag', async () => {
    const id = await legeEintragAn(kontext.roh);

    await expect(
      kontext.roh('update audit_log set action = $1 where id = $2', ['auth.loggedOut', id]),
    ).rejects.toThrow(/AUDIT_ENTRY_IMMUTABLE/);

    // Der Eintrag steht unverändert da.
    const zeilen = await kontext.roh('select action from audit_log where id = $1', [id]);
    expect(zeilen[0]?.action).toBe('auth.loginSucceeded');
  });

  it('verweigert das Löschen eines Audit-Eintrags ohne Archiv-Ausweis', async () => {
    const id = await legeEintragAn(kontext.roh);

    await expect(kontext.roh('delete from audit_log where id = $1', [id])).rejects.toThrow(
      /AUDIT_ENTRY_IMMUTABLE/,
    );
  });

  it('verweigert das Leeren des Audit-Logs', async () => {
    await legeEintragAn(kontext.roh);

    // Statement-Trigger `audit_log_no_truncate`.
    await expect(kontext.roh('truncate table audit_log')).rejects.toThrow(/AUDIT_ENTRY_IMMUTABLE/);
  });

  it('lässt auch mit Archiv-Ausweis nur Einträge älter als 24 Monate löschen', async () => {
    const jung = await kontext.roh(
      `insert into audit_log (action, "timestamp") values ($1, now() - interval '6 months') returning id`,
      ['auth.loginSucceeded'],
    );
    const id = jung[0]?.id;

    await expect(
      kontext.sitzung(async (ausfuehren) => {
        await ausfuehren('begin');

        try {
          await ausfuehren(`set local palantir.audit_archive = 'on'`);
          await ausfuehren('delete from audit_log where id = $1', [id]);
          await ausfuehren('commit');
        } catch (fehler: unknown) {
          await ausfuehren('rollback');
          throw fehler;
        }
      }),
    ).rejects.toThrow(/AUDIT_ENTRY_IMMUTABLE/);
  });

  it('lässt die Archivierung alter Einträge zu', async () => {
    const id = await legeEintragAn(kontext.roh, 30);

    await kontext.sitzung(async (ausfuehren) => {
      await ausfuehren('begin');
      await ausfuehren(`set local palantir.audit_archive = 'on'`);
      await ausfuehren('delete from audit_log where id = $1', [id]);
      await ausfuehren('commit');
    });

    const zeilen = await kontext.roh(
      'select count(*)::int as anzahl from audit_log where id = $1',
      [id],
    );

    expect(zeilen[0]?.anzahl).toBe(0);
  });

  it('lässt nur die vier bekannten Arten von Login-Methoden zu', async () => {
    const nutzer = await legeNutzerAn(kontext.db);

    await expect(
      kontext.roh(
        'insert into auth_methods (user_id, type, provider_user_id) values ($1, $2, $3)',
        [nutzer, 'facebook', 'fb-1'],
      ),
    ).rejects.toThrow(/auth_methods_type_check/);
  });

  it('verlangt beim Passwort-Verfahren einen Hash und keine Provider-Kennung', async () => {
    const nutzer = await legeNutzerAn(kontext.db);

    // Passwort-Methode ohne Hash.
    await expect(
      kontext.roh('insert into auth_methods (user_id, type) values ($1, $2)', [nutzer, 'password']),
    ).rejects.toThrow(/auth_methods_shape_check/);

    // Passwort-Methode mit Provider-Kennung.
    await expect(
      kontext.roh(
        'insert into auth_methods (user_id, type, password_hash, provider_user_id) values ($1, $2, $3, $4)',
        [nutzer, 'password', '$argon2id$attrappe', 'discord-1'],
      ),
    ).rejects.toThrow(/auth_methods_shape_check/);
  });

  it('verlangt bei einem Provider eine Kennung und kein Passwort', async () => {
    const nutzer = await legeNutzerAn(kontext.db);

    await expect(
      kontext.roh('insert into auth_methods (user_id, type) values ($1, $2)', [nutzer, 'discord']),
    ).rejects.toThrow(/auth_methods_shape_check/);

    await expect(
      kontext.roh(
        'insert into auth_methods (user_id, type, provider_user_id, password_hash) values ($1, $2, $3, $4)',
        [nutzer, 'discord', 'discord-2', '$argon2id$attrappe'],
      ),
    ).rejects.toThrow(/auth_methods_shape_check/);
  });

  it('lässt ein TOTP-Geheimnis nur am Passwort-Verfahren zu', async () => {
    const nutzer = await legeNutzerAn(kontext.db);

    await expect(
      kontext.roh(
        'insert into auth_methods (user_id, type, provider_user_id, totp_secret) values ($1, $2, $3, $4)',
        [nutzer, 'twitch', 'twitch-1', 'GEHEIM'],
      ),
    ).rejects.toThrow(/auth_methods_totp_password_only_check/);

    // Am Passwort-Verfahren ist dasselbe Geheimnis erlaubt.
    await expect(
      kontext.roh(
        'insert into auth_methods (user_id, type, password_hash, totp_secret) values ($1, $2, $3, $4)',
        [nutzer, 'password', '$argon2id$attrappe', 'GEHEIM'],
      ),
    ).resolves.toBeDefined();
  });

  it('lässt je Konto nur eine Methode desselben Typs zu', async () => {
    const nutzer = await legeNutzerAn(kontext.db);

    await kontext.roh(
      'insert into auth_methods (user_id, type, password_hash) values ($1, $2, $3)',
      [nutzer, 'password', '$argon2id$attrappe'],
    );

    // `auth_methods_user_type_idx`
    await expect(
      kontext.roh('insert into auth_methods (user_id, type, password_hash) values ($1, $2, $3)', [
        nutzer,
        'password',
        '$argon2id$zweiter',
      ]),
    ).rejects.toThrow(/auth_methods_user_type_idx/);
  });

  it('lässt dieselbe Provider-Kennung nicht zweimal zu', async () => {
    const einer = await legeNutzerAn(kontext.db);
    const anderer = await legeNutzerAn(kontext.db);

    await kontext.roh(
      'insert into auth_methods (user_id, type, provider_user_id) values ($1, $2, $3)',
      [einer, 'steam', 'steam-1'],
    );

    // `auth_methods_provider_identity_idx` (partiell, nur bei gesetzter Kennung).
    await expect(
      kontext.roh(
        'insert into auth_methods (user_id, type, provider_user_id) values ($1, $2, $3)',
        [anderer, 'steam', 'steam-1'],
      ),
    ).rejects.toThrow(/auth_methods_provider_identity_idx/);
  });
});
