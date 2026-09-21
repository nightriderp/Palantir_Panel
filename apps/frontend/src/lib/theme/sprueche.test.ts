import { describe, expect, it } from 'vitest';
import { STANDARD_THEME_ID, THEMES } from './palette';
import { SPRUCH_SLOTS, SPRUCH_TABELLEN, type SpruchSlot, spruch } from './sprueche';

const { NEUTRAL, ABWEICHUNGEN } = SPRUCH_TABELLEN;

/** Jeder Text, den irgendein Theme zeigen kann – neutral wie abweichend. */
const ALLE_SPRUECHE = [
  ...Object.entries(NEUTRAL).map(([slot, s]) => ['standard', slot as SpruchSlot, s] as const),
  ...Object.entries(ABWEICHUNGEN).flatMap(([id, tabelle]) =>
    Object.entries(tabelle).map(([slot, s]) => [id, slot as SpruchSlot, s] as const),
  ),
];

describe('Slots', () => {
  /**
   * Die Liste ist hier **absichtlich doppelt** aufgeschrieben.
   *
   * Sie ist die Stolperschwelle für den nächsten Slot: Wer einen hinzufügt,
   * muss diesen Test anfassen – und liest dabei, wofür es ihn gibt. Die
   * Zonenregel in `sprueche.ts` sagt, dass gewitzte Texte nur dort stehen, wo
   * ein Missverständnis nichts kostet. Ein Slot für einen Bestätigungsdialog
   * oder eine Fehlermeldung wäre kein neuer Text, sondern das Ende der Regel.
   */
  it('umfasst genau die Stellen, die die Zonenregel aushalten', () => {
    expect([...SPRUCH_SLOTS]).toEqual([
      'anmeldung',
      'serverLeer',
      'keinTreffer',
      'sicherungenLeer',
      'meldungenLeer',
      'aufgabenLeer',
      'nichtGefunden',
    ]);
  });

  it('hat für jede Stelle einen neutralen Text – er ist der Rückfall', () => {
    for (const slot of SPRUCH_SLOTS) {
      expect(NEUTRAL[slot], slot).toBeDefined();
    }
  });

  it('kennt in den Abweichungen nur echte Slots und echte Themes', () => {
    const slots = new Set<string>(SPRUCH_SLOTS);
    const ids = new Set(THEMES.map((thema) => thema.id));

    for (const [id, tabelle] of Object.entries(ABWEICHUNGEN)) {
      expect(ids.has(id), `unbekanntes Theme: ${id}`).toBe(true);
      for (const slot of Object.keys(tabelle)) {
        expect(slots.has(slot), `unbekannter Slot in ${id}: ${slot}`).toBe(true);
      }
    }
  });
});

describe('spruch', () => {
  it('gibt dem Standard immer den neutralen Text', () => {
    for (const slot of SPRUCH_SLOTS) {
      expect(spruch(STANDARD_THEME_ID, slot)).toBe(NEUTRAL[slot]);
    }
  });

  it('gibt einem Theme seinen eigenen Text', () => {
    expect(spruch('schmiedefeuer', 'serverLeer')).not.toBe(NEUTRAL.serverLeer);
    expect(spruch('schmiedefeuer', 'serverLeer').titel).toBe('Der Amboss ist noch kalt');
  });

  /*
   * Ein Theme muss nicht alle Stellen besetzen – wer nur Farben ändern will,
   * ändert nur Farben. Und die Kennung kommt aus einem Cookie, ist also
   * beliebig. Beides darf nie einen leeren Kasten ergeben.
   */
  it('fällt auf den neutralen Text zurück, wo ein Theme nichts sagt', () => {
    expect(spruch('gibtesnicht', 'serverLeer')).toBe(NEUTRAL.serverLeer);
    expect(spruch('', 'anmeldung')).toBe(NEUTRAL.anmeldung);
  });
});

describe('Die Texte selbst', () => {
  it.each(ALLE_SPRUECHE)('%s · %s ist nicht leer', (_id, _slot, s) => {
    expect(s.titel.trim().length).toBeGreaterThan(0);
    expect(s.text.trim().length).toBeGreaterThan(0);
  });

  /*
   * Der Leerzustand ist ein Kasten mit `max-w-md`, die Anmeldung eine schmale
   * Karte. Ein Spruch, der dort über vier Zeilen läuft, ist kein Spruch mehr,
   * sondern ein Absatz – und schiebt auf dem Telefon den Knopf darunter aus
   * dem Bild. Die Grenzen sind großzügig; sie fangen den Aufsatz ab, nicht
   * den Einfall.
   */
  it.each(ALLE_SPRUECHE)('%s · %s bleibt kurz genug für seinen Kasten', (_id, _slot, s) => {
    expect(s.titel.length, `Titel: ${s.titel}`).toBeLessThanOrEqual(40);
    expect(s.text.length, `Text: ${s.text}`).toBeLessThanOrEqual(170);
  });
});

/**
 * **Die Auskunft muss den Spruch überleben.**
 *
 * Ein Leerzustand sagt zweierlei: dass nichts da ist, und wie es weitergeht.
 * Das Zweite ist der eigentliche Zweck – „Der Amboss ist noch kalt" allein
 * lässt jemanden ratlos zurück, der zum ersten Mal hier ist.
 *
 * Geprüft wird deshalb je Stelle der **Begriff**, an dem die Auskunft hängt,
 * nicht der Wortlaut: Wer einen Gameserver anlegen soll, muss das Wort lesen;
 * wer den Filter ändern soll, ebenso. Wie der Satz drumherum klingt, ist dem
 * Theme überlassen.
 */
describe('Die Auskunft überlebt den Spruch', () => {
  const PFLICHTBEGRIFF: Record<SpruchSlot, RegExp> = {
    anmeldung: /Gameserver/,
    serverLeer: /Gameserver/,
    keinTreffer: /Filter/,
    sicherungenLeer: /Sichere den Server|geplanten Lauf/,
    meldungenLeer: /Serverstatus/,
    aufgabenLeer: /Neustart|Konsolenbefehl/,
    nichtGefunden: /Übersicht/,
  };

  it.each(ALLE_SPRUECHE)('%s · %s nennt weiterhin, worum es geht', (_id, slot, s) => {
    expect(s.text, `"${s.text}" trägt die Auskunft nicht mehr`).toMatch(PFLICHTBEGRIFF[slot]);
  });
});

/**
 * Eigene Worte statt fremder Namen.
 *
 * Die Themes spielen auf Stimmungen an – Werkstatt, Zeichentrick, Kanzlei,
 * Raumfahrt –, nicht auf bestimmte Filme. Das ist kein Zufall: Der Code liegt
 * öffentlich, und fremde Marken und Zitate haben darin nichts verloren.
 *
 * ⚠️ Die Liste ist eine **Gedächtnisstütze, keine Rechtsauskunft**. Sie fängt
 * den naheliegenden Fall ab – jemand tippt beim Schreiben eines Spruchs den
 * Namen ein, der ihm gerade im Kopf herumgeht. Vollständig kann sie nicht
 * sein, und sie soll auch nicht so gelesen werden.
 */
describe('Keine fremden Namen in den Texten', () => {
  const FREMDE_NAMEN =
    /\b(jedi|sith|yoda|skywalker|mandalorian|gandalf|frodo|mordor|auenland|hobbit|avengers|iron ?man|saiyan|kamehameha|hogwarts|dumbledore|vulkanier|klingone|tardis|pikachu)\b/i;

  it.each(ALLE_SPRUECHE)('%s · %s kommt ohne aus', (_id, _slot, s) => {
    expect(`${s.titel} ${s.text}`).not.toMatch(FREMDE_NAMEN);
  });

  it('auch die Namen und Beschreibungen der Themes selbst', () => {
    for (const thema of THEMES) {
      expect(`${thema.name} ${thema.beschreibung}`, thema.id).not.toMatch(FREMDE_NAMEN);
    }
  });
});
