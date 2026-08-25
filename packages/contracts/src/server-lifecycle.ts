/**
 * Server-Lifecycle (Pflichtenheft §9).
 *
 * Zustandsfolge: `creating → stopped → starting → running → stopping → stopped`,
 * zusätzlich `error` und `crashed`.
 *
 * Die Zustände sind bewusst kleingeschrieben, weil sie so auch in der Datenbank
 * und im Agent-Protokoll geführt werden. Die deutschen Anzeigetexte gehören ins
 * Frontend (F2), nicht in die Contracts – hier steht nur der Vertrag.
 */
export const SERVER_STATUSES = [
  'creating',
  'stopped',
  'starting',
  'running',
  'stopping',
  'error',
  'crashed',
] as const;

export type ServerStatus = (typeof SERVER_STATUSES)[number];

/** Zustände, in denen gerade ein Übergang läuft (Lifecycle-Zwischenzustände). */
export const TRANSITIONAL_SERVER_STATUSES = ['creating', 'starting', 'stopping'] as const;

export type TransitionalServerStatus = (typeof TRANSITIONAL_SERVER_STATUSES)[number];

/** Zustände, die auf eine Störung hinweisen (Pflichtenheft §9). */
export const FAULTED_SERVER_STATUSES = ['error', 'crashed'] as const;

export type FaultedServerStatus = (typeof FAULTED_SERVER_STATUSES)[number];
