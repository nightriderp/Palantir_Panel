/**
 * Harness für datenbankgestützte Tests (Audit-Maßnahme W2-28).
 *
 * Bis hierher führte **kein** Test des Repositories Drizzle-Code gegen eine
 * Datenbank aus (`test-gaps-05`): Die Regeln sind dicht getestet, die Bindung
 * der Regeln an SQL war es nicht. Die CI fährt für jeden Lauf ohnehin eine
 * Wegwerf-Postgres hoch – dieser Harness macht sie für Tests benutzbar.
 *
 * ## Wann die Tests laufen
 *
 * Nur wenn **beides** gesetzt ist:
 *
 * - `DATABASE_URL` – die Verbindung zum PostgreSQL-Server, und
 * - `PALANTIR_TEST_DB=1` – die ausdrückliche Freigabe.
 *
 * Fehlt eines von beiden, meldet {@link describeDatenbank} die Suite als
 * übersprungen (mit Grund) und öffnet **keine** Verbindung. Auf einem
 * Entwicklungsrechner ohne Postgres bleibt `pnpm test` damit grün.
 *
 * ## Warum zwei Schalter und nicht nur `DATABASE_URL`
 *
 * `config/env.ts` lädt beim Import die zentrale `.env` aus dem Repo-Root über
 * `dotenv` – und `dotenv` schreibt die Werte in `process.env`. Sobald irgendein
 * Test im selben Worker-Prozess Backend-Code importiert, steht `DATABASE_URL`
 * also auch dann in der Umgebung, wenn niemand sie beim Aufruf gesetzt hat. Als
 * alleiniges Signal taugt sie deshalb nicht: Sie zeigt üblicherweise auf die
 * **Entwicklungsdatenbank**. `PALANTIR_TEST_DB` steht in keiner `.env` und wird
 * ausschließlich im Testschritt von `.github/workflows/ci.yml` gesetzt.
 *
 * ## Wo die Testdaten landen
 *
 * Nicht in der Datenbank aus `DATABASE_URL`. Diese Verbindung wird
 * ausschließlich als **Verwaltungsverbindung** benutzt, und darauf laufen genau
 * zwei Anweisungen: `CREATE DATABASE` und `DROP DATABASE` für eine eigene
 * Wegwerf-Datenbank je Testdatei (`palantir_test_<pid>_<zufall>`). Gelesen oder
 * geschrieben wird in der Datenbank aus `DATABASE_URL` nie. Selbst wer die
 * Freigabe versehentlich gegen eine Entwicklungs- oder Produktionsdatenbank
 * setzt, verändert dort keine einzige Zeile. Der Name der Wegwerf-Datenbank
 * wird vor `CREATE`/`DROP` gegen {@link NAMENSMUSTER} geprüft – gelöscht wird
 * nur, was diesem Muster entspricht.
 *
 * ## Aufbau und Aufräumen – und warum so
 *
 * - **Je Testdatei eine eigene Datenbank**, in die die Migrationen aus
 *   `apps/backend/drizzle` eingespielt werden. Geprüft wird damit die Kette,
 *   die auch im Betrieb läuft, nicht ein `db:push`-Abbild des Schemas.
 * - **Kein eigenes Schema je Lauf.** Die Migrationen qualifizieren ihre
 *   Fremdschlüssel ausdrücklich (`REFERENCES "public"."users"`). In einem
 *   anderen Schema zeigten sie damit auf fremde Tabellen oder scheiterten.
 * - **Keine umschließende Transaktion mit Rollback.** Zwei Gründe: Die
 *   Advisory-Lock-Prüfung braucht zwei *gleichzeitige* Transaktionen – ein
 *   gemeinsamer Rahmen würde genau das verhindern, was zu prüfen ist. Und die
 *   Auth- und Chat-Repositories nehmen eine `Database`, keinen
 *   Transaktions-Handle; sie ließen sich in einem solchen Rahmen gar nicht
 *   bauen.
 * - **Je Testfall `TRUNCATE`** über alle Tabellen. Das ist schnell (die
 *   Tabellen sind praktisch leer) und lässt das Schema unberührt.
 */

import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe } from 'vitest';
import type { Database } from '../db/client.js';
import * as schema from '../db/schema.js';

/**
 * Bewusst ein Typ-Import: `db/client.ts` zieht `config/env.ts` und damit
 * `dotenv` nach sich. Ein Wert-Import würde beim Laden dieses Moduls die `.env`
 * des Entwicklungsrechners in `process.env` schreiben – genau das, wovon dieser
 * Harness unabhängig sein soll.
 */

/** Umgebungsvariable, die datenbankgestützte Tests ausdrücklich freigibt. */
export const FREIGABE_VARIABLE = 'PALANTIR_TEST_DB';

/** Präfix jeder Wegwerf-Datenbank – zugleich die Schutzgrenze beim Löschen. */
const NAMENSPRAEFIX = 'palantir_test_';

/** Nur Namen dieser Form werden angelegt und gelöscht. */
const NAMENSMUSTER = /^palantir_test_[a-z0-9_]+$/;

/** Ordner mit der Migrationskette – dieselbe, die `db:migrate` anwendet. */
const MIGRATIONSORDNER = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../drizzle',
);

/** Zeile eines rohen SQL-Ergebnisses. */
export type RohZeile = Record<string, unknown>;

/** Führt eine Anweisung aus und liefert die Zeilen. */
export type Ausfuehren = (sql: string, werte?: readonly unknown[]) => Promise<RohZeile[]>;

/** Ergebnis der Freigabeprüfung. */
export type Freigabe =
  | { readonly aktiv: true; readonly url: string }
  | { readonly aktiv: false; readonly grund: string };

/**
 * Prüft, ob datenbankgestützte Tests laufen dürfen.
 *
 * Exportiert, damit einzelne Tests dieselbe Entscheidung treffen können, ohne
 * die Bedingungen ein zweites Mal zu formulieren.
 */
export function pruefeFreigabe(umgebung: NodeJS.ProcessEnv = process.env): Freigabe {
  const url = umgebung.DATABASE_URL?.trim();

  if (url === undefined || url.length === 0) {
    return {
      aktiv: false,
      grund: 'DATABASE_URL ist nicht gesetzt (läuft nur in der CI gegen den Postgres-Dienst)',
    };
  }

  if (umgebung[FREIGABE_VARIABLE] !== '1') {
    return {
      aktiv: false,
      grund: `${FREIGABE_VARIABLE}=1 ist nicht gesetzt – ohne diese Freigabe wird keine Verbindung geöffnet`,
    };
  }

  return { aktiv: true, url };
}

/** Was eine datenbankgestützte Suite von diesem Harness bekommt. */
export interface DatenbankKontext {
  /** Drizzle-Instanz auf der Wegwerf-Datenbank dieses Laufs. */
  readonly db: Database;
  /** Name der Wegwerf-Datenbank – für Fehlermeldungen und Diagnose. */
  readonly datenbankName: string;
  /**
   * Rohes SQL auf einer beliebigen Verbindung des Pools – für alles, was
   * Drizzle nicht abbildet (Trigger, Check-Bedingungen, `pg_*`-Funktionen).
   */
  roh: Ausfuehren;
  /**
   * Mehrere Anweisungen auf **einer** Verbindung – nötig überall dort, wo eine
   * Sitzungs- oder Transaktionsvariable gilt (`SET LOCAL`).
   */
  sitzung<T>(arbeit: (ausfuehren: Ausfuehren) => Promise<T>): Promise<T>;
  /** Leert alle Tabellen – läuft vor jedem Testfall automatisch. */
  leeren(): Promise<void>;
}

interface Zustand {
  readonly name: string;
  readonly pool: pg.Pool;
  readonly db: Database;
  /** Alle Tabellen im Schema `public`, in Anführungszeichen für `TRUNCATE`. */
  readonly tabellen: readonly string[];
  /** Tabellen mit eigenen Triggern – siehe {@link leeren}. */
  readonly tabellenMitTriggern: readonly string[];
}

/** Öffnet eine kurzlebige Verwaltungsverbindung auf die Datenbank aus der URL. */
async function mitVerwaltung<T>(
  url: string,
  arbeit: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();

  try {
    return await arbeit(client);
  } finally {
    await client.end();
  }
}

function pruefeName(name: string): string {
  if (!NAMENSMUSTER.test(name)) {
    throw new Error(
      `Der Harness legt und löscht ausschließlich Datenbanken mit dem Präfix "${NAMENSPRAEFIX}" – "${name}" passt nicht dazu.`,
    );
  }

  return name;
}

function neuerDatenbankName(): string {
  return pruefeName(`${NAMENSPRAEFIX}${String(process.pid)}_${randomBytes(4).toString('hex')}`);
}

/** URL derselben Verbindung, aber auf die Wegwerf-Datenbank gerichtet. */
function urlFuer(basis: string, name: string): string {
  const ziel = new URL(basis);
  ziel.pathname = `/${name}`;

  return ziel.toString();
}

/**
 * Legt die Wegwerf-Datenbank an.
 *
 * Der Wiederholungsversuch fängt den einen Fall ab, der bei parallel laufenden
 * Testdateien auftritt: PostgreSQL lehnt `CREATE DATABASE` ab, solange eine
 * andere Verbindung die Vorlagendatenbank benutzt.
 */
async function legeDatenbankAn(url: string, name: string): Promise<void> {
  let letzterFehler: unknown;

  for (let versuch = 1; versuch <= 3; versuch += 1) {
    try {
      await mitVerwaltung(url, async (client) => {
        await client.query(`CREATE DATABASE "${pruefeName(name)}"`);
      });

      return;
    } catch (fehler: unknown) {
      letzterFehler = fehler;
      await new Promise((fertig) => setTimeout(fertig, 250 * versuch));
    }
  }

  throw letzterFehler;
}

/**
 * Eine Anweisung auf Pool oder Einzelverbindung – für rohes SQL in Tests.
 *
 * Ohne Werte wird bewusst **ohne** Parameterliste abgesetzt: PostgreSQL nimmt
 * `BEGIN`, `SET LOCAL` und `TRUNCATE` dann über das einfache Protokoll entgegen,
 * für das sie gedacht sind.
 */
async function frage(
  ziel: pg.Pool | pg.PoolClient,
  sql: string,
  werte?: readonly unknown[],
): Promise<RohZeile[]> {
  const ergebnis =
    werte === undefined || werte.length === 0
      ? await ziel.query<RohZeile>(sql)
      : await ziel.query<RohZeile>(sql, [...werte]);

  return ergebnis.rows;
}

async function ladeTabellen(
  pool: pg.Pool,
): Promise<Pick<Zustand, 'tabellen' | 'tabellenMitTriggern'>> {
  const tabellen = await pool.query<{ tabelle: string }>(
    `select tablename as tabelle from pg_tables where schemaname = 'public' order by tablename`,
  );

  const mitTriggern = await pool.query<{ tabelle: string }>(
    `select distinct c.relname as tabelle
       from pg_trigger t
       join pg_class c on c.oid = t.tgrelid
       join pg_namespace n on n.oid = c.relnamespace
      where not t.tgisinternal and n.nspname = 'public'`,
  );

  return {
    tabellen: tabellen.rows.map((zeile) => zeile.tabelle),
    tabellenMitTriggern: mitTriggern.rows.map((zeile) => zeile.tabelle),
  };
}

/**
 * Leert alle Tabellen der Wegwerf-Datenbank.
 *
 * Die eigenen Trigger werden dafür kurz abgeschaltet: `audit_log` trägt einen
 * `BEFORE TRUNCATE`-Trigger, der das Leeren ausdrücklich verbietet (Migration
 * 0005) – und über `TRUNCATE ... CASCADE` gerät die Tabelle auch dann in den
 * Vorgang, wenn nur `users` gemeint war. `ALTER TABLE ... DISABLE TRIGGER USER`
 * betrifft nur die selbst angelegten Trigger, nicht die Fremdschlüssel, braucht
 * lediglich das Eigentum an der Tabelle (kein Superuser) und wird unmittelbar
 * danach wieder zurückgenommen. Dass der Trigger seine Aufgabe erfüllt, prüft
 * `src/db/invariants.db.test.ts` – dort wird nichts abgeschaltet.
 */
async function leereTabellen(zustand: Zustand): Promise<void> {
  if (zustand.tabellen.length === 0) {
    return;
  }

  const liste = zustand.tabellen.map((name) => `"${name}"`).join(', ');
  const client = await zustand.pool.connect();

  try {
    for (const tabelle of zustand.tabellenMitTriggern) {
      await client.query(`ALTER TABLE "${tabelle}" DISABLE TRIGGER USER`);
    }

    await client.query(`TRUNCATE TABLE ${liste} RESTART IDENTITY CASCADE`);
  } finally {
    for (const tabelle of zustand.tabellenMitTriggern) {
      await client.query(`ALTER TABLE "${tabelle}" ENABLE TRIGGER USER`);
    }

    client.release();
  }
}

/**
 * Beschreibt eine Suite, die eine echte Datenbank braucht.
 *
 * Ohne Freigabe wird die Suite mit Grund übersprungen – die einzelnen Tests
 * bleiben dabei sichtbar (`describe.skip` sammelt sie, führt sie aber nicht
 * aus), damit im Bericht steht, *was* nicht gelaufen ist.
 *
 * @param name  Name der Suite, wie er im Testbericht erscheint.
 * @param suite Baut die Tests; `kontext` darf erst **innerhalb** von `it()`
 *              benutzt werden, weil die Datenbank erst in `beforeAll` entsteht.
 */
export function describeDatenbank(name: string, suite: (kontext: DatenbankKontext) => void): void {
  const freigabe = pruefeFreigabe();

  let zustand: Zustand | null = null;

  const fordere = (): Zustand => {
    if (zustand === null) {
      throw new Error(
        'Die Testdatenbank steht erst innerhalb eines Testfalls bereit – `kontext.db` nicht beim Aufbau der Suite benutzen.',
      );
    }

    return zustand;
  };

  const kontext: DatenbankKontext = {
    get db(): Database {
      return fordere().db;
    },
    get datenbankName(): string {
      return fordere().name;
    },
    roh: async (sql, werte) => frage(fordere().pool, sql, werte),
    async sitzung<T>(arbeit: (ausfuehren: Ausfuehren) => Promise<T>): Promise<T> {
      const client = await fordere().pool.connect();

      try {
        return await arbeit(async (sql, werte) => frage(client, sql, werte));
      } finally {
        client.release();
      }
    },
    async leeren(): Promise<void> {
      await leereTabellen(fordere());
    },
  };

  if (!freigabe.aktiv) {
    // Sichtbar im Testlauf: vitest gibt die Ausgabe zusammen mit dem Dateinamen
    // aus, der Grund steht zusätzlich im Suite-Namen.
    console.info(`[DB-Tests] "${name}" übersprungen – ${freigabe.grund}.`);

    describe.skip(`${name} [übersprungen: ${freigabe.grund}]`, () => {
      suite(kontext);
    });

    return;
  }

  const url = freigabe.url;

  // 30 s statt der voreingestellten 5 s je Testfall: Jeder dieser Tests spricht
  // mehrfach über das Netz mit PostgreSQL; auf einem ausgelasteten CI-Läufer ist
  // die Vorgabe zu knapp, und ein Zeitüberschreitungs-Fehlschlag sähe aus wie
  // ein fachlicher.
  describe(name, { timeout: 30_000 }, () => {
    beforeAll(async () => {
      const datenbankName = neuerDatenbankName();
      await legeDatenbankAn(url, datenbankName);

      const pool = new pg.Pool({ connectionString: urlFuer(url, datenbankName) });
      const db = drizzle(pool, { schema });

      await migrate(db, { migrationsFolder: MIGRATIONSORDNER });

      zustand = { name: datenbankName, pool, db, ...(await ladeTabellen(pool)) };

      console.info(`[DB-Tests] "${name}" läuft gegen die Wegwerf-Datenbank ${datenbankName}.`);
    }, 180_000);

    afterAll(async () => {
      if (zustand === null) {
        return;
      }

      const { name: datenbankName, pool } = zustand;
      zustand = null;

      await pool.end();
      await mitVerwaltung(url, async (client) => {
        // `WITH (FORCE)` trennt Verbindungen, die ein fehlgeschlagener Test
        // offen gelassen hat – sonst bliebe die Wegwerf-Datenbank stehen.
        await client.query(`DROP DATABASE IF EXISTS "${pruefeName(datenbankName)}" WITH (FORCE)`);
      });
    }, 60_000);

    beforeEach(async () => {
      await leereTabellen(fordere());
    }, 30_000);

    suite(kontext);
  });
}
