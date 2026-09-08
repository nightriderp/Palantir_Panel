/**
 * Das Schriften-Repository gegen eine echte Datenbank (Arbeitspaket S-2).
 *
 * Die Regeln des Dienstes prüft `service.test.ts` mit Attrappen. Was dort
 * grundsätzlich nicht geprüft werden kann, steht hier: dass die Zusicherungen
 * auch in PostgreSQL gelten. Zwei davon sind für dieses Modul entscheidend –
 * die Eindeutigkeit des Familiennamens **ohne Rücksicht auf
 * Groß-/Kleinschreibung** (zwei gleichnamige Schriften überschrieben sich im
 * erzeugten CSS gegenseitig) und die Bedingung auf den Gewichtsbereich.
 *
 * Läuft nur mit `DATABASE_URL` **und** `PALANTIR_TEST_DB=1` (siehe
 * `test-support/db.ts`); lokal wird die Suite übersprungen.
 */

import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { isUniqueViolation } from '../../db/errors.js';
import { describeDatenbank } from '../../test-support/db.js';
import { createDrizzleFontRepository, type CreateUploadedFontData } from './repository.js';

function schrift(overrides: Partial<CreateUploadedFontData> = {}): CreateUploadedFontData {
  return {
    id: randomUUID(),
    family: 'Atkinson Hyperlegible',
    label: 'Atkinson Hyperlegible',
    format: 'woff2',
    sizeBytes: 4096,
    variable: false,
    monospace: false,
    weightMin: 400,
    weightMax: 400,
    sha256: 'b'.repeat(64),
    uploadedById: null,
    uploadedByDisplayName: 'Testlauf',
    ...overrides,
  };
}

describeDatenbank('Schriften-Repository', (kontext) => {
  it('legt eine Schrift an und findet sie wieder', async () => {
    const repository = createDrizzleFontRepository(kontext.db);
    const angelegt = await repository.create(schrift());

    expect(await repository.findById(angelegt.id)).toEqual(angelegt);
    expect(await repository.list()).toHaveLength(1);
  });

  it('findet über den Familiennamen ohne Rücksicht auf Groß-/Kleinschreibung', async () => {
    const repository = createDrizzleFontRepository(kontext.db);
    await repository.create(schrift({ family: 'Atkinson Hyperlegible' }));

    expect(await repository.findByFamily('ATKINSON HYPERLEGIBLE')).not.toBeNull();
    expect(await repository.findByFamily('Inter')).toBeNull();
  });

  it('lässt denselben Familiennamen kein zweites Mal zu – auch anders geschrieben', async () => {
    const repository = createDrizzleFontRepository(kontext.db);
    await repository.create(schrift({ family: 'Inter' }));

    // Der Dienst prüft vorher; dieser Index ist die Absicherung des Rennens
    // zwischen zwei gleichzeitigen Uploads (siehe `db/errors.ts`).
    let gefangen: unknown = null;

    try {
      await repository.create(schrift({ family: 'inter' }));
    } catch (fehler: unknown) {
      gefangen = fehler;
    }

    expect(isUniqueViolation(gefangen)).toBe(true);
  });

  it('weist einen umgedrehten Gewichtsbereich ab', async () => {
    const repository = createDrizzleFontRepository(kontext.db);

    await expect(
      repository.create(schrift({ variable: true, weightMin: 800, weightMax: 100 })),
    ).rejects.toThrow();
  });

  it('weist ein Gewicht außerhalb der CSS-Grenzen ab', async () => {
    const repository = createDrizzleFontRepository(kontext.db);

    await expect(repository.create(schrift({ weightMin: 400, weightMax: 5000 }))).rejects.toThrow();
  });

  it('entfernt eine Schrift und meldet einen zweiten Versuch als wirkungslos', async () => {
    const repository = createDrizzleFontRepository(kontext.db);
    const angelegt = await repository.create(schrift());

    expect(await repository.remove(angelegt.id)).toBe(true);
    expect(await repository.remove(angelegt.id)).toBe(false);
    expect(await repository.list()).toHaveLength(0);
  });
});
