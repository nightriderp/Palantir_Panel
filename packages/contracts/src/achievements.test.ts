import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENT_CATALOG,
  ACHIEVEMENT_CATEGORIES,
  ACHIEVEMENT_CATEGORY_LABELS,
  ACHIEVEMENT_IDS,
  ACHIEVEMENT_LEVELS,
  ACHIEVEMENTS,
  TITLE_ACHIEVEMENTS,
  isAchievementId,
  levelForUnlocked,
  nextLevelAfter,
  titleForAchievement,
} from './achievements.js';

describe('Erfolgs-Katalog', () => {
  it('führt jede Kennung mit passender, vollständiger Definition', () => {
    for (const id of ACHIEVEMENT_IDS) {
      const definition = ACHIEVEMENT_CATALOG[id];
      expect(definition.id).toBe(id);
      expect(definition.name.length).toBeGreaterThan(0);
      expect(definition.description.length).toBeGreaterThan(0);
      expect(definition.hint.length).toBeGreaterThan(0);
      expect(ACHIEVEMENT_CATEGORIES).toContain(definition.category);
    }
  });

  it('liefert die Abzeichen in Reihenfolge der Kennungen', () => {
    expect(ACHIEVEMENTS.map((entry) => entry.id)).toEqual([...ACHIEVEMENT_IDS]);
  });

  it('kennt keine doppelte Kennung', () => {
    expect(new Set(ACHIEVEMENT_IDS).size).toBe(ACHIEVEMENT_IDS.length);
  });

  it('beschriftet jede Rubrik', () => {
    for (const category of ACHIEVEMENT_CATEGORIES) {
      expect(ACHIEVEMENT_CATEGORY_LABELS[category].length).toBeGreaterThan(0);
    }
  });

  it('erkennt gültige und ungültige Kennungen', () => {
    expect(isAchievementId('nachtschicht')).toBe(true);
    expect(isAchievementId('gibtsNicht')).toBe(false);
    expect(isAchievementId('')).toBe(false);
  });

  it('vergibt keinen Titel doppelt – zwei Abzeichen mit demselben Titel wären ununterscheidbar', () => {
    const titel = TITLE_ACHIEVEMENTS.map((entry) => entry.title);
    expect(new Set(titel).size).toBe(titel.length);
  });

  it('führt unter TITLE_ACHIEVEMENTS genau die Abzeichen mit Titel', () => {
    expect(TITLE_ACHIEVEMENTS.map((entry) => entry.id)).toEqual(
      ACHIEVEMENTS.filter((entry) => entry.title !== null).map((entry) => entry.id),
    );
  });

  it('löst den Titel einer Kennung auf und bleibt bei Unbekanntem still', () => {
    expect(titleForAchievement('nachtschicht')).toBe('Nachtschicht');
    expect(titleForAchievement('grundsteinleger')).toBeNull();
    expect(titleForAchievement('gibtsNicht')).toBeNull();
  });

  it('hält geheime Abzeichen auf die aus, die eine Überraschung sind', () => {
    // Ein geheimes Abzeichen, das man gezielt ansteuern kann, ist keines mehr –
    // deshalb sind es bewusst wenige.
    const geheim = ACHIEVEMENTS.filter((entry) => entry.secret === true);
    expect(geheim.length).toBeGreaterThan(0);
    expect(geheim.length).toBeLessThan(ACHIEVEMENTS.length / 2);
  });
});

describe('Stufenleiter', () => {
  it('beginnt bei null Abzeichen und steigt streng monoton', () => {
    expect(ACHIEVEMENT_LEVELS[0]?.required).toBe(0);

    for (let i = 1; i < ACHIEVEMENT_LEVELS.length; i += 1) {
      const vorher = ACHIEVEMENT_LEVELS[i - 1] as { level: number; required: number };
      const jetzt = ACHIEVEMENT_LEVELS[i] as { level: number; required: number };
      expect(jetzt.required).toBeGreaterThan(vorher.required);
      expect(jetzt.level).toBe(vorher.level + 1);
    }
  });

  it('ist mit dem Katalog erreichbar – die höchste Stufe verlangt nicht mehr, als es gibt', () => {
    const hoechste = ACHIEVEMENT_LEVELS[ACHIEVEMENT_LEVELS.length - 1];
    expect(hoechste?.required).toBeLessThanOrEqual(ACHIEVEMENT_IDS.length);
  });

  it('ordnet einer Zahl freigeschalteter Abzeichen ihre Stufe zu', () => {
    expect(levelForUnlocked(0).label).toBe('Neuling');
    expect(levelForUnlocked(1).label).toBe('Neuling');
    expect(levelForUnlocked(2).label).toBe('Eingelebt');
    expect(levelForUnlocked(ACHIEVEMENT_IDS.length).level).toBe(
      ACHIEVEMENT_LEVELS[ACHIEVEMENT_LEVELS.length - 1]?.level,
    );
  });

  it('bleibt auf der höchsten Stufe, auch wenn mehr gezählt würde als es gibt', () => {
    // Kann nicht vorkommen, solange nur Katalog-Kennungen gespeichert werden –
    // die Funktion soll darüber trotzdem nicht stolpern.
    expect(levelForUnlocked(9_999).label).toBe('Vollständig');
  });

  it('nennt die nächste Stufe und auf der höchsten keine mehr', () => {
    expect(nextLevelAfter(0)?.label).toBe('Eingelebt');
    expect(nextLevelAfter(ACHIEVEMENT_IDS.length)).toBeNull();
  });
});
