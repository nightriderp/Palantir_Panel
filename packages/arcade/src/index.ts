/**
 * @palantir/arcade – Spielregeln der Spielhalle.
 *
 * Reine Logik ohne DOM und ohne Uhr: dieselben Dateien laufen im Browser (Spielen)
 * und im Backend (Nachrechnen der Bestenliste, Online-Räume). Vorbild ist das
 * Schwesterprojekt, das seine Regeln ebenso im gemeinsamen Paket führt.
 */

export * from './rng.js';
export * from './realtime.js';
export * from './turn.js';
export * from './games/index.js';
