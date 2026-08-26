/**
 * Crash-Loop-Schutz (Pflichtenheft §9, Lastenheft §3.3).
 *
 * „Bei `crashed`: automatischer Neustart-Versuch mit begrenzter Anzahl an
 * Wiederholungen innerhalb eines Zeitfensters, danach `error` mit
 * Benachrichtigung."
 *
 * Umgesetzt als gleitendes Zeitfenster über die Absturz-Zeitpunkte, nicht als
 * einfacher Zähler: Ein Server, der einmal im Monat abstürzt, soll nie in den
 * Schutz laufen. Ein Zähler, der nur beim erfolgreichen Start zurückgesetzt
 * wird, würde genau das tun – ein Server, der nie lange genug läuft, um als
 * „erfolgreich gestartet" zu gelten, sammelt sonst über Wochen Zähler an.
 *
 * Diese Datei kennt weder Datenbank noch Agent: reine Werte, vollständig ohne
 * Infrastruktur testbar (CLAUDE.md §4).
 */

/** Regelwerk des Schutzes. Die Werte kommen aus der Konfiguration (`.env`). */
export interface CrashLoopPolicy {
  /**
   * Wie viele automatische Neustarts im Zeitfenster erlaubt sind.
   *
   * Gezählt werden Abstürze: beim `maxRestarts + 1`-ten Absturz innerhalb des
   * Fensters wird nicht mehr neu gestartet.
   */
  readonly maxRestarts: number;
  /** Länge des gleitenden Zeitfensters in Minuten. */
  readonly windowMinutes: number;
}

/**
 * Vorgabewerte.
 *
 * Drei Versuche in zehn Minuten: genug, um eine kurzzeitige Störung
 * (belegter Port, hängender Nachbar-Container) zu überstehen, und wenig genug,
 * dass ein defekter Server nicht stundenlang im Sekundentakt neu startet.
 */
export const DEFAULT_CRASH_LOOP_POLICY: CrashLoopPolicy = {
  maxRestarts: 3,
  windowMinutes: 10,
};

export interface CrashLoopEvaluation {
  /** `true`, wenn nicht mehr automatisch neu gestartet werden darf. */
  readonly tripped: boolean;
  /** Abstürze innerhalb des Fensters, den gerade gemeldeten eingeschlossen. */
  readonly recentCrashCount: number;
  /** Verbleibende automatische Neustart-Versuche im Fenster. */
  readonly remainingAttempts: number;
  /** Die um alte Einträge bereinigte Liste – so wird sie zurückgeschrieben. */
  readonly crashTimestamps: readonly string[];
}

function toMillis(timestamp: string): number {
  return Date.parse(timestamp);
}

/**
 * Entfernt Absturz-Zeitpunkte, die außerhalb des Fensters liegen.
 *
 * Unlesbare Zeitstempel werden verworfen statt als „jetzt" gewertet: ein
 * kaputter Eintrag in der Datenbank darf keinen Server abschalten.
 */
export function pruneCrashTimestamps(
  timestamps: readonly string[],
  now: Date,
  windowMinutes: number,
): string[] {
  const cutoff = now.getTime() - windowMinutes * 60_000;

  return timestamps
    .filter((timestamp) => {
      const millis = toMillis(timestamp);

      return Number.isFinite(millis) && millis > cutoff;
    })
    .sort((a, b) => toMillis(a) - toMillis(b));
}

/**
 * Bewertet einen **neu gemeldeten** Absturz.
 *
 * @param previousTimestamps bisher gespeicherte Absturz-Zeitpunkte des Servers
 * @param crashedAt Zeitpunkt des jetzt gemeldeten Absturzes
 */
export function registerCrash(
  previousTimestamps: readonly string[],
  crashedAt: Date,
  policy: CrashLoopPolicy = DEFAULT_CRASH_LOOP_POLICY,
): CrashLoopEvaluation {
  const timestamp = crashedAt.toISOString();
  const crashTimestamps = pruneCrashTimestamps(
    [...previousTimestamps, timestamp],
    crashedAt,
    policy.windowMinutes,
  );

  const recentCrashCount = crashTimestamps.length;
  const remainingAttempts = Math.max(0, policy.maxRestarts - recentCrashCount + 1);

  return {
    tripped: remainingAttempts === 0,
    recentCrashCount,
    remainingAttempts,
    crashTimestamps,
  };
}

/**
 * Bewertet den aktuellen Stand **ohne** neuen Absturz – etwa beim Ausliefern
 * des DTOs (`recentCrashCount`) oder vor einem manuellen Start.
 */
export function evaluateCrashLoop(
  timestamps: readonly string[],
  now: Date,
  policy: CrashLoopPolicy = DEFAULT_CRASH_LOOP_POLICY,
): CrashLoopEvaluation {
  const crashTimestamps = pruneCrashTimestamps(timestamps, now, policy.windowMinutes);
  const recentCrashCount = crashTimestamps.length;
  const remainingAttempts = Math.max(0, policy.maxRestarts - recentCrashCount);

  return {
    tripped: remainingAttempts === 0 && recentCrashCount > policy.maxRestarts,
    recentCrashCount,
    remainingAttempts,
    crashTimestamps,
  };
}

/**
 * Setzt den Schutz zurück.
 *
 * Wird nach einem **erfolgreichen** Start aufgerufen, also erst nach
 * bestandenem Health-Check – nicht schon beim Absetzen des Startbefehls.
 * Andernfalls würde ein Server, der beim Hochlauf immer wieder abstürzt, den
 * Zähler bei jedem Versuch selbst zurücksetzen und nie in den Schutz laufen.
 */
export function clearCrashHistory(): string[] {
  return [];
}
