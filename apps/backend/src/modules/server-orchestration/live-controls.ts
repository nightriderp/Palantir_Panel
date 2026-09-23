/**
 * Live-Steuerung (Betreiber-Wunsch 23.09.2026): Einstellungen bei laufendem
 * Server ändern, ohne Neustart.
 *
 * Was live geändert wird, **bleibt** – der Dienst schreibt es in die
 * Einstellungen, damit es Stopp und Neustart übersteht (Betreiber 23.09.2026).
 * `ServerRecord.liveValues` trägt nur noch Reste aus v2.4.6, als Live-Werte
 * bis zum nächsten Start galten. Welche Felder live gehen und mit welchen
 * Konsolenbefehlen, sagt die Definition (`GameTypeDefinition.liveControls`).
 *
 * Hier stehen nur reine Funktionen – prüfen, Befehle bauen, Dateiinhalt bauen.
 * Das Verschicken macht der Dienst.
 */

import {
  type GameConfigField,
  type GameConfigValues,
  type GameLiveControl,
  type GameTypeDefinition,
} from '@palantir/contracts';
import { ServerOrchestrationError } from './errors.js';

/** Die Felder, die live gehen – je Schlüssel seine Definition. */
function liveFelder(definition: GameTypeDefinition): Map<string, GameConfigField> {
  const felder = new Map<string, GameConfigField>();

  for (const steuerung of definition.liveControls ?? []) {
    for (const key of steuerung.fields) {
      const feld = definition.configFields.find((f) => f.key === key);

      if (feld !== undefined) {
        felder.set(key, feld);
      }
    }
  }

  return felder;
}

/**
 * Prüft eine Eingabe gegen die Definition und gibt die bereinigten Werte
 * zurück.
 *
 * **Nur `select` und `number`.** Ein Auswahlwert muss in der Auswahl stehen,
 * eine Zahl ganz sein und in ihren Grenzen liegen. Alles andere – ein
 * unbekanntes Feld, ein Freitextfeld, ein Wert außerhalb – ist ein Fehler: Die
 * Werte landen in Konsolenzeilen, und dort hätte ein beliebiger Text Befehle
 * einschleusen können.
 */
export function pruefeLiveWerte(
  definition: GameTypeDefinition,
  eingabe: Readonly<Record<string, string | number>>,
): GameConfigValues {
  const felder = liveFelder(definition);
  const ergebnis: GameConfigValues = {};

  for (const [key, wert] of Object.entries(eingabe)) {
    const feld = felder.get(key);

    if (feld === undefined) {
      throw new ServerOrchestrationError(
        'VALIDATION_FAILED',
        `„${key}“ lässt sich nicht live ändern.`,
        { field: key },
      );
    }

    if (feld.type === 'select') {
      if (typeof wert !== 'string' || !feld.options.includes(wert)) {
        throw new ServerOrchestrationError(
          'VALIDATION_FAILED',
          `„${String(wert)}“ ist für ${feld.label} nicht zulässig.`,
          { field: key },
        );
      }
    } else if (feld.type === 'number') {
      const zahl = typeof wert === 'number' ? wert : Number.NaN;
      const zuKlein = feld.min !== null && zahl < feld.min;
      const zuGross = feld.max !== null && zahl > feld.max;

      if (!Number.isInteger(zahl) || zuKlein || zuGross) {
        throw new ServerOrchestrationError(
          'VALIDATION_FAILED',
          `${feld.label} muss eine ganze Zahl${
            feld.min !== null && feld.max !== null
              ? ` von ${String(feld.min)} bis ${String(feld.max)}`
              : ''
          } sein.`,
          { field: key },
        );
      }
    } else {
      // Die Definition trägt ein Feld live, das dafür nicht taugt – ein
      // Fehler im Katalog, den der Registry-Test abfängt.
      throw new ServerOrchestrationError(
        'VALIDATION_FAILED',
        `${feld.label} lässt sich nicht live ändern.`,
        { field: key },
      );
    }

    ergebnis[key] = wert;
  }

  return ergebnis;
}

/**
 * Die Werte, die gerade gelten: Startwert aus den Einstellungen (oder die
 * Vorgabe des Feldes), überschrieben von dem, was seit dem Start live geändert
 * wurde.
 */
export function aktuelleWerte(
  definition: GameTypeDefinition,
  config: GameConfigValues,
  liveValues: GameConfigValues | null | undefined,
): GameConfigValues {
  const werte: GameConfigValues = {};

  for (const key of liveFelder(definition).keys()) {
    const feld = definition.configFields.find((f) => f.key === key);
    const start = config[key] ?? feld?.defaultValue;

    if (start !== undefined) {
      werte[key] = start;
    }
  }

  return { ...werte, ...(liveValues ?? {}) };
}

/** `{feld}` durch den nackten Wert ersetzen. */
function roh(zeile: string, werte: GameConfigValues): string {
  return zeile.replace(/\{([a-zA-Z0-9_]+)\}/gu, (_, key: string) => {
    const wert = werte[key];

    return wert === undefined ? '' : String(wert);
  });
}

/**
 * `{feld}` in einer Zeile durch den Wert ersetzen – oder durch
 * `values[feld][wert]`.
 *
 * Eine Übersetzung darf selbst Platzhalter tragen, die dann den nackten Wert
 * bekommen: CS2 übersetzt die Karte `workshop` in
 * `host_workshop_map {workshopMap}`. Eine Ebene, nicht mehr – und nur in
 * Texten aus der Definition, nie in Werten des Nutzers.
 */
function einsetzen(zeile: string, steuerung: GameLiveControl, werte: GameConfigValues): string {
  return zeile.replace(/\{([a-zA-Z0-9_]+)\}/gu, (_, key: string) => {
    const wert = werte[key];
    const text = wert === undefined ? '' : String(wert);
    const uebersetzt = steuerung.values?.[key]?.[text];

    return uebersetzt === undefined ? text : roh(uebersetzt, werte);
  });
}

/**
 * Die Konsolenzeilen für eine Änderung: nur für die Steuerungen, in denen sich
 * etwas geändert hat, in der Reihenfolge der Definition.
 */
export function liveBefehle(
  definition: GameTypeDefinition,
  geaendert: readonly string[],
  werte: GameConfigValues,
): string[] {
  const zeilen: string[] = [];

  for (const steuerung of definition.liveControls ?? []) {
    if (!steuerung.fields.some((key) => geaendert.includes(key))) {
      continue;
    }

    for (const zeile of steuerung.commands) {
      zeilen.push(einsetzen(zeile, steuerung, werte));
    }
  }

  return zeilen;
}

/**
 * Inhalt der Datei `liveConfigFile`: die `persist`-Zeilen aller Steuerungen mit
 * den geltenden Werten. `null`, wenn die Definition keine Datei vorsieht.
 */
export function liveDatei(definition: GameTypeDefinition, werte: GameConfigValues): string | null {
  if (definition.liveConfigFile === undefined) {
    return null;
  }

  const zeilen = ['// Schreibt Palantir bei jeder Live-Aenderung neu; das Startskript leert sie.'];

  for (const steuerung of definition.liveControls ?? []) {
    for (const zeile of steuerung.persist ?? []) {
      zeilen.push(einsetzen(zeile, steuerung, werte));
    }
  }

  return `${zeilen.join('\n')}\n`;
}
