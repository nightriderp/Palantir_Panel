/**
 * @palantir/contracts
 *
 * Vertragsgrenze zwischen Backend, Frontend und Agent (Pflichtenheft §4, CLAUDE.md §3).
 *
 * Dieses Package ist im Grundgerüst bewusst leer. Inhalte (Response-Envelope,
 * DTOs inkl. `permissions`-Objekt, Fehlercode-Katalog, WebSocket-Event-Namen,
 * Agent-Protokoll-Befehle) kommen ausschließlich über eigene, kleine PRs –
 * niemals nebenbei in einem Feature-PR (CLAUDE.md §6).
 *
 * Änderungen sind bevorzugt additiv (neue optionale Felder). Breaking Changes
 * an bestehenden Feldern werden im Commit und PR explizit gekennzeichnet.
 */

export {};
