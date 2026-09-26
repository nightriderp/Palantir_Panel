import { describe, expect, it } from 'vitest';
import {
  createOverviewTileInputSchema,
  overviewTileLinkUrlSchema,
  updateOverviewTileInputSchema,
} from './overview-tile.js';

/**
 * Übersichts-Kacheln ohne Server: Der Link landet als `href` auf einer Kachel,
 * die jedes Konto sieht – deshalb steht die Prüfung des Ziels im Mittelpunkt.
 */
describe('overviewTileLinkUrlSchema', () => {
  it('nimmt http und https an', () => {
    expect(overviewTileLinkUrlSchema.parse('https://discord.gg/abc')).toBe(
      'https://discord.gg/abc',
    );
    expect(overviewTileLinkUrlSchema.parse('http://example.org')).toBe('http://example.org');
  });

  it('lehnt jedes andere Schema ab', () => {
    for (const ziel of ['javascript:alert(1)', 'ftp://x', 'discord.gg/abc', 'data:text/html,x']) {
      expect(overviewTileLinkUrlSchema.safeParse(ziel).success).toBe(false);
    }
  });

  it('macht aus einer leeren Eingabe null', () => {
    expect(overviewTileLinkUrlSchema.parse('')).toBeNull();
    expect(overviewTileLinkUrlSchema.parse('   ')).toBeNull();
  });
});

describe('createOverviewTileInputSchema', () => {
  it('füllt fehlende Felder mit null bzw. 0', () => {
    expect(createOverviewTileInputSchema.parse({ title: 'Surf' })).toEqual({
      title: 'Surf',
      subtitle: null,
      gameTypeId: null,
      gameLabel: null,
      address: null,
      linkUrl: null,
      linkLabel: null,
      sortOrder: 0,
    });
  });

  it('verlangt einen Titel und lehnt spitze Klammern ab', () => {
    expect(createOverviewTileInputSchema.safeParse({ title: '  ' }).success).toBe(false);
    expect(createOverviewTileInputSchema.safeParse({ title: '<b>x</b>' }).success).toBe(false);
  });

  it('lehnt eine Adresse mit Leerzeichen und eine fremde Spiel-Kennung ab', () => {
    expect(
      createOverviewTileInputSchema.safeParse({ title: 'x', address: 'surf.example.org 27015' })
        .success,
    ).toBe(false);
    expect(createOverviewTileInputSchema.safeParse({ title: 'x', gameTypeId: 'CS2' }).success).toBe(
      false,
    );
    expect(
      createOverviewTileInputSchema.parse({ title: 'x', address: 'surf.example.org:27015' })
        .address,
    ).toBe('surf.example.org:27015');
  });

  it('weist unbekannte Felder zurück', () => {
    expect(createOverviewTileInputSchema.safeParse({ title: 'x', foo: 1 }).success).toBe(false);
  });
});

describe('updateOverviewTileInputSchema', () => {
  it('braucht mindestens ein Feld', () => {
    expect(updateOverviewTileInputSchema.safeParse({}).success).toBe(false);
    expect(updateOverviewTileInputSchema.parse({ address: '' })).toEqual({ address: null });
  });
});
