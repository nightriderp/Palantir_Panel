/**
 * Schwellwerte der Ressourcen-Warnungen aus der zentralen `.env`
 * (Pflichtenheft §10 und §12.1).
 *
 * Die Werte stehen in `.env.example` Abschnitt 13; geprüft werden sie beim
 * Backend-Start in `config/env.ts`. Diese Datei bündelt sie nur zum
 * Vertragsobjekt `ResourceWarningThresholds`, damit `capacity.ts` und
 * `thresholds.ts` weiterhin ohne Zugriff auf die Umgebung auskommen.
 */

import { type ResourceWarningThresholds } from '@palantir/contracts';
import { env } from '../../config/env.js';

export function resourceWarningThresholdsFromEnv(): ResourceWarningThresholds {
  return {
    nodePercent: env.RESOURCE_WARN_NODE_PERCENT,
    serverPercent: env.RESOURCE_WARN_SERVER_PERCENT,
  };
}
