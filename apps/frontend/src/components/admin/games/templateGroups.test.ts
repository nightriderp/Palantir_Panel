import { type GameTypeDto } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import { gameType } from '../../servers/testFixtures';
import { buildTemplateGroups, templateVariantLabel } from './templateGroups';

/**
 * Vorlagen nach Variantengruppe (Betreiber-Wunsch 20.09.2026).
 *
 * Minecraft belegte fünf von zwanzig Karten, und jede wollte dasselbe Bild
 * einzeln hochgeladen bekommen.
 */

const PAPER: GameTypeDto = gameType({
  id: 'minecraft-paper',
  name: 'Minecraft (Paper)',
  variantGroup: 'Minecraft',
  variantLabel: 'Paper',
});
const VANILLA: GameTypeDto = gameType({
  id: 'minecraft-vanilla',
  name: 'Minecraft (Vanilla)',
  variantGroup: 'Minecraft',
  variantLabel: 'Vanilla',
});
const VALHEIM: GameTypeDto = gameType({ id: 'valheim', name: 'Valheim' });

describe('buildTemplateGroups', () => {
  it('fasst Varianten desselben Spiels zu einer Karte zusammen', () => {
    const karten = buildTemplateGroups([PAPER, VANILLA, VALHEIM]);

    expect(karten.map((karte) => karte.key)).toEqual(['Minecraft', 'valheim']);
    expect(karten[0]?.games.map((spiel) => spiel.id)).toEqual([
      'minecraft-paper',
      'minecraft-vanilla',
    ]);
  });

  it('setzt die Gruppe an die Stelle ihres ersten Mitglieds', () => {
    // Sonst verschöbe sich die Reihenfolge der Registry.
    const karten = buildTemplateGroups([PAPER, VALHEIM, VANILLA]);

    expect(karten.map((karte) => karte.key)).toEqual(['Minecraft', 'valheim']);
  });

  it('lässt ein Spiel ohne Gruppe unter seinem Namen stehen', () => {
    expect(buildTemplateGroups([VALHEIM])).toEqual([
      { key: 'valheim', label: 'Valheim', games: [VALHEIM] },
    ]);
  });

  it('macht aus einer Gruppe mit einem Mitglied eine gewöhnliche Karte', () => {
    // Anders als im Wizard zeigt diese Seite alle Vorlagen, auch abgeschaltete
    // – bliebe es eine Gruppe, stünde unter „Minecraft" ein einziger Schalter
    // ohne erkennbaren Bezug.
    expect(buildTemplateGroups([PAPER])).toEqual([
      { key: 'minecraft-paper', label: 'Minecraft (Paper)', games: [PAPER] },
    ]);
  });

  it('zeigt jede Vorlage genau einmal', () => {
    const alle = [PAPER, VANILLA, VALHEIM];
    const gezeigt = buildTemplateGroups(alle).flatMap((karte) => karte.games);

    expect(gezeigt).toHaveLength(alle.length);
    expect(new Set(gezeigt.map((spiel) => spiel.id)).size).toBe(alle.length);
  });
});

describe('templateVariantLabel', () => {
  it('nimmt den kurzen Namen der Variante', () => {
    expect(templateVariantLabel(PAPER)).toBe('Paper');
  });

  it('fällt ohne ihn auf den vollständigen Anzeigenamen zurück', () => {
    expect(templateVariantLabel(VALHEIM)).toBe('Valheim');
  });
});
