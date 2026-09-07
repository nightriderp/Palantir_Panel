/**
 * Erkennung der PostgreSQL-Fehlerklassen, die das Backend fachlich beantwortet
 * (Audit W2-9: backend-core-01/03, backend-auth-03, backend-community-05,
 * backend-admin-resources-12, bb-10).
 *
 * `pg` legt den SQLSTATE als `code`-Feld auf den geworfenen Fehler. Ohne
 * Übersetzung fällt ein solcher Fehler bis zum globalen Handler durch und wird
 * dort zu `INTERNAL_ERROR` (500) – obwohl der Fall fachlich benannt ist („Name
 * schon vergeben", „es läuft bereits eine Sicherung") und mit 409 beantwortet
 * gehört.
 *
 * **Drizzle reicht den Fehler nicht unverändert durch**, sondern hüllt ihn in
 * einen eigenen („Failed query: insert into …") und hängt das Original an
 * `cause`. Der SQLSTATE steht dort eine Ebene tiefer. Das fiel erst auf, als die
 * Vertrags-Suite aus W3-12 dieselben Zusicherungen gegen das echte Repository
 * laufen ließ statt nur gegen die Attrappe (test-gaps-07): Gegen die Attrappe
 * war alles grün, im Betrieb hätte **keine** der Zuordnungen aus W2-9/W2-11
 * gegriffen. Deshalb wird die `cause`-Kette abgelaufen.
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
 * Wie viele `cause`-Ebenen abgelaufen werden.
 *
 * Drizzle hüllt genau einmal ein; drei Ebenen lassen Luft für eine weitere
 * Schicht und schließen zugleich einen Ringschluss aus, den ein von Hand
 * gebauter Fehler mitbringen könnte.
 */
const MAX_URSACHEN_TIEFE = 3;

/**
 * Liest den SQLSTATE eines Datenbankfehlers, falls er einen trägt – auch dann,
 * wenn eine Schicht ihn eingehüllt hat.
 *
 * Bewusst defensiv: Durch die Schichten (Drizzle, Pool, Tests mit
 * nachgebildeten Fehlern) kommt hier alles Mögliche an – ein `unknown` ohne
 * `code`-Feld ist der Normalfall und darf nicht werfen.
 */
function sqlStateOf(error: unknown): string | null {
  let aktuell: unknown = error;

  for (let tiefe = 0; tiefe <= MAX_URSACHEN_TIEFE; tiefe += 1) {
    if (typeof aktuell !== 'object' || aktuell === null) {
      return null;
    }

    if ('code' in aktuell) {
      const { code } = aktuell as { code: unknown };

      if (typeof code === 'string') {
        return code;
      }
    }

    if (!('cause' in aktuell)) {
      return null;
    }

    aktuell = (aktuell as { cause: unknown }).cause;
  }

  return null;
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
