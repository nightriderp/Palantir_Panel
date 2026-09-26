import { ARCADE_GAME_IDS } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import { compileTrack } from '../sequencer';
import { SECTION_SIXTEENTHS, type Section } from '../types';
import { ARCADE_TRACKS } from './index';

/**
 * Jede Melodie muss taktgenau aufgehen.
 *
 * Läuft eine Stimme in einem Abschnitt auch nur ein Sechzehntel zu lang, rutscht
 * sie mit jeder Wiederholung weiter gegen die anderen – nach zwei Minuten spielt
 * der Bass im falschen Takt. Das hört man beim Komponieren nicht, weil man das
 * Stück selten so lange laufen lässt; deshalb prüft es dieser Test für alle.
 */

function sectionLength(section: Section): number {
  return section.reduce((sum, [, dauer]) => sum + dauer, 0);
}

describe.each(ARCADE_GAME_IDS.map((id) => [id, ARCADE_TRACKS[id]] as const))(
  'Melodie %s',
  (_id, track) => {
    it('hat Titel und ein Tempo zwischen 40 und 240', () => {
      expect(track.title.trim().length).toBeGreaterThan(0);
      expect(track.bpm).toBeGreaterThanOrEqual(40);
      expect(track.bpm).toBeLessThanOrEqual(240);
    });

    it('jede Stimme jedes Abschnitts dauert genau vier Takte', () => {
      expect(track.melody.length).toBeGreaterThan(0);
      const voices = { melody: track.melody, bass: track.bass, harmony: track.harmony ?? [] };
      for (const [voice, sections] of Object.entries(voices)) {
        sections.forEach((section, index) => {
          expect(sectionLength(section), `${voice}[${index}]`).toBe(SECTION_SIXTEENTHS);
        });
      }
    });

    it('Bass und Harmonie haben so viele Abschnitte wie die Melodie', () => {
      expect(track.bass.length).toBe(track.melody.length);
      if (track.harmony) expect(track.harmony.length).toBe(track.melody.length);
    });

    it('Noten sind ganzzahlige MIDI-Werte, Längen positive Ganzzahlen', () => {
      for (const section of [...track.melody, ...track.bass, ...(track.harmony ?? [])]) {
        for (const [midi, dauer] of section) {
          if (midi !== null) {
            expect(Number.isInteger(midi)).toBe(true);
            expect(midi).toBeGreaterThanOrEqual(0);
            expect(midi).toBeLessThanOrEqual(127);
          }
          expect(Number.isInteger(dauer)).toBe(true);
          expect(dauer).toBeGreaterThan(0);
        }
      }
    });

    it('Schlagzeug-Muster haben 16 Zeichen aus „ksh."', () => {
      for (const pattern of track.drums ?? []) {
        expect(pattern).toMatch(/^[ksh.]{16}$/);
      }
    });

    it('lässt sich in eine Zeitleiste übersetzen', () => {
      const compiled = compileTrack(track);
      expect(compiled.length).toBe(track.melody.length * SECTION_SIXTEENTHS);
      expect(compiled.drums).toHaveLength(compiled.length);
    });
  },
);
