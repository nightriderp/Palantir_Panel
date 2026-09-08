/**
 * Warnung vor dem Anlegen einer weiteren Node, solange eine bestehende noch am
 * gemeinsamen `AGENT_TOKEN` hängt (Fundpunkt 160).
 *
 * Seit dem Node-Token (Fundpunkt 149, `agent-route.ts`) gilt: Sobald **zwei**
 * Nodes eingetragen sind, lehnt das Backend das gemeinsame `AGENT_TOKEN` aus
 * der zentralen `.env` der VPS beim Verbindungsaufbau mit Close-Code 4401 ab –
 * es sagt ja nicht, *welcher* Homeserver sich meldet. Das ist gewollt, hat für
 * den Betreiber aber eine Folge, die er sonst erst nachträglich bemerkt: Die
 * bestehende Node fällt heraus, und zwar nicht beim Anlegen der zweiten,
 * sondern erst beim nächsten Verbindungsaufbau ihres Agents. Bis dahin ist der
 * Zusammenhang längst aus dem Blick.
 *
 * Der Weg heraus stand bisher nur im Backend-Log und in `.env.example`. Hier
 * steht er an der Stelle, an der der Betreiber es auslöst – im Wizard, vor dem
 * Absenden.
 *
 * Bewusst rein und ohne React, damit der Wortlaut ohne gerendertes Bauteil
 * prüfbar ist (CLAUDE.md §4) – dieselbe Aufteilung wie bei `nodeSetupGuide.ts`.
 *
 * Kein Contract-Feld nötig: `HostNodeDto.hasAgentToken` sagt bereits, ob eine
 * Node ein eigenes Token hat (Gefundene Punkte 57 und 110).
 */

import { type HostNodeDto } from '@palantir/contracts';

export interface SharedAgentTokenWarning {
  /** Namen der Nodes ohne eigenes Agent-Token, in der Reihenfolge der Liste. */
  readonly affectedNames: readonly string[];
  /** Erste, hervorgehobene Zeile: worum es geht. */
  readonly headline: string;
  /** Fließtext, ein Absatz je Eintrag: Folge, Abhilfe, Abwägung. */
  readonly paragraphs: readonly string[];
  /** Beschriftung des Bestätigungsschalters. */
  readonly acknowledgeTitle: string;
  /** Was der Betreiber mit dem Schalter bestätigt. */
  readonly acknowledgeDescription: string;
}

/** Deutsche Aufzählung in Anführungszeichen: „A“, „B“ und „C“. */
function nameListe(namen: readonly string[]): string {
  const zitiert = namen.map((name) => `„${name}“`);
  const letzter = zitiert.at(-1) ?? '';

  if (zitiert.length <= 1) {
    return letzter;
  }

  return `${zitiert.slice(0, -1).join(', ')} und ${letzter}`;
}

/**
 * Warnung für den Wizard – oder `null`, wenn es nichts zu warnen gibt.
 *
 * Fällig ist sie nur, wenn **beides** zutrifft: Es besteht mindestens eine
 * Node, **und** mindestens eine davon hat kein eigenes Agent-Token. Haben alle
 * bestehenden Nodes ein eigenes Token, ändert eine weitere für sie nichts – ihr
 * Token benennt seine Node selbst und bleibt in jeder Größe der Installation
 * gültig. Ohne bestehende Node erst recht nicht: Mit genau einer Node bleibt das
 * gemeinsame Token der vorgesehene Rückfallweg.
 *
 * `hasAgentToken` ist im Vertrag optional; ein fehlender Wert ist wie `false` zu
 * lesen (siehe `packages/contracts/src/host-node.ts`) – deshalb `!== true`.
 */
export function buildSharedAgentTokenWarning(
  existingNodes: readonly HostNodeDto[],
): SharedAgentTokenWarning | null {
  const ohneToken = existingNodes.filter((node) => node.hasAgentToken !== true);

  if (ohneToken.length === 0) {
    return null;
  }

  const namen = ohneToken.map((node) => node.name);
  const liste = nameListe(namen);
  const mehrere = ohneToken.length > 1;

  /*
   * Ab zwei bestehenden Nodes ist das gemeinsame Token bereits abgelehnt – die
   * betroffene Node kommt schon jetzt nicht mehr herein. Dann wäre „verliert
   * beim nächsten Verbindungsaufbau ihren Zugang" falsch: Verloren ist er
   * längst. Die Warnung beschreibt genau das, was der Code tut.
   */
  const bereitsAbgelehnt = existingNodes.length > 1;

  const regel =
    'Ab zwei eingetragenen Nodes lehnt das Backend das gemeinsame AGENT_TOKEN aus der zentralen .env der VPS ab (Close-Code 4401): Es sagt nicht, welcher Homeserver sich meldet.';

  const folge = bereitsAbgelehnt
    ? `${regel} Es sind bereits ${existingNodes.length} Nodes eingetragen – ${liste} ${mehrere ? 'kommen' : 'kommt'} damit schon jetzt nicht mehr herein. Eine weitere Node ändert daran nichts; der Weg heraus ist derselbe.`
    : `${regel} Legst du diese Node jetzt an, ${mehrere ? 'verlieren' : 'verliert'} ${liste} beim nächsten Verbindungsaufbau den Zugang – nicht sofort, sondern sobald der Agent sich neu meldet.`;

  const abhilfe = mehrere
    ? `Besser zuerst: in der Node-Liste bei ${liste} je auf „Agent-Token“ klicken, jedes Token auf dem Homeserver der jeweiligen Node in /opt/palantir/.env als AGENT_TOKEN eintragen und den Agent-Stack dort neu starten. Der Klartext eines Tokens erscheint genau einmal. Erst danach diese Node hier anlegen.`
    : `Besser zuerst: in der Node-Liste bei ${liste} auf „Agent-Token“ klicken, das Token auf dem Homeserver dieser Node in /opt/palantir/.env als AGENT_TOKEN eintragen und den Agent-Stack dort neu starten. Der Klartext des Tokens erscheint genau einmal. Erst danach diese Node hier anlegen.`;

  const abwaegung =
    'Wer die Reihenfolge bewusst dreht – etwa weil die bestehende Node ohnehin abgebaut wird –, holt das danach nach: Bis dahin bleibt sie offline, verloren geht dabei nichts.';

  return {
    affectedNames: namen,
    headline: `${liste} ${mehrere ? 'hängen' : 'hängt'} noch am gemeinsamen AGENT_TOKEN.`,
    paragraphs: [folge, abhilfe, abwaegung],
    acknowledgeTitle: 'Verstanden – trotzdem anlegen',
    acknowledgeDescription: mehrere
      ? `${liste} bleiben ohne Zugang, bis sie ihr eigenes Agent-Token haben.`
      : `${liste} bleibt ohne Zugang, bis diese Node ihr eigenes Agent-Token hat.`,
  };
}
