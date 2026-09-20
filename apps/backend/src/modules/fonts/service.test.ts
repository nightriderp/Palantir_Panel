/**
 * Regeln der Schriftverwaltung (Arbeitspaket S-2).
 *
 * Ohne Datenbank und ohne Platte: Repository und Ablage sind Attrappen
 * (`test-support.ts`). Geprüft wird das, was schiefgehen darf, ohne dass es
 * jemand merkt – der Löschschutz vor allem: Eine gelöschte, aber gewählte
 * Schrift würde die Instanz stillschweigend anders aussehen lassen.
 */

import { describe, expect, it } from 'vitest';
import { createAuditService } from '../admin/audit.js';
import { contextOf } from '../admin/context.js';
import { actorWith, createFakeAuditRepository, ownerActor } from '../admin/test-support.js';
import { BUNDLED_FONTS } from './bundled.js';
import { isFontError } from './errors.js';
import { createFontService, resolveWeights, type FontService } from './service.js';
import {
  UPLOADED_FONT_ID,
  createFakeFontFileStore,
  createFakeFontRepository,
  fixedSelection,
  fontBytes,
  uploadedFontRecord,
  type FakeFontFileStore,
  type FakeFontRepository,
} from './test-support.js';
import { fontFileName } from './storage.js';

const ADMIN = contextOf(actorWith('user.manage'), {
  userId: '33333333-3333-4333-8333-333333333333',
  displayName: 'Test-Admin',
  ipHint: '10.0.0.x',
});

const NUTZER = contextOf(actorWith(), { displayName: 'Nutzer' });

const ERSTE_MITGELIEFERTE = BUNDLED_FONTS[0]!;

interface Aufbau {
  readonly service: FontService;
  readonly repository: FakeFontRepository;
  readonly uploads: FakeFontFileStore;
  readonly bundled: FakeFontFileStore;
  readonly audit: ReturnType<typeof createFakeAuditRepository>;
}

function aufbauen(options: { gewaehlt?: string[]; hochgeladen?: boolean } = {}): Aufbau {
  const record = uploadedFontRecord();
  const leer = options.hochgeladen === false;
  const repository = createFakeFontRepository(leer ? [] : [record]);
  const uploads = createFakeFontFileStore(
    leer ? {} : { [fontFileName(record.id, record.format)]: fontBytes('woff2') },
  );
  // Nur die erste mitgelieferte Schrift liegt wirklich da – so lässt sich am
  // selben Aufbau prüfen, dass ein Katalogeintrag ohne Datei nicht erscheint.
  const bundled = createFakeFontFileStore({
    [ERSTE_MITGELIEFERTE.fileName]: fontBytes('woff2', 100),
  });
  const audit = createFakeAuditRepository();

  return {
    repository,
    uploads,
    bundled,
    audit,
    service: createFontService({
      repository,
      uploads,
      bundled,
      selection: fixedSelection(...(options.gewaehlt ?? [])),
      audit: createAuditService(audit),
    }),
  };
}

/**
 * Aufbau, bei dem genau die Datei **einer** bestimmten mitgelieferten Schrift
 * im Auslieferungsverzeichnis liegt.
 *
 * Für Merkmale, die an einem einzelnen Katalogeintrag hängen: Die Liste
 * enthält dann genau diese Schrift, und die Erwartung braucht keinen Index in
 * eine Reihenfolge, die sich mit dem nächsten Eintrag verschieben würde.
 */
function aufbauenMit(font: (typeof BUNDLED_FONTS)[number]): Aufbau {
  const repository = createFakeFontRepository();
  const uploads = createFakeFontFileStore();
  const bundled = createFakeFontFileStore({ [font.fileName]: fontBytes('woff2', 100) });
  const audit = createFakeAuditRepository();

  return {
    repository,
    uploads,
    bundled,
    audit,
    service: createFontService({
      repository,
      uploads,
      bundled,
      selection: fixedSelection(),
      audit: createAuditService(audit),
    }),
  };
}

/** Fehlercode eines erwarteten Fehlschlags – oder `null`. */
async function fehlercode(arbeit: () => Promise<unknown>): Promise<string | null> {
  try {
    await arbeit();

    return null;
  } catch (fehler: unknown) {
    return isFontError(fehler) ? fehler.code : null;
  }
}

describe('resolveWeights', () => {
  it('nimmt ohne Angabe den Vertragsfall „statisch, 400"', () => {
    expect(resolveWeights({ label: 'X', family: 'X' })).toEqual({
      variable: false,
      weightRange: { min: 400, max: 400 },
    });
  });

  it('übernimmt den Bereich aus dem Formular', () => {
    expect(
      resolveWeights({
        label: 'X',
        family: 'X',
        variable: true,
        weightRange: { min: 100, max: 800 },
      }),
    ).toEqual({ variable: true, weightRange: { min: 100, max: 800 } });
  });

  it('nimmt „variabel" ohne echten Bereich nicht ernst', () => {
    expect(
      resolveWeights({
        label: 'X',
        family: 'X',
        variable: true,
        weightRange: { min: 400, max: 400 },
      }),
    ).toEqual({ variable: false, weightRange: { min: 400, max: 400 } });
  });
});

describe('FontService.list', () => {
  it('führt mitgelieferte und hochgeladene Schriften in einer Liste', async () => {
    const { service } = aufbauen();

    const liste = await service.list(ADMIN);

    expect(liste.map((font) => font.id)).toEqual([ERSTE_MITGELIEFERTE.id, UPLOADED_FONT_ID]);
    expect(liste[0]?.source).toBe('bundled');
    expect(liste[1]?.source).toBe('uploaded');
  });

  it('lässt einen Katalogeintrag ohne Datei weg', async () => {
    const { service } = aufbauen();

    const liste = await service.list(ADMIN);

    // Der Katalog kennt mehr Schriften, als Dateien vorhanden sind.
    expect(BUNDLED_FONTS.length).toBeGreaterThan(1);
    expect(liste.filter((font) => font.source === 'bundled')).toHaveLength(1);
  });

  it('nennt die Größe der mitgelieferten Datei aus dem Auslieferungsverzeichnis', async () => {
    const { service, bundled } = aufbauen();

    const [erste] = await service.list(ADMIN);

    expect(erste?.sizeBytes).toBe(bundled.files.get(ERSTE_MITGELIEFERTE.fileName)?.length);
  });

  it('lässt eine mitgelieferte Schrift ausblenden, wer Schriften verwalten darf', async () => {
    /*
     * Betreiberwunsch 20.09.2026: mitgelieferte und hochgeladene Schriften
     * werden beim Löschen gleich behandelt. Für die Oberfläche ist es
     * derselbe Knopf, deshalb dasselbe Kennzeichen.
     */
    const { service } = aufbauen();

    const liste = await service.list(contextOf(ownerActor()));

    expect(liste[0]?.permissions.canDelete).toBe(true);
  });

  /**
   * Der Kern des Betreiberwunsches vom 20.09.2026: „wenn gelöscht dann weg
   * ohne Spuren".
   *
   * Vorher blieb eine mitgelieferte Schrift nach dem Löschen als
   * ausgeblendeter Eintrag in der Liste stehen und ließ sich zurückholen –
   * eine hochgeladene verschwand. Jetzt verschwinden beide.
   */
  it('nimmt eine gelöschte mitgelieferte Schrift aus Liste und Stylesheet', async () => {
    const { service } = aufbauen();

    await service.remove(ADMIN, ERSTE_MITGELIEFERTE.id);

    const liste = await service.list(ADMIN);

    expect(liste.find((schrift) => schrift.id === ERSTE_MITGELIEFERTE.id)).toBeUndefined();
    expect((await service.stylesheet()).css).not.toContain(ERSTE_MITGELIEFERTE.family);
  });

  it('bringt eine gelöschte Schrift nicht zurück', async () => {
    // Es gibt keinen Weg zurück mehr – `restore` ist mit der Sonderbehandlung
    // entfallen. Der Test hält fest, dass auch ein zweiter Lauf nichts
    // wiederherstellt, sondern schlicht nichts mehr findet.
    const { service } = aufbauen();

    await service.remove(ADMIN, ERSTE_MITGELIEFERTE.id);

    expect(await fehlercode(() => service.remove(ADMIN, ERSTE_MITGELIEFERTE.id))).toBe(
      'FONT_NOT_FOUND',
    );
    expect((await service.stylesheet()).css).not.toContain(ERSTE_MITGELIEFERTE.family);
  });

  /**
   * Die letzte verbleibende Schrift bleibt (Betreiberwunsch 20.09.2026).
   *
   * Der Aufbau bietet genau zwei Schriften an – eine mitgelieferte und eine
   * hochgeladene. Nach der ersten Löschung ist nur noch eine übrig, und die
   * ist geschützt. Ohne die Schranke ließe sich die Verwaltung leerräumen:
   * keine `@font-face`-Regel mehr, die Oberfläche auf dem Fallback-Stack des
   * Browsers, und nichts mehr da, aus dem man sich erholen könnte.
   */
  it('lässt die letzte verbleibende Schrift nicht löschen', async () => {
    const { service } = aufbauen();

    await service.remove(ADMIN, ERSTE_MITGELIEFERTE.id);

    expect(await fehlercode(() => service.remove(ADMIN, UPLOADED_FONT_ID))).toBe(
      'FONT_LAST_REMAINING',
    );

    // Und sie steht auch wirklich noch im Angebot.
    const liste = await service.list(ADMIN);

    expect(liste.map((font) => font.id)).toEqual([UPLOADED_FONT_ID]);
  });

  it('schützt die letzte Schrift unabhängig davon, woher sie kommt', async () => {
    // ⚠️ Die Schranke hängt am Bestand, nicht an der Herkunft: Bleibt die
    // mitgelieferte übrig statt der hochgeladenen, gilt sie genauso.
    const { service } = aufbauen();

    await service.remove(ADMIN, UPLOADED_FONT_ID);

    expect(await fehlercode(() => service.remove(ADMIN, ERSTE_MITGELIEFERTE.id))).toBe(
      'FONT_LAST_REMAINING',
    );
  });

  it('meldet bei einer unbekannten Kennung weiter „nicht vorhanden“', async () => {
    /*
     * ⚠️ Die Schranke wird **nach** der Existenzprüfung gezogen. Andersherum
     * bekäme eine unbekannte Kennung die Meldung „das ist die letzte
     * Schrift“ – eine Antwort, die mit der Frage nichts zu tun hat. (Genau
     * so war es beim ersten Bauen, bis dieser Test es zeigte.)
     */
    const { service } = aufbauen();

    await service.remove(ADMIN, ERSTE_MITGELIEFERTE.id);

    expect(await fehlercode(() => service.remove(ADMIN, 'bundled-gibt-es-nicht'))).toBe(
      'FONT_NOT_FOUND',
    );
  });

  it('löscht keine Schrift, die gerade eine Rolle besetzt', async () => {
    // Sonst stünde die Oberfläche auf einer Schrift, die es im Stylesheet
    // nicht mehr gibt.
    const { service } = aufbauen({ gewaehlt: [ERSTE_MITGELIEFERTE.id] });

    expect(await fehlercode(() => service.remove(ADMIN, ERSTE_MITGELIEFERTE.id))).toBe(
      'FONT_IN_USE',
    );
  });

  it('sperrt den Löschknopf einer gewählten Schrift', async () => {
    const { service } = aufbauen({ gewaehlt: [UPLOADED_FONT_ID] });

    const liste = await service.list(ADMIN);

    expect(liste[1]?.permissions.canDelete).toBe(false);
  });

  it('gibt den Löschknopf frei, sobald die Schrift nicht mehr gewählt ist', async () => {
    const { service } = aufbauen();

    const liste = await service.list(ADMIN);

    expect(liste[1]?.permissions.canDelete).toBe(true);
  });

  it('zeigt einem Konto ohne user.manage keinen Löschknopf', async () => {
    const { service } = aufbauen();

    const liste = await service.list(NUTZER);

    expect(liste.every((font) => !font.permissions.canDelete)).toBe(true);
  });

  /*
   * Der Wert kommt aus dem Katalog, nicht aus der Datei. Ohne ihn könnte die
   * Auswahl für `monospaceFontId` nicht vorsortieren – und eine
   * Proportionalschrift in der Konsole verrutscht spaltenweise.
   */
  it('meldet die dicktengleiche mitgelieferte Schrift als solche', async () => {
    const konsole = BUNDLED_FONTS.find((font) => font.slug === 'jetbrains-mono');

    expect(konsole).toBeDefined();

    // Genau eine der mitgelieferten Schriften ist dicktengleich; wären es
    // versehentlich mehr, fiele das der Auswahl erst am verrutschten Log auf.
    expect(BUNDLED_FONTS.filter((font) => font.monospace)).toEqual([konsole]);

    const { service } = aufbauenMit(konsole!);
    const [gelistet] = await service.list(ADMIN);

    expect(gelistet?.id).toBe(konsole!.id);
    expect(gelistet?.monospace).toBe(true);
  });

  it('meldet eine mitgelieferte Proportionalschrift als nicht dicktengleich', async () => {
    const { service } = aufbauen();
    const [erste] = await service.list(ADMIN);

    expect(ERSTE_MITGELIEFERTE.monospace).toBe(false);
    expect(erste?.monospace).toBe(false);
  });
});

describe('FontService.file', () => {
  it('liefert eine mitgelieferte Datei mit dem MIME-Typ des Katalogs', async () => {
    const { service } = aufbauen();

    const datei = await service.file(ERSTE_MITGELIEFERTE.id);

    expect(datei.mimeType).toBe('font/woff2');
    expect(datei.fileName).toBe(ERSTE_MITGELIEFERTE.fileName);
    // Mitgelieferte Kennungen sind versionslos und überleben einen Austausch
    // der Datei – `immutable` wäre dort eine Zusage, die nicht gilt.
    expect(datei.immutable).toBe(false);
  });

  it('liefert eine hochgeladene Datei als unveränderlich', async () => {
    const { service } = aufbauen();

    const datei = await service.file(UPLOADED_FONT_ID);

    expect(datei.immutable).toBe(true);
    expect(datei.fileName).toBe(`${UPLOADED_FONT_ID}.woff2`);
  });

  it('meldet FONT_NOT_FOUND für eine mitgelieferte Kennung ohne Datei', async () => {
    const { service } = aufbauen();
    const ohneDatei = BUNDLED_FONTS[1]!;

    expect(await fehlercode(() => service.file(ohneDatei.id))).toBe('FONT_NOT_FOUND');
  });

  it('meldet FONT_NOT_FOUND, wenn der Datensatz da ist, die Datei aber fehlt', async () => {
    const { service, uploads } = aufbauen();
    uploads.files.clear();

    expect(await fehlercode(() => service.file(UPLOADED_FONT_ID))).toBe('FONT_NOT_FOUND');
  });
});

describe('FontService.upload', () => {
  it('legt Datei und Datensatz an und schreibt ins Audit-Log', async () => {
    const { service, repository, uploads, audit } = aufbauen({ hochgeladen: false });

    const dto = await service.upload(
      ADMIN,
      { label: 'Inter (variabel)', family: 'Inter' },
      { fileName: 'inter.woff2', content: fontBytes('woff2') },
    );

    expect(dto.source).toBe('uploaded');
    expect(dto.family).toBe('Inter');
    expect(dto.uploadedByDisplayName).toBe('Test-Admin');
    expect(repository.rows).toHaveLength(1);
    expect(uploads.files.has(`${dto.id}.woff2`)).toBe(true);
    expect(audit.rows.map((eintrag) => eintrag.action)).toEqual(['font.uploaded']);
    expect(audit.rows[0]?.targetType).toBe('font');
  });

  it('verlangt user.manage', async () => {
    const { service } = aufbauen({ hochgeladen: false });

    expect(
      await fehlercode(() =>
        service.upload(
          NUTZER,
          { label: 'Inter', family: 'Inter' },
          { fileName: 'inter.woff2', content: fontBytes('woff2') },
        ),
      ),
    ).toBe('PERMISSION_DENIED');
  });

  /*
   * `FONT_FAMILY_TAKEN` (409) und nicht `VALIDATION_FAILED` (400): Ein
   * belegter Name ist kein Eingabefehler, sondern ein Zustand, der dem Anlegen
   * entgegensteht – wie ein vergebener Benutzername.
   */
  it('lehnt einen Familiennamen ab, den es schon gibt – auch anders geschrieben', async () => {
    const { service } = aufbauen();

    expect(
      await fehlercode(() =>
        service.upload(
          ADMIN,
          { label: 'Zweite', family: 'atkinson hyperlegible' },
          { fileName: 'x.woff2', content: fontBytes('woff2') },
        ),
      ),
    ).toBe('FONT_FAMILY_TAKEN');
  });

  it('lehnt den Familiennamen einer mitgelieferten Schrift ab', async () => {
    const { service } = aufbauen({ hochgeladen: false });

    expect(
      await fehlercode(() =>
        service.upload(
          ADMIN,
          { label: 'Eigene', family: ERSTE_MITGELIEFERTE.family },
          { fileName: 'x.woff2', content: fontBytes('woff2') },
        ),
      ),
    ).toBe('FONT_FAMILY_TAKEN');
  });

  /*
   * Das Rennen zwischen Vorprüfung und Insert (Audit W2-9, `db/errors.ts`):
   * Zwei gleichzeitige Uploads desselben Namens kommen beide an `findByFamily`
   * vorbei, den zweiten fängt erst `uploaded_fonts_family_lower_idx`. Ohne die
   * Übersetzung käme dieser fachlich benannte Konflikt als 500 zurück.
   */
  it('beantwortet auch die Unique-Verletzung des Index mit FONT_FAMILY_TAKEN', async () => {
    const { service, repository, uploads } = aufbauen({ hochgeladen: false });
    repository.create = async () => {
      throw Object.assign(new Error('Failed query: insert into "uploaded_fonts"'), {
        cause: Object.assign(new Error('duplicate key value violates unique constraint'), {
          code: '23505',
        }),
      });
    };

    expect(
      await fehlercode(() =>
        service.upload(
          ADMIN,
          { label: 'Inter', family: 'Inter' },
          { fileName: 'inter.woff2', content: fontBytes('woff2') },
        ),
      ),
    ).toBe('FONT_FAMILY_TAKEN');

    // Und die Datei liegt auch in diesem Zweig nicht verwaist im Ablageort.
    expect(uploads.files.size).toBe(0);
  });

  it('lässt keine Datei zurück, wenn der Datensatz nicht angelegt werden kann', async () => {
    const { service, repository, uploads } = aufbauen({ hochgeladen: false });
    repository.create = async () => {
      throw new Error('Datenbank weg');
    };

    await expect(
      service.upload(
        ADMIN,
        { label: 'Inter', family: 'Inter' },
        { fileName: 'inter.woff2', content: fontBytes('woff2') },
      ),
    ).rejects.toThrow('Datenbank weg');

    expect(uploads.files.size).toBe(0);
  });
});

describe('FontService.remove', () => {
  it('meldet eine unbekannte, aber formal mitgelieferte Kennung als nicht vorhanden', async () => {
    const { service } = aufbauen();

    expect(await fehlercode(() => service.remove(ADMIN, 'bundled-gibt-es-nicht'))).toBe(
      'FONT_NOT_FOUND',
    );
  });

  it('schützt eine Schrift, die in den Instanz-Einstellungen gewählt ist', async () => {
    const { service, repository } = aufbauen({ gewaehlt: [UPLOADED_FONT_ID] });

    expect(await fehlercode(() => service.remove(ADMIN, UPLOADED_FONT_ID))).toBe('FONT_IN_USE');
    expect(repository.rows).toHaveLength(1);
  });

  it('entfernt Datei und Datensatz und schreibt ins Audit-Log', async () => {
    const { service, repository, uploads, audit } = aufbauen();

    await service.remove(ADMIN, UPLOADED_FONT_ID);

    expect(repository.rows).toHaveLength(0);
    expect(uploads.files.size).toBe(0);
    expect(audit.rows.map((eintrag) => eintrag.action)).toEqual(['font.deleted']);
  });

  it('kommt auch dann durch, wenn die Datei schon fort ist', async () => {
    const { service, repository, uploads } = aufbauen();
    uploads.files.clear();

    await expect(service.remove(ADMIN, UPLOADED_FONT_ID)).resolves.toBeUndefined();
    expect(repository.rows).toHaveLength(0);
  });

  it('meldet eine unbekannte UUID als nicht vorhanden', async () => {
    const { service } = aufbauen({ hochgeladen: false });

    expect(await fehlercode(() => service.remove(ADMIN, UPLOADED_FONT_ID))).toBe('FONT_NOT_FOUND');
  });

  it('verlangt user.manage', async () => {
    const { service } = aufbauen();

    expect(await fehlercode(() => service.remove(NUTZER, UPLOADED_FONT_ID))).toBe(
      'PERMISSION_DENIED',
    );
  });
});

describe('FontService.exists', () => {
  it('kennt genau das, was auch in der Liste steht', async () => {
    const { service } = aufbauen();

    expect(await service.exists(ERSTE_MITGELIEFERTE.id)).toBe(true);
    expect(await service.exists(UPLOADED_FONT_ID)).toBe(true);
    // Katalogeintrag ohne Datei: nicht wählbar, weil auch nicht auslieferbar.
    expect(await service.exists(BUNDLED_FONTS[1]!.id)).toBe(false);
    expect(await service.exists('bundled-gibt-es-nicht')).toBe(false);
    expect(await service.exists('99999999-9999-4999-8999-999999999999')).toBe(false);
  });
});
