/**
 * Löschregeln der Backup-Tabelle (Audit W2-11, backend-db-02).
 *
 * Ein Backup trägt zwei Dinge, die nicht in der Datenbank liegen: den Bezug auf
 * einen Server und eine Archivdatei auf der Node. Welche Zeile beim Löschen
 * eines Servers oder eines Kontos wie behandelt wird, entscheidet deshalb über
 * echten Speicher – und nicht nur über Datensätze.
 *
 * Wie `users.test.ts` liest dieser Test die **Migrationen** und nicht die
 * Schema-Datei: Nur was in `drizzle/` steht, kommt in der Datenbank an
 * (CLAUDE.md §4). Eine Schema-Datei ohne zugehörige Migration hätte auf der
 * laufenden Instanz keine Wirkung.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../drizzle/', import.meta.url));

/** Alle Migrationen in Anwendungsreihenfolge – die Dateinamen sind nummeriert. */
function migrationSqlInOrder(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => readFileSync(`${MIGRATIONS_DIR}${name}`, 'utf8'));
}

/**
 * Die zuletzt eingespielte Fassung eines Fremdschlüssels.
 *
 * Maßgeblich ist nicht, dass eine Löschregel irgendwo einmal vorkam, sondern
 * welche am Ende der Kette steht: Ein späteres `DROP`/`ADD` überschreibt sie.
 */
function lastForeignKeyStatement(constraint: string): string | null {
  const statements = migrationSqlInOrder()
    .join('\n')
    .split('-->')
    .flatMap((teil) => teil.split(';'))
    .map((teil) => teil.replace(/\s+/g, ' ').trim())
    .filter(
      (teil) => teil.includes(`ADD CONSTRAINT "${constraint}"`) && teil.includes('FOREIGN KEY'),
    );

  return statements.at(-1) ?? null;
}

describe('Löschregeln der Tabelle backups (Lastenheft §3.3, §3.7)', () => {
  it('lässt ein Backup seinen Server überleben (ON DELETE SET NULL)', () => {
    // Ein Backup ist die Sicherung gegen ein verlorenes Spiel – auch dann,
    // wenn der Server längst weg ist.
    expect(lastForeignKeyStatement('backups_server_id_game_servers_id_fk')).toMatch(
      /ON DELETE set null/i,
    );
  });

  it('lässt ein Konto seine Sicherungen nicht überleben (ON DELETE RESTRICT)', () => {
    /*
     * Bis Migration 0026 stand hier `CASCADE`. Die Kaskade entfernte die
     * Zeilen, ohne dass Anwendungscode lief – die Archivdatei auf der Node
     * blieb liegen und tauchte in keiner Übersicht mehr auf (backend-db-02).
     * `RESTRICT` erzwingt die Reihenfolge: erst die Sicherungen über den
     * regulären Weg, dann das Konto.
     */
    expect(lastForeignKeyStatement('backups_owner_id_users_id_fk')).toMatch(/ON DELETE restrict/i);
  });

  it('behält den auslösenden Nutzer als reine Angabe (ON DELETE SET NULL)', () => {
    // `created_by_user_id` ist Herkunftsangabe, kein Besitz: Sie darf
    // verschwinden, ohne das Backup mitzunehmen.
    expect(lastForeignKeyStatement('backups_created_by_user_id_users_id_fk')).toMatch(
      /ON DELETE set null/i,
    );
  });
});
