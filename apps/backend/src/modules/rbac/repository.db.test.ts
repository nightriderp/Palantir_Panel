/**
 * Rollen-Repository gegen echtes SQL (Fundpunkt 234).
 *
 * Das Rollensystem ist auf der Regelebene dicht getestet (`roles.test.ts`,
 * `permissions.test.ts`) – aber ausschließlich gegen Attrappen, die ihre eigene
 * Semantik mitbringen. Ungeprüft blieb damit genau das, was nur PostgreSQL
 * entscheidet: der Vergleich ohne Rücksicht auf Groß- und Kleinschreibung, das
 * `group by` der Mitgliederzahl, die Verträglichkeit einer doppelten Zuweisung
 * (`on conflict do nothing`) und die Kaskade, mit der eine gelöschte Rolle ihre
 * Zuweisungen mitnimmt.
 *
 * Läuft nur mit `DATABASE_URL` **und** `PALANTIR_TEST_DB=1`.
 */

import { expect, it } from 'vitest';
import { describeDatenbank } from '../../test-support/db.js';
import { legeNutzerAn } from '../../test-support/fixtures.js';
import { RbacError } from './errors.js';
import { createDrizzleRoleRepository } from './repository.js';

describeDatenbank('Rollen-Repository gegen PostgreSQL', (kontext) => {
  it('legt eine Rolle an und liefert sie mit ihren Rechten zurück', async () => {
    const repository = createDrizzleRoleRepository(kontext.db);

    const angelegt = await repository.create({
      name: 'Moderation',
      description: 'Sieht die Meldungen durch',
      permissions: ['message.moderate', 'server.view.any'],
      isProtected: false,
    });

    expect(angelegt.name).toBe('Moderation');
    expect(angelegt.isProtected).toBe(false);
    // `permissions` ist eine `jsonb`-Spalte: Dass die Liste in derselben Form
    // zurückkommt, in der sie hineinging, entscheidet der Treiber – nicht der
    // Service.
    expect([...angelegt.permissions].sort()).toEqual(['message.moderate', 'server.view.any']);
    expect((await repository.findById(angelegt.id))?.name).toBe('Moderation');
  });

  it('findet eine Rolle ohne Rücksicht auf Groß- und Kleinschreibung', async () => {
    const repository = createDrizzleRoleRepository(kontext.db);
    await repository.create({
      name: 'Admin',
      description: null,
      permissions: [],
      isProtected: true,
    });

    // Der Service verlässt sich darauf, um „Admin" und „admin" nicht
    // nebeneinander entstehen zu lassen. Die Regel steht in einem `lower()`
    // auf beiden Seiten – eine Attrappe mit `Map` kann das nicht zeigen.
    expect((await repository.findByName('ADMIN'))?.name).toBe('Admin');
    expect((await repository.findByName('admin'))?.name).toBe('Admin');
    expect(await repository.findByName('Adminn')).toBeNull();
  });

  it('sortiert die Liste nach Namen', async () => {
    const repository = createDrizzleRoleRepository(kontext.db);

    for (const name of ['Zuschauer', 'Admin', 'Moderation']) {
      await repository.create({ name, description: null, permissions: [], isProtected: false });
    }

    expect((await repository.listAll()).map((rolle) => rolle.name)).toEqual([
      'Admin',
      'Moderation',
      'Zuschauer',
    ]);
  });

  it('meldet eine Änderung an einer verschwundenen Rolle als ROLE_NOT_FOUND', async () => {
    const repository = createDrizzleRoleRepository(kontext.db);

    // `update` liest keinen Datensatz vorher – es schreibt und sieht an der
    // leeren `returning`-Liste, dass nichts getroffen wurde. Genau dieser Pfad
    // läuft nur gegen echtes SQL.
    await expect(
      repository.update('11111111-1111-4111-8111-111111111111', { name: 'Neu' }),
    ).rejects.toBeInstanceOf(RbacError);
  });

  it('zählt die Mitglieder je Rolle und lässt leere Rollen weg', async () => {
    const repository = createDrizzleRoleRepository(kontext.db);
    const moderation = await repository.create({
      name: 'Moderation',
      description: null,
      permissions: [],
      isProtected: false,
    });
    const leer = await repository.create({
      name: 'Ungenutzt',
      description: null,
      permissions: [],
      isProtected: false,
    });
    const ersterNutzer = await legeNutzerAn(kontext.db);
    const zweiterNutzer = await legeNutzerAn(kontext.db);

    await repository.assignToUser(ersterNutzer, moderation.id);
    await repository.assignToUser(zweiterNutzer, moderation.id);

    const zahlen = await repository.countMembers();

    expect(zahlen.get(moderation.id)).toBe(2);
    // Das `group by` liefert für eine Rolle ohne Zuweisung gar keine Zeile –
    // die Ansicht muss daraus selbst eine 0 machen.
    expect(zahlen.has(leer.id)).toBe(false);
  });

  it('nimmt eine doppelte Zuweisung hin, statt daran zu scheitern', async () => {
    const repository = createDrizzleRoleRepository(kontext.db);
    const rolle = await repository.create({
      name: 'Moderation',
      description: null,
      permissions: [],
      isProtected: false,
    });
    const nutzer = await legeNutzerAn(kontext.db);

    await repository.assignToUser(nutzer, rolle.id);
    // Der zweite Aufruf trifft den zusammengesetzten Primärschlüssel. Ohne
    // `on conflict do nothing` käme hier ein 23505 – und der Zielzustand ist
    // derselbe wie nach dem ersten Aufruf.
    await expect(repository.assignToUser(nutzer, rolle.id)).resolves.toBeUndefined();

    expect((await repository.countMembers()).get(rolle.id)).toBe(1);
  });

  it('liefert die Rollen eines Kontos über den Join', async () => {
    const repository = createDrizzleRoleRepository(kontext.db);
    const moderation = await repository.create({
      name: 'Moderation',
      description: null,
      permissions: ['message.moderate'],
      isProtected: false,
    });
    const zuschauer = await repository.create({
      name: 'Zuschauer',
      description: null,
      permissions: [],
      isProtected: false,
    });
    const nutzer = await legeNutzerAn(kontext.db);
    const fremder = await legeNutzerAn(kontext.db);

    await repository.assignToUser(nutzer, moderation.id);
    await repository.assignToUser(nutzer, zuschauer.id);
    await repository.assignToUser(fremder, zuschauer.id);

    const eigene = await repository.listRolesForUser(nutzer);

    expect(eigene.map((rolle) => rolle.name).sort()).toEqual(['Moderation', 'Zuschauer']);
    // Die Rechte kommen aus der verbundenen Zeile, nicht aus der Zuweisung.
    expect(eigene.find((rolle) => rolle.name === 'Moderation')?.permissions).toEqual([
      'message.moderate',
    ]);
  });

  it('entfernt genau eine Zuweisung, nicht alle des Kontos', async () => {
    const repository = createDrizzleRoleRepository(kontext.db);
    const moderation = await repository.create({
      name: 'Moderation',
      description: null,
      permissions: [],
      isProtected: false,
    });
    const zuschauer = await repository.create({
      name: 'Zuschauer',
      description: null,
      permissions: [],
      isProtected: false,
    });
    const nutzer = await legeNutzerAn(kontext.db);

    await repository.assignToUser(nutzer, moderation.id);
    await repository.assignToUser(nutzer, zuschauer.id);
    await repository.removeFromUser(nutzer, moderation.id);

    expect((await repository.listRolesForUser(nutzer)).map((rolle) => rolle.name)).toEqual([
      'Zuschauer',
    ]);
  });

  it('nimmt beim Löschen einer Rolle ihre Zuweisungen mit', async () => {
    const repository = createDrizzleRoleRepository(kontext.db);
    const rolle = await repository.create({
      name: 'Moderation',
      description: null,
      permissions: [],
      isProtected: false,
    });
    const nutzer = await legeNutzerAn(kontext.db);
    await repository.assignToUser(nutzer, rolle.id);

    await repository.remove(rolle.id);

    // `on delete cascade` am Fremdschlüssel: Ohne die Kaskade bliebe die Zeile
    // in `user_roles` stehen und der Join lieferte danach gar nichts mehr –
    // oder das `DELETE` schlüge fehl.
    expect(await repository.findById(rolle.id)).toBeNull();
    expect(await repository.listRolesForUser(nutzer)).toEqual([]);
    expect((await repository.countMembers()).size).toBe(0);
  });
});
