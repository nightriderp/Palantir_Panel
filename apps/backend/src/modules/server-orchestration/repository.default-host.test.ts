/**
 * `defaultHost()` wählt deterministisch (Audit W3-6, orchestration-core-10).
 *
 * Die Abfrage lieferte bisher `select … limit 1` ohne Sortierung: Bei mehreren
 * Nodes entschied die Laufzeit-Reihenfolge von PostgreSQL, welche „die" Node
 * ist – dieselbe Abfrage konnte nacheinander verschiedene Antworten geben.
 * Daran hängen die Zuordnung einer Agent-Verbindung mit gemeinsamem
 * `AGENT_TOKEN` und die Node-Auflösung der Backup-Kommandos; trifft es die
 * falsche Node, gehen Befehle an den falschen physischen Homeserver.
 *
 * Geprüft wird ohne Datenbank: Ein Drizzle-Client, der jede Abfrage mitschreibt
 * statt sie auszuführen, zeigt das erzeugte SQL. Damit belegt der Test genau
 * das, was in Produktion die Reihenfolge festlegt – die `ORDER BY`-Klausel –
 * und nicht die Sortierung einer Attrappe.
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { describe, expect, it } from 'vitest';
import * as schema from '../../db/schema.js';
import { createDrizzleServerRepository } from './repository.js';

interface MitschriftZeile {
  readonly sql: string;
}

/**
 * Drizzle über einem Client, der nichts ausführt.
 *
 * `pg` verlangt hier nur eine `query()`-Methode. Drizzle fragt mit
 * `rowMode: 'array'` ab, deshalb ist eine Zeile eine Werteliste in der
 * Reihenfolge der Projektion (`id`, `name`, `wireguardIp`, `status`).
 */
function dbMitMitschrift(rows: readonly unknown[][] = []) {
  const abfragen: MitschriftZeile[] = [];
  const client = {
    async query(text: string | { text: string }) {
      abfragen.push({ sql: typeof text === 'string' ? text : text.text });

      return { rows: [...rows], rowCount: rows.length, command: 'SELECT', oid: 0, fields: [] };
    },
  };

  // `drizzle` erwartet einen `pg`-Client; die Attrappe erfüllt davon genau die
  // eine Methode, die für ein `SELECT` gebraucht wird.
  const db = drizzle(client as never, { schema });

  return { db, abfragen };
}

describe('defaultHost()', () => {
  it('sortiert nach dem Anlegedatum, statt die Reihenfolge dem Server zu überlassen', async () => {
    const { db, abfragen } = dbMitMitschrift();

    await createDrizzleServerRepository(db).defaultHost();

    const [abfrage] = abfragen;

    expect(abfrage).toBeDefined();
    expect(abfrage?.sql.toLowerCase()).toContain('order by');
    expect(abfrage?.sql.toLowerCase()).toContain('created_at');
    expect(abfrage?.sql.toLowerCase()).toContain('limit');
  });

  it('nimmt aus mehreren Nodes stabil dieselbe – die zuerst gelieferte Zeile', async () => {
    const zeilen = [
      ['node-alt', 'Erster Homeserver', '10.10.0.2', 'online'],
      ['node-neu', 'Zweiter Homeserver', '10.10.0.3', 'online'],
    ];
    const { db } = dbMitMitschrift(zeilen);
    const repository = createDrizzleServerRepository(db);

    const erst = await repository.defaultHost();
    const nochmal = await repository.defaultHost();

    expect(erst?.id).toBe('node-alt');
    expect(nochmal?.id).toBe(erst?.id);
  });

  it('liefert null, solange keine Node angelegt ist', async () => {
    const { db } = dbMitMitschrift();

    expect(await createDrizzleServerRepository(db).defaultHost()).toBeNull();
  });
});
