import { type GameTypeDefinition } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import { TEST_GAME_TYPE } from './game-registry.js';
import { aktuelleWerte, liveBefehle, liveDatei, pruefeLiveWerte } from './live-controls.js';

/**
 * Live-Steuerung (Betreiber-Wunsch 23.09.2026): die reinen Funktionen.
 */
const SPIEL: GameTypeDefinition = {
  ...TEST_GAME_TYPE,
  id: 'test-live',
  configFields: [
    {
      key: 'map',
      label: 'Startkarte',
      type: 'select',
      defaultValue: 'a',
      description: '',
      required: false,
      options: ['a', 'b'],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'mode',
      label: 'Modus',
      type: 'select',
      defaultValue: 'eins',
      description: '',
      required: false,
      options: ['eins', 'zwei'],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'bots',
      label: 'Bots',
      type: 'number',
      defaultValue: 0,
      description: '',
      required: false,
      options: [],
      min: 0,
      max: 10,
      lockedAfterCreate: false,
    },
    {
      key: 'name',
      label: 'Name',
      type: 'text',
      defaultValue: 'x',
      description: '',
      required: false,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
  ],
  liveControls: [
    {
      id: 'karte-modus',
      label: 'Karte & Modus',
      fields: ['map', 'mode'],
      commands: ['{mode}', 'changelevel {map}'],
      values: { mode: { eins: 'typ 0', zwei: 'typ 1; art 2' } },
      reloadsMap: true,
    },
    {
      id: 'bots',
      label: 'Bots',
      fields: ['bots'],
      commands: ['bot_quota {bots}'],
      persist: ['bot_quota {bots}'],
    },
  ],
  liveConfigFile: 'cfg/live.cfg',
};

describe('pruefeLiveWerte', () => {
  it('nimmt Werte aus der Auswahl und Zahlen in den Grenzen', () => {
    expect(pruefeLiveWerte(SPIEL, { map: 'b', bots: 3 })).toEqual({ map: 'b', bots: 3 });
  });

  it('lehnt einen Wert außerhalb der Auswahl ab', () => {
    expect(() => pruefeLiveWerte(SPIEL, { map: 'c; quit' })).toThrow(/nicht zulässig/u);
  });

  it('lehnt Zahlen außerhalb der Grenzen und Kommazahlen ab', () => {
    expect(() => pruefeLiveWerte(SPIEL, { bots: 11 })).toThrow(/0 bis 10/u);
    expect(() => pruefeLiveWerte(SPIEL, { bots: 1.5 })).toThrow();
    expect(() => pruefeLiveWerte(SPIEL, { bots: '3' })).toThrow();
  });

  it('lehnt Felder ab, die nicht live gehen – auch Freitext', () => {
    expect(() => pruefeLiveWerte(SPIEL, { name: 'hallo; quit' })).toThrow(/nicht live/u);
    expect(() => pruefeLiveWerte(SPIEL, { gibtsnicht: 1 })).toThrow(/nicht live/u);
  });
});

describe('pruefeLiveWerte – Schalter', () => {
  const MIT_SCHALTER: GameTypeDefinition = {
    ...SPIEL,
    configFields: [
      ...SPIEL.configFields,
      {
        key: 'alle',
        label: 'Alle Runden',
        type: 'toggle',
        defaultValue: false,
        description: '',
        required: false,
        options: [],
        min: null,
        max: null,
        lockedAfterCreate: false,
      },
    ],
    liveControls: [
      ...(SPIEL.liveControls ?? []),
      {
        id: 'runden',
        label: 'Runden',
        fields: ['alle'],
        commands: ['{alle}'],
        values: { alle: { true: 'clinch 0', false: 'clinch 1' } },
      },
    ],
  };

  it('nimmt an und aus und übersetzt sie', () => {
    expect(pruefeLiveWerte(MIT_SCHALTER, { alle: true })).toEqual({ alle: true });
    expect(liveBefehle(MIT_SCHALTER, ['alle'], { alle: false })).toEqual(['clinch 1']);
  });

  it('lehnt Text und Zahlen für einen Schalter ab', () => {
    expect(() => pruefeLiveWerte(MIT_SCHALTER, { alle: 'true' })).toThrow(/an oder aus/u);
    expect(() => pruefeLiveWerte(MIT_SCHALTER, { alle: 1 })).toThrow(/an oder aus/u);
  });
});

describe('aktuelleWerte', () => {
  it('nimmt die Einstellungen, sonst die Vorgabe, und live Geändertes zuletzt', () => {
    expect(aktuelleWerte(SPIEL, { map: 'b' }, { bots: 4 })).toEqual({
      map: 'b',
      mode: 'eins',
      bots: 4,
    });
  });
});

describe('liveBefehle', () => {
  it('schickt nur die Befehle der Steuerungen, in denen sich etwas geändert hat', () => {
    expect(liveBefehle(SPIEL, ['bots'], { map: 'a', mode: 'eins', bots: 5 })).toEqual([
      'bot_quota 5',
    ]);
  });

  it('übersetzt Werte und setzt den Rest der Gruppe mit ein', () => {
    // Nur der Modus hat sich geändert – die Karte muss trotzdem mit, sonst
    // lüde changelevel nichts.
    expect(liveBefehle(SPIEL, ['mode'], { map: 'b', mode: 'zwei', bots: 0 })).toEqual([
      'typ 1; art 2',
      'changelevel b',
    ]);
  });
});

describe('liveBefehle – Übersetzung mit Platzhaltern', () => {
  const MIT_ID: GameTypeDefinition = {
    ...SPIEL,
    liveControls: [
      {
        id: 'karte',
        label: 'Karte',
        fields: ['map', 'bots'],
        commands: ['{map}'],
        values: { map: { a: 'changelevel a', b: 'lade {bots}' } },
      },
    ],
  };

  it('setzt in einer Übersetzung die nackten Werte ein', () => {
    expect(liveBefehle(MIT_ID, ['map'], { map: 'b', bots: 7 })).toEqual(['lade 7']);
    expect(liveBefehle(MIT_ID, ['map'], { map: 'a', bots: 7 })).toEqual(['changelevel a']);
  });

  it('übersetzt nur eine Ebene – ein Wert mit Klammern bleibt, wie er ist', () => {
    const tief: GameTypeDefinition = {
      ...MIT_ID,
      liveControls: [
        {
          id: 'karte',
          label: 'Karte',
          fields: ['map', 'mode'],
          commands: ['{map}'],
          values: { map: { a: 'x {mode}' }, mode: { eins: 'nicht {map}' } },
        },
      ],
    };

    expect(liveBefehle(tief, ['map'], { map: 'a', mode: 'eins' })).toEqual(['x eins']);
  });
});

describe('liveDatei', () => {
  it('enthält die persist-Zeilen mit den geltenden Werten', () => {
    expect(liveDatei(SPIEL, { map: 'a', mode: 'eins', bots: 6 })).toMatch(/^bot_quota 6$/mu);
  });

  it('gibt es nicht, wenn die Definition keine Datei vorsieht', () => {
    const { liveConfigFile: _weg, ...ohne } = SPIEL;

    expect(liveDatei(ohne, { bots: 1 })).toBeNull();
  });
});
