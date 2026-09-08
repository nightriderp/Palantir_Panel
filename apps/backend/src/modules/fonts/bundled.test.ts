/**
 * Katalog und Auslieferungsverzeichnis gegeneinander (Arbeitspaket S-2).
 *
 * Der Katalog in `bundled.ts` und die Dateien in `assets/fonts/` sind zwei
 * Hälften einer Angabe, und beide lassen sich einzeln ändern. Fehlt einer
 * Schrift die Datei, verschwindet sie stillschweigend aus `GET /api/fonts` –
 * der Dienst überspringt sie mit Absicht, damit die Oberfläche nie eine Schrift
 * anbietet, die sie nicht laden kann. Liegt umgekehrt eine Datei ohne
 * Katalogeintrag da, wird sie nie ausgeliefert und niemand merkt es.
 *
 * Beides sind Fehler, die kein anderer Test sieht: Ein halb ergänzter Eintrag
 * lässt jede Zusicherung dieses Moduls unberührt und fällt erst dem Betreiber
 * auf, der die Schrift in der Auswahl sucht. Deshalb wird hier **in beide
 * Richtungen** verglichen, gegen das echte Verzeichnis und nicht gegen eine
 * Attrappe.
 */

import { FONT_FORMAT_CATALOG, FONT_FORMATS, isBundledFontId } from '@palantir/contracts';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAuditService } from '../admin/audit.js';
import { contextOf } from '../admin/context.js';
import { actorWith, createFakeAuditRepository } from '../admin/test-support.js';
import { BUNDLED_FONTS, bundledFontDirectory, findBundledFont } from './bundled.js';
import { detectFontSignature } from './format.js';
import { createFontService } from './service.js';
import { createNodeFontFileStore } from './storage.js';
import {
  createFakeFontFileStore,
  createFakeFontRepository,
  fixedSelection,
} from './test-support.js';

const ADMIN = contextOf(actorWith('user.manage'), { displayName: 'Test-Admin' });

/** Alle bekannten Schriftendungen – alles andere im Ordner ist Beiwerk. */
const ENDUNGEN = FONT_FORMATS.map((format) => FONT_FORMAT_CATALOG[format].extension);

/** Die Schriftdateien im Auslieferungsverzeichnis, ohne Lizenztexte und Ordner. */
async function schriftdateien(): Promise<string[]> {
  const eintraege = await readdir(bundledFontDirectory(), { withFileTypes: true });

  return eintraege
    .filter(
      (eintrag) => eintrag.isFile() && ENDUNGEN.includes(path.extname(eintrag.name).toLowerCase()),
    )
    .map((eintrag) => eintrag.name)
    .sort();
}

describe('Mitgelieferte Schriften: Katalog und Verzeichnis', () => {
  it('hat zu jedem Katalogeintrag eine Datei', async () => {
    const vorhanden = new Set(await schriftdateien());
    const ohneDatei = BUNDLED_FONTS.filter((font) => !vorhanden.has(font.fileName));

    expect(ohneDatei.map((font) => font.fileName)).toEqual([]);
  });

  it('hat zu jeder Datei einen Katalogeintrag', async () => {
    const erwartet = new Set(BUNDLED_FONTS.map((font) => font.fileName));
    const ohneEintrag = (await schriftdateien()).filter((datei) => !erwartet.has(datei));

    expect(ohneEintrag).toEqual([]);
  });

  it('benennt jede Datei nach dem Slug ihrer Kennung', () => {
    for (const font of BUNDLED_FONTS) {
      expect(isBundledFontId(font.id)).toBe(true);
      expect(findBundledFont(font.id)).toBe(font);
      expect(font.fileName).toBe(`${font.slug}${FONT_FORMAT_CATALOG[font.format].extension}`);
    }
  });

  /*
   * Die Auslieferung entscheidet das Format an den Kopfbytes, nicht an der
   * Endung. Eine Datei, deren Inhalt nicht zum Katalogeintrag passt, käme mit
   * dem falschen MIME-Typ und dem falschen `format(...)`-Hinweis heraus – und
   * bliebe im Browser stumm.
   */
  it('liefert Dateien aus, deren Inhalt zum eingetragenen Format passt', async () => {
    const ablage = createNodeFontFileStore(bundledFontDirectory());

    for (const font of BUNDLED_FONTS) {
      const inhalt = await ablage.read(font.fileName);

      expect(inhalt).not.toBeNull();
      expect(detectFontSignature(inhalt!)).toEqual({ kind: 'format', format: font.format });
    }
  });

  it('listet jede mitgelieferte Schrift über GET /api/fonts', async () => {
    const service = createFontService({
      repository: createFakeFontRepository(),
      uploads: createFakeFontFileStore(),
      // Das echte Verzeichnis: Geprüft wird, was eine Instanz wirklich anbietet.
      bundled: createNodeFontFileStore(bundledFontDirectory()),
      selection: fixedSelection(),
      audit: createAuditService(createFakeAuditRepository()),
    });

    const liste = await service.list(ADMIN);

    expect(liste.map((font) => font.id)).toEqual(BUNDLED_FONTS.map((font) => font.id));
    expect(liste.every((font) => font.source === 'bundled')).toBe(true);
    // Die Größe kommt aus der Datei; eine leere Datei wäre eine stumme Schrift.
    expect(liste.every((font) => font.sizeBytes > 0)).toBe(true);
  });
});
