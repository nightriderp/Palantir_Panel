/**
 * Agent-Token je Node (WORK_STATUS.md, Gefundener Punkt 57).
 *
 * Bis hierher meldeten sich alle Agents mit demselben `AGENT_TOKEN` aus der
 * zentralen `.env`. Eine eingehende Verbindung ließ sich deshalb keiner
 * bestimmten Node zuordnen – das Backend nahm die einzige, die es kannte
 * (`defaultHost()`). Mit einem Token je Node ist die Zuordnung eindeutig, und
 * ein kompromittierter Agent betrifft nur seine eigene Node.
 *
 * **Gespeichert wird nur der SHA-256-Hash.** Ein Datenbank-Auszug soll keine
 * gültigen Agent-Zugänge enthalten. Ohne Salt und ohne Schlüsselstreckung ist
 * das hier richtig: Anders als ein Passwort ist das Token 256 Bit aus
 * `randomBytes()` – es gibt nichts zu erraten, und der Vergleich läuft bei
 * jedem Verbindungsaufbau. Argon2id aus Pflichtenheft §7 gilt für Passwörter,
 * nicht für Zufallstoken (dieselbe Unterscheidung wie bei den Sitzungstoken in
 * B1).
 *
 * Das Token wird **einmal** im Klartext ausgegeben, wenn es erzeugt wird. Es
 * lässt sich danach nicht wieder anzeigen, nur ersetzen.
 */

import { createHash, randomBytes } from 'node:crypto';

/**
 * Länge des Zufallsanteils in Bytes.
 *
 * 32 Bytes = 256 Bit, als Base64URL 43 Zeichen. Damit ist Raten
 * aussichtslos, und das Token bleibt kurz genug für eine `.env`-Zeile.
 */
const TOKEN_BYTES = 32;

/**
 * Kennzeichen am Anfang jedes Tokens.
 *
 * Rein zur Wiedererkennung: Wer den Wert in einer Konfigurationsdatei oder
 * einem Log findet, sieht sofort, worum es sich handelt – und Werkzeuge zur
 * Geheimnis-Erkennung greifen darauf zu.
 */
export const AGENT_TOKEN_PREFIX = 'palantir-agent_';

/** Neues Agent-Token im Klartext. Wird nur einmal ausgegeben. */
export function generateAgentToken(): string {
  return `${AGENT_TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString('base64url')}`;
}

/**
 * Hash eines Agent-Tokens, wie er in `host_nodes.agent_token_hash` steht.
 *
 * Dieselbe Funktion wird beim Vergeben (B8) und beim Verbindungsaufbau (B3)
 * benutzt – ein zweiter Hash-Aufruf an anderer Stelle wäre die Gelegenheit,
 * dass beide Seiten auseinanderlaufen.
 */
export function hashAgentToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
