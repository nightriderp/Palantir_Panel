/**
 * „Genau ein Konto trägt den Owner-Status" (Lastenheft §2) darf nicht allein
 * von Anwendungslogik abhängen. Abgesichert ist die Zusicherung über den
 * partiellen Unique-Index `users_single_owner_idx`.
 *
 * Dieser Test liest die **Migration** statt der Schema-Datei: Nur was in
 * `drizzle/` steht, kommt tatsächlich in der Datenbank an. Eine Schema-Datei,
 * zu der die Migration fehlt, hätte auf der laufenden Instanz keine Wirkung
 * (CLAUDE.md §4: Schema-Änderungen ausschließlich über Migrationen).
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../drizzle/', import.meta.url));

function allMigrationSql(): string {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => readFileSync(`${MIGRATIONS_DIR}${name}`, 'utf8'))
    .join('\n');
}

describe('Owner-Eindeutigkeit in der Datenbank (Lastenheft §2, Pflichtenheft §6)', () => {
  it('legt users_single_owner_idx als partiellen Unique-Index an', () => {
    const sql = allMigrationSql();

    expect(sql).toMatch(/CREATE UNIQUE INDEX "users_single_owner_idx"/);
    // Partiell: Der Index greift nur auf Zeilen mit `is_owner` – sonst ließe
    // sich nur ein einziges Konto mit `is_owner = false` anlegen.
    expect(sql).toMatch(/"users_single_owner_idx".*WHERE "users"\."is_owner"/s);
  });

  it('nimmt den Index nirgends wieder zurück', () => {
    // Ein späteres DROP würde die Zusicherung still aufheben.
    expect(allMigrationSql()).not.toMatch(/DROP INDEX[^;]*users_single_owner_idx/i);
  });
});
