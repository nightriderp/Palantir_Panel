/**
 * Erkennung der PostgreSQL-Fehlerklassen, die das Backend fachlich beantwortet
 * (Audit W2-9: backend-core-01/03, backend-auth-03, backend-community-05,
 * backend-admin-resources-12, bb-10).
 *
 * `pg` legt den SQLSTATE als `code`-Feld auf den geworfenen Fehler und reicht
 * ihn durch Drizzle unverändert nach oben. Ohne Übersetzung fällt ein solcher
 * Fehler bis zum globalen Handler durch und wird dort zu `INTERNAL_ERROR` (500)
 * – obwohl der Fall fachlich benannt ist („Name schon vergeben", „es läuft
 * bereits eine Sicherung") und mit 409 beantwortet gehört.
 *
 * Warum überhaupt: Alle betroffenen Stellen prüfen erst (`findOpenByUser`,
 * `usernameExists`, `findActiveByServer`, ...) und schreiben dann. Zwischen
 * beiden Schritten liegt keine Transaktion, also gewinnt bei zwei gleichzeitigen
 * Aufrufen der Datenbank-Index – und genau dessen Fehler wird hier eingefangen.
 * Die Prüfung davor bleibt trotzdem stehen: Sie ist der übliche Weg, dieser
 * Fänger die Absicherung des Rennens.
 *
 * Bewusst hier und nicht je Modul: Vor diesem Helfer stand dieselbe Prüfung
 * dreimal wörtlich im Code (`admin/ports.ts`, `panel-backups/index.ts`), und an
 * einem halben Dutzend weiterer Stellen fehlte sie.
 */

/** SQLSTATE einer Unique-Verletzung (`unique_violation`). */
const UNIQUE_VIOLATION = '23505';

/** SQLSTATE einer Fremdschlüssel-Verletzung (`foreign_key_violation`). */
const FOREIGN_KEY_VIOLATION = '23503';

/**
 * Liest den SQLSTATE eines Datenbankfehlers, falls er einen trägt.
 *
 * Bewusst defensiv: Durch die Schichten (Drizzle, Pool, Tests mit
 * nachgebildeten Fehlern) kommt hier alles Mögliche an – ein `unknown` ohne
 * `code`-Feld ist der Normalfall und darf nicht werfen.
 */
function sqlStateOf(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return null;
  }

  const { code } = error as { code: unknown };

  return typeof code === 'string' ? code : null;
}

/**
 * Unique-Verletzung (`SQLSTATE 23505`)?
 *
 * Absichtlich ohne Angabe des verletzten Index: Jede Aufrufstelle steht
 * unmittelbar an *einem* Insert, dessen möglicher Konflikt bekannt ist. Ein
 * Vergleich des Index-Namens würde die Fachlogik an einen Bezeichner aus der
 * Migration binden, ohne einen Fall zu unterscheiden, der hier auftreten kann.
 */
export function isUniqueViolation(error: unknown): boolean {
  return sqlStateOf(error) === UNIQUE_VIOLATION;
}

/**
 * Fremdschlüssel-Verletzung (`SQLSTATE 23503`)?
 *
 * Tritt im Backend in zwei Ausprägungen auf: `ON DELETE RESTRICT` blockiert das
 * Löschen einer noch referenzierten Zeile (Konto mit Servern), und ein Insert
 * verweist auf eine Zeile, die es nicht (mehr) gibt.
 */
export function isForeignKeyViolation(error: unknown): boolean {
  return sqlStateOf(error) === FOREIGN_KEY_VIOLATION;
}
