/**
 * Savepoint je Einfügeversuch bei der Portvergabe (Fundpunkt 135, Rest von
 * backend-db-04 aus W2-10).
 *
 * Die Vergabe fängt eine Kollision zweier paralleler Vorgänge über die
 * Unique-Verletzung des Index ab und versucht den nächsten freien Port. In
 * einer Transaktion ist ein Constraint-Fehler aber kein Einzelfall, den man
 * übergeht: PostgreSQL setzt die Transaktion in den Zustand „aborted"
 * (`SQLSTATE 25P02`), jede weitere Anweisung scheitert, bis zurückgerollt wird.
 * Genau deshalb lag die Vergabe bisher außerhalb der Reservierungs-Transaktion.
 *
 * `createDrizzlePortPoolRepository` stellt jeden Einfügeversuch in einen
 * eigenen Savepoint. Dieser Test belegt beides: dass der Savepoint gesetzt und
 * bei einer Kollision zurückgerollt wird – und dass ohne ihn genau der
 * Abbruch einträte, um den es geht.
 *
 * Geprüft **ohne** Datenbank: Ein Drizzle-Client, der das SQL mitschreibt und
 * die beiden Regeln von PostgreSQL nachbildet (Unique-Verletzung bricht die
 * Transaktion ab, `rollback` hebt den Abbruch auf). Was der echte Server dazu
 * sagt, prüft `server-orchestration/port-reservation.db.test.ts` in der CI.
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { describe, expect, it } from 'vitest';
import * as schema from '../../db/schema.js';
import { isUniqueViolation } from '../../db/errors.js';
import { portAllocations } from '../../db/schema/admin.js';
import { createDrizzlePortPoolRepository } from './repositories.js';

const RANGE_ID = '11111111-1111-4111-8111-111111111111';
const SERVER_ID = '22222222-2222-4222-8222-222222222222';

/** Fehler mit SQLSTATE, wie `pg` ihn liefert. */
function pgFehler(code: string, nachricht: string): Error {
  const fehler = new Error(nachricht) as Error & { code?: string };
  fehler.code = code;

  return fehler;
}

/**
 * Drizzle über einem Client, der nichts ausführt, aber die beiden Regeln
 * nachbildet, auf die es hier ankommt.
 *
 * Drizzle fragt mit `rowMode: 'array'` ab; eine Zeile ist deshalb eine
 * Werteliste in der Spaltenreihenfolge von `port_allocations` (`id`,
 * `range_id`, `port`, `protocol`, `server_id`, `allocated_at`).
 */
function dbMitProtokoll(kollisionBeiPort?: number) {
  const abfragen: string[] = [];
  let abgebrochen = false;
  let nummer = 0;

  const client = {
    async query(befehl: string | { text: string }, parameter?: unknown[]) {
      const text = typeof befehl === 'string' ? befehl : befehl.text;
      // `pg` bekommt die Werte als zweites Argument, nicht im Befehlsobjekt.
      const werte = parameter ?? [];

      abfragen.push(text);

      const istRuecknahme = /^rollback/i.test(text);

      // PostgreSQL: In einer abgebrochenen Transaktion läuft nur noch ein
      // Rollback – auch das Zurückrollen auf einen Savepoint.
      if (abgebrochen && !istRuecknahme) {
        throw pgFehler(
          '25P02',
          'current transaction is aborted, commands ignored until end of transaction block',
        );
      }

      if (istRuecknahme) {
        abgebrochen = false;
      }

      if (!text.startsWith('insert into "port_allocations"')) {
        return { rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] };
      }

      const port = werte.find((wert) => typeof wert === 'number');

      if (kollisionBeiPort !== undefined && port === kollisionBeiPort) {
        abgebrochen = true;

        throw pgFehler(
          '23505',
          'duplicate key value violates unique constraint "port_allocations_port_protocol_idx"',
        );
      }

      nummer += 1;

      return {
        rows: [
          [
            `33333333-3333-4333-8333-00000000000${String(nummer)}`,
            RANGE_ID,
            port,
            'udp',
            SERVER_ID,
            new Date('2026-09-06T10:00:00.000Z'),
          ],
        ],
        rowCount: 1,
        command: 'INSERT',
        oid: 0,
        fields: [],
      };
    },
  };

  // `drizzle` erwartet einen `pg`-Client; die Attrappe erfüllt davon die eine
  // Methode, die für `insert … returning` gebraucht wird.
  return { db: drizzle(client as never, { schema }), abfragen };
}

function zuordnung(port: number) {
  return { rangeId: RANGE_ID, port, protocol: 'udp' as const, serverId: SERVER_ID };
}

describe('Portvergabe innerhalb einer Transaktion (Fundpunkt 135)', () => {
  it('stellt jeden Einfügeversuch in einen eigenen Savepoint', async () => {
    const { db, abfragen } = dbMitProtokoll();

    await db.transaction(async (tx) => {
      await createDrizzlePortPoolRepository(tx).insertAllocation(zuordnung(27_000));
    });

    const kleingeschrieben = abfragen.map((sql) => sql.toLowerCase());

    expect(kleingeschrieben).toContain('savepoint sp1');
    expect(kleingeschrieben).toContain('release savepoint sp1');
    expect(kleingeschrieben).toContain('commit');
  });

  it('rollt bei einer Kollision nur den Savepoint zurück – die Transaktion lebt weiter', async () => {
    const { db, abfragen } = dbMitProtokoll(27_000);

    const vergeben = await db.transaction(async (tx) => {
      const repository = createDrizzlePortPoolRepository(tx);

      const kollision = await repository
        .insertAllocation(zuordnung(27_000))
        .then(() => null)
        .catch((fehler: unknown) => fehler);

      // Der Fehler kommt unverändert heraus – `ports.ts` erkennt daran die
      // Kollision und nimmt den nächsten freien Port.
      expect(isUniqueViolation(kollision)).toBe(true);

      return repository.insertAllocation(zuordnung(27_001));
    });

    expect(vergeben.port).toBe(27_001);

    const kleingeschrieben = abfragen.map((sql) => sql.toLowerCase());

    expect(kleingeschrieben).toContain('rollback to savepoint sp1');
    // Entscheidend: Die umgebende Transaktion wurde nicht zurückgerollt,
    // sondern festgeschrieben – der Server, der davor in ihr entstanden ist,
    // bleibt bestehen.
    expect(kleingeschrieben).toContain('commit');
    expect(kleingeschrieben).not.toContain('rollback');
  });

  it('bricht ohne Savepoint die ganze Transaktion ab – der Grund für den Umbau', async () => {
    const { db } = dbMitProtokoll(27_000);

    const fehler = await db
      .transaction(async (tx) => {
        await tx
          .insert(portAllocations)
          .values(zuordnung(27_000))
          .returning()
          .catch(() => undefined);

        // Ohne Savepoint steht die Transaktion nach der Kollision auf
        // „aborted"; der nächste Versuch scheitert an 25P02 statt an einem
        // belegten Port.
        return tx.insert(portAllocations).values(zuordnung(27_001)).returning();
      })
      .catch((ursache: unknown) => ursache);

    expect((fehler as { cause?: { code?: string }; code?: string }).cause?.code ?? null).toBe(
      '25P02',
    );
  });

  it('bleibt über dem Pool eine gewöhnliche kurze Transaktion', async () => {
    const { db, abfragen } = dbMitProtokoll();

    const vergeben = await createDrizzlePortPoolRepository(db).insertAllocation(zuordnung(27_000));

    expect(vergeben.port).toBe(27_000);

    const kleingeschrieben = abfragen.map((sql) => sql.toLowerCase());

    expect(kleingeschrieben[0]).toBe('begin');
    expect(kleingeschrieben).toContain('commit');
    // Kein Savepoint: Es gibt nichts, wovor er schützen müsste.
    expect(kleingeschrieben.some((sql) => sql.startsWith('savepoint'))).toBe(false);
  });
});
