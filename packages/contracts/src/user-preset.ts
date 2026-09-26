/**
 * Eigene Profile (Betreiber-Wunsch 25.09.2026, Idee P / A2).
 *
 * Neben den mitgelieferten Profilen eines Spiels ({@link GamePreset}) speichert
 * ein Konto eigene: die Werte der Steuerung unter einem Namen, später mit einem
 * Klick wieder übernommen. Ein Profil gehört genau einem Konto und genau einem
 * Spieltyp; andere Konten sehen es nicht.
 *
 * Gespeichert werden nur Felder der Steuerung (`GameTypeDefinition.liveControls`)
 * – dieselben, die auch ein mitgeliefertes Profil setzen darf. Freie
 * Konsolenbefehle nimmt ein Profil nicht an.
 */

import type { GameConfigValues } from './game-type.js';

/** Was der Abrufende mit diesem Profil tun darf (Pflichtenheft §5). */
export interface UserPresetPermissions {
  /** Umbenennen oder mit den aktuellen Werten überschreiben – nur das eigene. */
  canEdit: boolean;
  /** Löschen – nur das eigene. */
  canDelete: boolean;
}

export interface UserPresetDto {
  id: string;
  /** Spieltyp, zu dem das Profil gehört, z. B. `cs2`. */
  gameType: string;
  /** Anzeigename, je Konto und Spieltyp eindeutig. */
  name: string;
  /** Werte der Steuerung, die das Profil setzt. */
  values: GameConfigValues;
  /** ISO-8601 der Anlage. */
  createdAt: string;
  /** ISO-8601 der letzten Änderung. */
  updatedAt: string;
  permissions: UserPresetPermissions;
}

/** Höchstens so viele eigene Profile je Konto und Spieltyp. */
export const USER_PRESET_LIMIT = 30;
