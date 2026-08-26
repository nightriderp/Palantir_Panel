/**
 * Zod-Schemas zu Ressourcen & Kapazität (Pflichtenheft §6 und §10).
 *
 * Gegenstück zu `UserResourceLimits`, `NodeResources` und
 * `ResourceWarningThresholds` aus `@palantir/contracts`. Backend
 * (Request-Validierung beim Setzen eines Kontingents) und Frontend
 * (Kontingent-Formular in F10) nutzen dieselben Schemas – kein zweiter,
 * abweichender Regelsatz.
 */

import { z } from 'zod';

/**
 * Menge in MiB.
 *
 * `0` ist bewusst erlaubt: ein Kontingent von 0 MiB ist die ausdrückliche
 * Aussage „dieser Nutzer darf nichts starten" und damit ein gültiger
 * Verwaltungszustand, kein Eingabefehler.
 */
export const megabytesSchema = z
  .number()
  .int({ message: 'Speichermengen werden in ganzen MiB angegeben.' })
  .nonnegative({ message: 'Eine Speichermenge kann nicht negativ sein.' })
  .max(1024 * 1024 * 64, { message: 'Die Speichermenge ist unplausibel groß.' });

/**
 * CPU-Anteil in Kernen.
 *
 * Nachkommastellen sind erlaubt (Docker rechnet mit Bruchteilen von Kernen),
 * aber auf zwei Stellen begrenzt – feiner steuert die Container-Engine ohnehin
 * nicht sinnvoll, und krumme Werte erschweren das Nachrechnen im Support-Fall.
 */
export const cpuCoresSchema = z
  .number()
  .nonnegative({ message: 'Ein CPU-Anteil kann nicht negativ sein.' })
  .max(1024, { message: 'Der CPU-Anteil ist unplausibel groß.' })
  // Nicht `value * 100 % 1 === 0`: 0.07 * 100 ergibt in IEEE-754
  // 7.000000000000001 und würde fälschlich abgelehnt.
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-9, {
    message: 'Der CPU-Anteil darf höchstens zwei Nachkommastellen haben.',
  });

/** Anzahl gleichzeitig laufender Server. */
export const serverCountSchema = z
  .number()
  .int({ message: 'Die Serveranzahl muss eine ganze Zahl sein.' })
  .nonnegative({ message: 'Die Serveranzahl kann nicht negativ sein.' })
  .max(10_000, { message: 'Die Serveranzahl ist unplausibel groß.' });

/**
 * Gesamt-Ressourcen einer Node (`HostNode.totalResources`, Pflichtenheft §6).
 *
 * Die Werte stammen aus dem Datensatz der Node, nicht aus dem Code – die
 * Hardware aus Lastenheft §5 gilt nur für die erste Node.
 */
export const nodeResourcesSchema = z.object({
  ramMb: megabytesSchema,
  cpuCores: cpuCoresSchema,
  diskMb: megabytesSchema,
});

/**
 * Kontingent eines Nutzers (Entität `UserResourceLimit`, Pflichtenheft §6).
 *
 * Jedes Feld ist einzeln `null`-bar – `null` heißt „kein Limit für diese
 * Ressource". Fehlt ein Feld in der Eingabe, bleibt der bisherige Wert stehen;
 * ausdrückliches `null` hebt das Limit auf. Deshalb `nullish()` statt
 * `nullable()`: die beiden Fälle müssen unterscheidbar bleiben.
 */
export const userResourceLimitsInputSchema = z
  .object({
    maxRamMb: megabytesSchema.nullish(),
    maxCpuCores: cpuCoresSchema.nullish(),
    maxDiskMb: megabytesSchema.nullish(),
    maxConcurrentServers: serverCountSchema.nullish(),
  })
  .refine((input) => Object.keys(input).length > 0, {
    message: 'Es muss mindestens ein Kontingent-Feld angegeben werden.',
  });

/** Prozent-Schwellwert einer Ressourcen-Warnung. */
export const thresholdPercentSchema = z
  .number()
  .min(1, { message: 'Ein Schwellwert unter 1 % würde dauerhaft warnen.' })
  .max(100, { message: 'Ein Schwellwert über 100 % würde nie greifen.' });

/** Schwellwerte der Ressourcen-Warnungen (Pflichtenheft §10). */
export const resourceWarningThresholdsSchema = z.object({
  nodePercent: thresholdPercentSchema,
  serverPercent: thresholdPercentSchema,
});

export type UserResourceLimitsInput = z.infer<typeof userResourceLimitsInputSchema>;
export type NodeResourcesInput = z.infer<typeof nodeResourcesSchema>;
