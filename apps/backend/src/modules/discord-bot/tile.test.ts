import { describe, expect, it } from 'vitest';
import { renderTile, type TileSnapshot, tileHash } from './tile.js';

const BASIS: TileSnapshot = {
  name: 'Survival',
  gameTypeName: 'Minecraft (Paper)',
  status: 'running',
  address: 'survival.example.de',
  players: { online: 3, max: 20 },
  runningSince: new Date('2026-09-23T10:00:00.000Z'),
  panelUrl: 'https://panel.example/server/1',
};

function feld(snapshot: TileSnapshot, name: string): string | undefined {
  return renderTile(snapshot).embeds[0]?.fields.find((f) => f.name === name)?.value;
}

describe('renderTile (F3)', () => {
  it('zeigt Zustand, Spieler, Adresse und Laufzeit', () => {
    expect(feld(BASIS, 'Status')).toBe('Läuft');
    expect(feld(BASIS, 'Spieler')).toBe('3 / 20');
    expect(feld(BASIS, 'Adresse')).toBe('`survival.example.de`');
    // Discord rechnet den relativen Zeitstempel selbst fort.
    expect(feld(BASIS, 'Läuft seit')).toBe(`<t:${String(Date.UTC(2026, 8, 23, 10) / 1000)}:R>`);
  });

  it('zeigt bei einem gestoppten Server keine Laufzeit', () => {
    expect(feld({ ...BASIS, status: 'stopped' }, 'Läuft seit')).toBeUndefined();
  });

  it('lässt Spieler weg, wenn das Spiel keine meldet', () => {
    expect(feld({ ...BASIS, players: null }, 'Spieler')).toBeUndefined();
  });

  it('pingt niemanden an', () => {
    expect(renderTile(BASIS).allowed_mentions).toEqual({ parse: [] });
  });

  it('verweist auf den Server im Panel', () => {
    expect(renderTile(BASIS).embeds[0]?.url).toBe(BASIS.panelUrl);
  });
});

describe('tileHash', () => {
  it('bleibt gleich, solange sich nichts ändert, das man sieht', () => {
    expect(tileHash(renderTile(BASIS))).toBe(tileHash(renderTile({ ...BASIS })));
  });

  it('ändert sich mit der Spielerzahl', () => {
    expect(tileHash(renderTile(BASIS))).not.toBe(
      tileHash(renderTile({ ...BASIS, players: { online: 4, max: 20 } })),
    );
  });
});
