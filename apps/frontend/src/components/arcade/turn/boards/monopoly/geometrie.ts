/**
 * Geometrie und Farben des Monopoly-Bretts.
 *
 * Das Brett ist ein Quadrat von 1000 × 1000 Einheiten: vier Ecken zu 130, dazwischen
 * je neun Felder. Jedes Randfeld wird in einem eigenen, gedrehten Koordinatensystem
 * gezeichnet (Farbbalken oben = zur Brettmitte hin), damit es nur eine
 * Zeichenroutine für alle vier Seiten gibt.
 */

import { type Feld } from './types';

export const BRETT = 1000;
export const ECKE = 130;
export const BREITE = (BRETT - 2 * ECKE) / 9;

/** Farben der acht Straßengruppen (Badstraße … Schlossallee). */
export const GRUPPEN_FARBEN = [
  '#a463d8',
  '#7dd3fc',
  '#f472b6',
  '#fb923c',
  '#ef4444',
  '#facc15',
  '#22c55e',
  '#3b82f6',
] as const;

export function gruppenFarbe(gruppe: number): string {
  return GRUPPEN_FARBEN[gruppe] ?? '#94a3b8';
}

export interface Zelle {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  /** Drehung des lokalen Systems (0 unten, 90 links, 180 oben, 270 rechts). */
  rot: number;
  ecke: boolean;
}

export function zelle(i: number): Zelle {
  const mach = (x: number, y: number, w: number, h: number, rot: number, ecke = false): Zelle => ({
    x,
    y,
    w,
    h,
    cx: x + w / 2,
    cy: y + h / 2,
    rot,
    ecke,
  });
  const innen = BRETT - ECKE;
  if (i === 0) return mach(innen, innen, ECKE, ECKE, 0, true);
  if (i === 10) return mach(0, innen, ECKE, ECKE, 90, true);
  if (i === 20) return mach(0, 0, ECKE, ECKE, 180, true);
  if (i === 30) return mach(innen, 0, ECKE, ECKE, 270, true);
  if (i < 10) return mach(innen - i * BREITE, innen, BREITE, ECKE, 0);
  if (i < 20) return mach(0, innen - (i - 10) * BREITE, ECKE, BREITE, 90);
  if (i < 30) return mach(ECKE + (i - 21) * BREITE, 0, BREITE, ECKE, 180);
  return mach(innen, ECKE + (i - 31) * BREITE, ECKE, BREITE, 270);
}

/** Lokale Koordinate eines Randfelds in Brett-Koordinaten umrechnen. */
export function lokalZuBrett(i: number, lx: number, ly: number): [number, number] {
  const z = zelle(i);
  switch (z.rot) {
    case 90:
      return [z.cx - ly, z.cy + lx];
    case 180:
      return [z.cx - lx, z.cy - ly];
    case 270:
      return [z.cx + ly, z.cy - lx];
    default:
      return [z.cx + lx, z.cy + ly];
  }
}

/**
 * Platz einer Spielfigur: im äußeren Teil des Feldes, bis zu sechs Figuren im
 * Raster. Im Gefängnis sitzen Figuren im inneren Käfig der Ecke.
 */
export function figurPlatz(feld: number, slot: number, imGefaengnis: boolean): [number, number] {
  const spalte = slot % 3;
  const zeile = Math.floor(slot / 3);
  const z = zelle(feld);
  if (feld === 10) {
    if (imGefaengnis) return [72 + spalte * 22, BRETT - ECKE + 22 + zeile * 26];
    // Nur zu Besuch: am äußeren Rand der Ecke entlang.
    return slot < 3 ? [18, BRETT - ECKE + 30 + slot * 30] : [30 + (slot - 3) * 30, BRETT - 18];
  }
  if (z.ecke) return [z.cx - 30 + spalte * 30, z.cy + 10 + zeile * 28];
  const lx = -BREITE / 2 + 18 + spalte * ((BREITE - 36) / 2);
  const ly = 12 + zeile * 26;
  return lokalZuBrett(feld, lx, ly);
}

/** Kurzname in ein bis zwei Zeilen für die enge Feldbeschriftung. */
export function kurzname(f: Feld): string[] {
  const sonder: Record<string, string[]> = {
    Elektrizitätswerk: ['E-Werk'],
    Wasserwerk: ['Wasser-', 'werk'],
    Gemeinschaftsfeld: ['Gemein-', 'schaft'],
    Ereignisfeld: ['Ereignis'],
    Einkommensteuer: ['Einkom-', 'mensteuer'],
    Zusatzsteuer: ['Zusatz-', 'steuer'],
    Schlossallee: ['Schloss-', 'allee'],
  };
  const s = sonder[f.name];
  if (s) return s;
  if (f.name.includes(' ')) return f.name.split(' ');
  if (f.name.endsWith('straße') && f.name.length > 8) return [`${f.name.slice(0, -6)}-`, 'straße'];
  if (f.name.endsWith('bahnhof')) return [`${f.name.slice(0, -7)}-`, 'bahnhof'];
  return [f.name];
}

export function euro(betrag: number): string {
  return `${betrag.toLocaleString('de-DE')} €`;
}
