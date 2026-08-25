/**
 * @palantir/validation
 *
 * Zod-Schemas, die Backend (Request-Validierung) und Frontend (Formular-/
 * Typprüfung) gemeinsam nutzen – Pflichtenheft §3 und §4.
 *
 * Enthalten ist bisher nur die paket-übergreifende Basis: ID-Format und das
 * Schema zum Response-Envelope. Fachliche Schemas werden zusammen mit den
 * zugehörigen Typen aus `@palantir/contracts` über eigene, kleine PRs ergänzt
 * (CLAUDE.md §3 und §6).
 */

export { type Id, idSchema } from './common.js';
export { apiErrorBodySchema, apiResponseSchema, errorCodeSchema } from './envelope.js';
