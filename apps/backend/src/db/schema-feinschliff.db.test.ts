/**
 * Nachweise zur Audit-Maßnahme W3-8 – Schema-Feinschliff (`backend-db-07`,
 * `backend-db-09`).
 *
 * Zwei Dinge werden hier gegen ein laufendes PostgreSQL belegt, nicht gegen den
 * Text der Migrationen:
 *
 * - **`instance_settings` bleibt einzeilig.** Bisher versprach das nur der
 *   Kommentar an der Tabelle; technisch stand dahinter allein der
 *   Vorgabewert `1` des Primärschlüssels. Ein Insert mit ausdrücklichem
 *   `id = 2` legte eine zweite Wahrheit an (`backend-db-09`).
 * - **Jede Fremdschlüsselspalte hat einen brauchbaren Index** – oder steht in
 *   {@link OHNE_INDEX_MIT_ABSICHT} mit dem Grund, warum nicht
 *   (`backend-db-07`). Diese Aufstellung ist damit keine Notiz im Bericht,
 *   sondern eine Zusicherung: Eine künftige Fremdschlüsselspalte ohne Index
 *   lässt den Test scheitern, bis jemand entweder den Index nachzieht oder die
 *   Ausnahme begründet.
 *
 * Läuft nur mit `DATABASE_URL` **und** `PALANTIR_TEST_DB=1` (siehe
 * `test-support/db.ts`).
 */

import { expect, it } from 'vitest';
import { type Ausfuehren, describeDatenbank } from '../test-support/db.js';

/** `tabelle.spalte` – die Form, in der Spalten hier verglichen werden. */
type SpaltenSchluessel = string;

/**
 * Fremdschlüsselspalten, die **bewusst** ohne Index bleiben, mit Begründung.
 *
 * Die gemeinsame Linie: Ein Index kommt dort hin, wo die Tabelle mit dem
 * Betrieb des Panels wächst – Nachrichten, Meldungen, Benachrichtigungen,
 * Sicherungen, Kontingent-Anfragen. Er bleibt weg, wo die Zeilenzahl eine
 * Entscheidung des Administrators ist und im ein- bis zweistelligen Bereich
 * bleibt: Dort liest PostgreSQL ohnehin sequenziell, und der Index kostete nur
 * bei jedem Schreibvorgang.
 */
const OHNE_INDEX_MIT_ABSICHT: ReadonlyMap<SpaltenSchluessel, string> = new Map([
  ['instance_settings.updated_by_id', 'Die Tabelle hat genau eine Zeile.'],
  [
    'port_ranges.node_id',
    'Port-Bereiche legt ein Administrator an – eine Handvoll Zeilen; die Vergabe filtert sie zudem in der Anwendung, nicht in SQL.',
  ],
  [
    'notification_rules.recipient_role_id',
    'Regeln legt ein Administrator an; die Duplikatsprüfung trägt der bestehende Unique-Index.',
  ],
  [
    'announcements.published_by_user_id',
    'Ankündigungen entstehen nur durch Administratoren, nicht durch die Nutzung.',
  ],
  [
    'game_servers.cloned_from_server_id',
    'Die Spalte wird nie gefiltert; die Zeilenzahl begrenzt die Kapazität des Homeservers.',
  ],
  [
    'uploaded_fonts.uploaded_by_id',
    'Schriften lädt ein Administrator hoch – eine Handvoll Zeilen; gefiltert wird nach der Kennung, nie nach dem Hochladenden.',
  ],
]);

/**
 * Die Spalten, die diese Maßnahme mit einem Index versehen hat.
 *
 * Steht ausdrücklich hier und nicht nur implizit in der Prüfung oben: Fiele
 * einer dieser Indizes künftig weg, während zugleich eine Ausnahme dafür
 * eingetragen wird, bliebe die allgemeine Prüfung grün – diese hier nicht.
 */
const NEU_INDIZIERT: readonly SpaltenSchluessel[] = [
  'backups.created_by_user_id',
  'backups.schedule_id',
  'conversation_reads.user_id',
  'message_reports.reported_by_id',
  'message_reports.resolved_by_id',
  'messages.deleted_by_id',
  'notification_deliveries.rule_id',
  'notifications.rule_id',
  'quota_requests.decided_by_id',
  'quota_requests.user_id',
  'schedules.server_id',
  'server_pins.server_id',
];

/**
 * Führende Spalte jedes Fremdschlüssels im Schema `public`.
 *
 * Nur die führende Spalte zählt: Ein zusammengesetzter Fremdschlüssel wird beim
 * Löschen der Zieltabelle über sie gesucht.
 */
async function fremdschluesselSpalten(roh: Ausfuehren): Promise<SpaltenSchluessel[]> {
  // `distinct`: Zwei Fremdschlüssel derselben Tabelle dürfen dieselbe führende
  // Spalte haben (heute nicht der Fall). Ohne das stünde sie doppelt in der
  // Fehlliste, und der Vergleich unten scheiterte aus dem falschen Grund.
  const zeilen = await roh(
    `select distinct cl.relname || '.' || att.attname as schluessel
       from pg_constraint c
       join pg_class cl on cl.oid = c.conrelid
       join pg_namespace n on n.oid = cl.relnamespace
       join lateral unnest(c.conkey) with ordinality as k(attnum, pos) on true
       join pg_attribute att on att.attrelid = c.conrelid and att.attnum = k.attnum
      where c.contype = 'f' and n.nspname = 'public' and k.pos = 1`,
  );

  return zeilen.map((zeile) => String(zeile.schluessel));
}

/**
 * Spalten, für die ein Index einen Zugriff der Form `spalte = $1` trägt.
 *
 * Zwei Feinheiten, an denen die naive Zählung vorbeiginge:
 *
 * - Nur die **erste** Schlüsselspalte eines Index trägt einen solchen Zugriff.
 *   `conversation_reads.user_id` steht im Primärschlüssel an zweiter Stelle und
 *   war damit ungedeckt – genau der Fall aus `backend-db-07`.
 * - Ein **partieller** Index trägt ihn nur, wenn seine Bedingung aus
 *   `spalte = $1` folgt. `is not null` folgt daraus (PostgreSQL beweist das über
 *   die Striktheit von `=`), `status = 'pending'` dagegen nicht: Der
 *   Unique-Index auf `quota_requests.user_id` sah aus wie eine Deckung, war
 *   aber keine.
 */
async function gedeckteSpalten(roh: Ausfuehren): Promise<Set<SpaltenSchluessel>> {
  const zeilen = await roh(
    `select cl.relname                          as tabelle,
            att.attname                         as spalte,
            pg_get_expr(i.indpred, i.indrelid)  as bedingung
       from pg_index i
       join pg_class cl on cl.oid = i.indrelid
       join pg_namespace n on n.oid = cl.relnamespace
       join pg_attribute att on att.attrelid = i.indrelid and att.attnum = i.indkey[0]
      where n.nspname = 'public' and i.indisvalid`,
  );

  const gedeckt = new Set<SpaltenSchluessel>();

  for (const zeile of zeilen) {
    const spalte = String(zeile.spalte);
    const bedingung = zeile.bedingung === null ? null : String(zeile.bedingung);

    if (
      bedingung !== null &&
      bedingung.replace(/\s+/g, ' ').toLowerCase() !== `(${spalte} is not null)`
    ) {
      continue;
    }

    gedeckt.add(`${String(zeile.tabelle)}.${spalte}`);
  }

  return gedeckt;
}

describeDatenbank('Schema-Feinschliff (W3-8)', (kontext) => {
  it('nimmt die eine Zeile der Instanz-Einstellungen an', async () => {
    await kontext.roh(
      'insert into instance_settings (id, self_registration_enabled) values (1, true)',
    );

    const zeilen = await kontext.roh('select count(*)::int as anzahl from instance_settings');
    expect(zeilen[0]?.anzahl).toBe(1);
  });

  it('lehnt eine zweite Zeile in den Instanz-Einstellungen ab', async () => {
    await kontext.roh(
      'insert into instance_settings (id, self_registration_enabled) values (1, true)',
    );

    // Der Primärschlüssel allein fing diesen Fall nicht: `id = 2` ist ein
    // anderer Schlüssel und wäre vor der Bedingung angenommen worden.
    await expect(
      kontext.roh(
        'insert into instance_settings (id, self_registration_enabled) values (2, false)',
      ),
    ).rejects.toThrow(/instance_settings_singleton/);

    const zeilen = await kontext.roh('select count(*)::int as anzahl from instance_settings');
    expect(zeilen[0]?.anzahl).toBe(1);
  });

  it('lässt die eine Zeile auch nicht auf eine andere Id umschreiben', async () => {
    await kontext.roh(
      'insert into instance_settings (id, self_registration_enabled) values (1, true)',
    );

    await expect(kontext.roh('update instance_settings set id = 7')).rejects.toThrow(
      /instance_settings_singleton/,
    );
  });

  it('deckt jede Fremdschlüsselspalte mit einem Index – oder mit einer begründeten Ausnahme', async () => {
    const [fremdschluessel, gedeckt] = await Promise.all([
      fremdschluesselSpalten(kontext.roh),
      gedeckteSpalten(kontext.roh),
    ]);

    // Ohne diese Untergrenze liefe die Prüfung auch bei einem leeren Ergebnis
    // durch und belegte nichts.
    expect(fremdschluessel.length).toBeGreaterThan(40);

    const ohneIndex = fremdschluessel.filter((spalte) => !gedeckt.has(spalte)).sort();

    expect(ohneIndex).toEqual([...OHNE_INDEX_MIT_ABSICHT.keys()].sort());
  });

  it('hält die Indizes, die diese Maßnahme nachgezogen hat', async () => {
    const gedeckt = await gedeckteSpalten(kontext.roh);

    expect(NEU_INDIZIERT.filter((spalte) => !gedeckt.has(spalte))).toEqual([]);
  });

  it('begründet jede Ausnahme mit einem Satz', () => {
    for (const [spalte, grund] of OHNE_INDEX_MIT_ABSICHT) {
      expect(grund.length, `Ausnahme ohne Begründung: ${spalte}`).toBeGreaterThan(20);
    }
  });
});
