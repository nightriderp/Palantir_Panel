/**
 * Vollabgleich der Discord-Kanäle im eigenen Takt (Pflichtenheft §14a.4).
 *
 * Der Zeitgeber des Backends tickt jede Minute; diese Aufgabe läuft nur alle
 * `intervalMs` – dasselbe Muster wie `stateReconcileTask` in `scheduler.ts`.
 * Sie holt nach, was kein Ereignis und kein Audit-Eintrag meldet: ein neu
 * verknüpfter Discord-Account, ein Beitritt zum Discord-Server, ein
 * geänderter Anzeigename.
 */

import type { ScheduledTask, SchedulerLogger } from '../../scheduler.js';
import type { DiscordSync } from './sync.js';

export function discordSyncTask(
  sync: DiscordSync,
  intervalMs: number,
  log: SchedulerLogger,
  now: () => number = Date.now,
): ScheduledTask {
  // Der erste Lauf kommt aus dem Start (`onListen`), deshalb hier ab jetzt zählen.
  let letzterLauf = now();

  return {
    name: 'discordSync',
    async run(): Promise<void> {
      const jetzt = now();

      if (jetzt - letzterLauf < intervalMs) return;

      letzterLauf = jetzt;

      try {
        await sync.run();
      } catch (error: unknown) {
        log.error(
          { error: error instanceof Error ? error.message : String(error) },
          'Discord-Bot: Abgleich im Takt fehlgeschlagen',
        );
      }
    },
  };
}
