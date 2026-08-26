/**
 * Auto-Shutdown bei Inaktivität (Pflichtenheft §9, Lastenheft §3.3).
 *
 * „Periodische Spielerabfrage durch den Agent; Schonfrist nach Start,
 * konfigurierbarer Inaktivitäts-Timeout, pro Server deaktivierbar."
 *
 * Die eigentliche Abfrage macht der Agent (A3); hier steht ausschließlich die
 * **Entscheidung**, ob abgeschaltet wird. Das ist Absicht: Die Regel, wann ein
 * Server als inaktiv gilt, gehört ins Backend, damit sie an einer Stelle steht
 * und ohne laufenden Homeserver prüfbar ist (CLAUDE.md §4).
 *
 * Der Zusammenhang zum Lifecycle: `lastStartedAt` wird auch beim automatischen
 * Neustart nach einem Absturz neu gesetzt (siehe `state-machine.ts`). Ein
 * gerade wiederhergestellter Server bekommt seine volle Schonfrist und wird
 * nicht sofort wieder abgeschaltet (Pflichtenheft §9).
 */

import { type ServerStatus } from '@palantir/contracts';
import { type ServerAutoShutdown } from './types.js';

/**
 * Vorgabewerte für neue Server.
 *
 * 30 Minuten Inaktivität und 15 Minuten Schonfrist: lang genug, dass niemand
 * beim Aufbau einer Runde ausgesperrt wird, kurz genug, dass ein vergessener
 * Server nicht über Nacht Strom zieht. Pro Server änderbar.
 */
export const DEFAULT_AUTO_SHUTDOWN: ServerAutoShutdown = {
  enabled: true,
  idleTimeoutMinutes: 30,
  graceMinutes: 15,
};

export interface AutoShutdownInput {
  readonly settings: ServerAutoShutdown;
  readonly status: ServerStatus;
  /**
   * ISO-8601-Zeitstempel des letzten erfolgreichen Starts. Ein automatischer
   * Neustart nach Absturz zählt hier als regulärer Start (Pflichtenheft §9).
   */
  readonly lastStartedAt: string | null;
  /**
   * ISO-8601-Zeitstempel, zu dem zuletzt Spieler gesehen wurden. `null`, wenn
   * seit dem Start nie jemand verbunden war – dann zählt die Zeit ab dem Start.
   */
  readonly lastActivityAt: string | null;
  /**
   * Zuletzt gemeldete Spielerzahl. `null`, wenn das Spiel keine liefert (etwa
   * beim Test-Typ mit reinem Port-Connect-Test).
   */
  readonly playersOnline: number | null;
  readonly now: Date;
}

/** Grund, warum **nicht** abgeschaltet wird – wandert unverändert ins Log. */
export type AutoShutdownKeepReason =
  /** Pro Server deaktiviert, etwa für ein geplantes Event. */
  | 'disabled'
  /** Nur ein laufender Server kann abgeschaltet werden. */
  | 'notRunning'
  /** Schonfrist nach dem Start läuft noch. */
  | 'graceActive'
  /** Es sind Spieler verbunden. */
  | 'playersOnline'
  /** Inaktivität liegt noch unter dem Timeout. */
  | 'idleBelowTimeout'
  /**
   * Das Spiel liefert keine Spielerzahl und es liegt keine Aktivität vor, an
   * der sich die Inaktivität messen ließe.
   */
  | 'activityUnknown';

export type AutoShutdownDecision =
  | { readonly action: 'keepRunning'; readonly reason: AutoShutdownKeepReason }
  | { readonly action: 'shutdown'; readonly idleMinutes: number };

function minutesBetween(fromIso: string, now: Date): number | null {
  const from = Date.parse(fromIso);

  if (!Number.isFinite(from)) {
    return null;
  }

  return (now.getTime() - from) / 60_000;
}

/**
 * Entscheidet, ob ein Server wegen Inaktivität abgeschaltet wird.
 *
 * Reihenfolge der Prüfungen ist bewusst so gewählt, dass die billigste und
 * eindeutigste Ablehnung zuerst greift und die Schonfrist **vor** der
 * Spielerzahl kommt: Innerhalb der Schonfrist ist die Spielerzahl ohne
 * Bedeutung, ein Server darf dort auch leer laufen.
 */
export function decideAutoShutdown(input: AutoShutdownInput): AutoShutdownDecision {
  const { settings, status, now } = input;

  if (!settings.enabled) {
    return { action: 'keepRunning', reason: 'disabled' };
  }

  // Nur ein laufender Server wird abgeschaltet. `starting` bewusst nicht: ein
  // Server, der gerade hochfährt, hat naturgemäß keine Spieler.
  if (status !== 'running') {
    return { action: 'keepRunning', reason: 'notRunning' };
  }

  if (input.lastStartedAt !== null) {
    const sinceStart = minutesBetween(input.lastStartedAt, now);

    if (sinceStart !== null && sinceStart < settings.graceMinutes) {
      return { action: 'keepRunning', reason: 'graceActive' };
    }
  }

  if (input.playersOnline !== null && input.playersOnline > 0) {
    return { action: 'keepRunning', reason: 'playersOnline' };
  }

  // Ohne Aktivitätszeitpunkt zählt die Zeit ab dem Start: seit dem Start war
  // niemand da, also ist der Server seit dem Start inaktiv.
  const referenceIso = input.lastActivityAt ?? input.lastStartedAt;

  if (referenceIso === null) {
    return { action: 'keepRunning', reason: 'activityUnknown' };
  }

  const idleMinutes = minutesBetween(referenceIso, now);

  if (idleMinutes === null) {
    return { action: 'keepRunning', reason: 'activityUnknown' };
  }

  if (idleMinutes < settings.idleTimeoutMinutes) {
    return { action: 'keepRunning', reason: 'idleBelowTimeout' };
  }

  return { action: 'shutdown', idleMinutes };
}

/**
 * Zeitpunkt, ab dem die Schonfrist abgelaufen ist – für die Anzeige im
 * Frontend („wird abgeschaltet ab …"). `null`, wenn der Server nie gestartet
 * wurde oder der Auto-Shutdown aus ist.
 */
export function graceEndsAt(
  settings: ServerAutoShutdown,
  lastStartedAt: string | null,
): string | null {
  if (!settings.enabled || lastStartedAt === null) {
    return null;
  }

  const started = Date.parse(lastStartedAt);

  if (!Number.isFinite(started)) {
    return null;
  }

  return new Date(started + settings.graceMinutes * 60_000).toISOString();
}
