/**
 * Adressbasiertes Proxy-Vertrauen (Audit W2-6; backend-core-10, security-matrix-10).
 *
 * `request.ip` bestimmt den Schlüssel des Brute-Force-Schutzes von Anmeldung,
 * Registrierung und 2FA (Pflichtenheft §7) und landet im Audit-Log. Wer die
 * Adresse setzen kann, umgeht das Rate-Limit durch Rotation des Headers.
 *
 * Bis zum Audit vertraute das Backend einer festen **Hop-Zahl**
 * (`TRUSTED_PROXY_HOPS`): vertrauenswürdig war, wer als erster Sprung ankam –
 * wer immer das war. Der Backend-Port hängt aber zusätzlich an der
 * WireGuard-Adresse der VPS (`deploy/vps/docker-compose.yml`), also kann jeder
 * Tunnel-Teilnehmer (Homeserver, weitere Node) die API direkt ansprechen und
 * wurde so zum vertrauten Hop 0 – sein selbstgesetzter `X-Forwarded-For`
 * bestimmte `request.ip`.
 *
 * Vertraut wird deshalb der **Adresse**: Fastify (über `proxy-addr`) fragt für
 * jeden Eintrag der Kette – von rechts, also vom Server aus – ob er ein
 * bekannter Proxy ist, und nimmt die erste Adresse, die es nicht ist. Steht in
 * der Liste nur das Docker-Netz, kann ein WireGuard-Peer oder ein
 * Nachbar-Container die Adresse nicht mehr fälschen.
 *
 * Reine Funktionen, damit die Ableitung ohne laufenden Server prüfbar ist
 * (CLAUDE.md §4).
 */

import {
  type SourceAllowlist,
  isSourceAllowed,
} from '../modules/server-orchestration/source-allowlist.js';

/**
 * Ist `adresse` ein bekannter Reverse-Proxy?
 *
 * Bewusst **nicht** `isSourceAllowed` direkt: Dort bedeutet die leere Liste
 * „keine Prüfung" (jede Quelle erlaubt), hier muss sie „niemandem vertrauen"
 * bedeuten. Eine leere Vertrauensliste, die jeden Header übernimmt, wäre die
 * gefährlichste aller Vorgaben.
 */
export function isTrustedProxy(liste: SourceAllowlist, adresse: string | undefined): boolean {
  if (liste.length === 0) {
    return false;
  }

  return isSourceAllowed(liste, adresse);
}

/**
 * Baut die `trustProxy`-Funktion für Fastify.
 *
 * Die Hop-Nummer wird bewusst ignoriert: Maßgeblich ist allein, ob die Adresse
 * zur eigenen Proxy-Kette gehört.
 */
export function createTrustProxy(liste: SourceAllowlist): (adresse: string) => boolean {
  return (adresse: string): boolean => isTrustedProxy(liste, adresse);
}
