import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as schemas from './index.js';

/**
 * Eingabe-Schemas weisen unbekannte Felder ab (Arbeitspaket HM-6).
 *
 * Zod entfernt unbekannte Felder ohne `.strict()` stillschweigend. Für eine
 * Eingabe ist das die falsche Freundlichkeit: Ein Tippfehler im Frontend
 * (`maxPlayer` statt `maxPlayers`) kommt als gültige Anfrage an, das Backend
 * antwortet mit Erfolg, und der Wert fehlt einfach. Die Begründung steht
 * ausführlich an `updateHostNodeInputSchema` – dort stand vor HM-6 als einzigem
 * Schema ein `.strict()`.
 *
 * Dieser Test prüft nicht Schema für Schema von Hand, sondern nimmt sich alle
 * exportierten Eingabe-Schemas vor. Damit kann ihn niemand vergessen: Ein neues
 * `…InputSchema` ohne `.strict()` lässt ihn rot werden, sobald es exportiert
 * wird.
 *
 * **Antworten bleiben absichtlich nachsichtig.** DTO- und Ergebnis-Schemas
 * prüfen, was HEREINKOMMT – von einem Backend, das neuer sein kann als der
 * Leser. Contracts wachsen additiv (Entwicklungsregeln §3); ein striktes Antwort-Schema
 * machte aus jedem neuen optionalen Feld einen Fehler beim älteren Gegenüber.
 * Dasselbe gilt für die Nutzlasten und Ergebnisse des Agent-Protokolls: Nach
 * einem Deployment läuft der Agent auf der Gamenode noch bis zu fünf Minuten in
 * der alten Fassung weiter.
 */

/** Feld, das in keinem Schema vorkommt. */
const UNBEKANNT = '__feldDasEsNichtGibt';

/**
 * Bewusst nicht strikt, obwohl der Name passt.
 *
 * `apiErrorBodySchema` beschreibt den Fehlerteil einer **Antwort** (Envelope,
 * Pflichtenheft §5.1) und wird auf dem Rückweg gelesen – siehe der Absatz zu
 * den Antworten oben.
 */
const AUSNAHMEN = new Set(['apiErrorBodySchema']);

function istObjektSchema(schema: z.ZodTypeAny): boolean {
  if (schema instanceof z.ZodObject) return true;
  // `.refine()` und `.transform()` verpacken das Objekt in ein ZodEffects.
  if (schema instanceof z.ZodEffects) return istObjektSchema(schema.innerType() as z.ZodTypeAny);

  return false;
}

/**
 * Alle exportierten Eingabe-Schemas.
 *
 * Der Name entscheidet über die Absicht (`…InputSchema`, `…QuerySchema`,
 * `…BodySchema`), die Bauart darüber, ob die Frage überhaupt sinnvoll ist:
 * `announcementBodySchema` etwa ist eine Zeichenkette und kein Rumpf – bei ihr
 * gibt es keine unbekannten Felder.
 */
function eingabeSchemas(): [string, z.ZodTypeAny][] {
  return Object.entries(schemas as Record<string, unknown>)
    .filter(([name]) => /(?:Input|Query|Body)Schema$/.test(name) && !AUSNAHMEN.has(name))
    .filter((eintrag): eintrag is [string, z.ZodTypeAny] => eintrag[1] instanceof z.ZodType)
    .filter(([, schema]) => istObjektSchema(schema))
    .sort(([a], [b]) => a.localeCompare(b));
}

describe('Eingabe-Schemas weisen unbekannte Felder ab (HM-6)', () => {
  it('findet die Eingabe-Schemas des Pakets', () => {
    // Reine Absicherung gegen einen stillen Fehlschlag: Griffe die Auswahl
    // daneben, liefe die Prüfung darunter über eine leere Liste und wäre grün,
    // ohne irgendetwas geprüft zu haben.
    expect(eingabeSchemas().length).toBeGreaterThanOrEqual(40);
  });

  it.each(eingabeSchemas())('%s lehnt ein unbekanntes Feld ab', (_name, schema) => {
    const ergebnis = schema.safeParse({ [UNBEKANNT]: 'irgendwas' });

    expect(ergebnis.success).toBe(false);

    // Auf den Grund kommt es an: Ein Schema ohne `.strict()` scheitert an dieser
    // Eingabe ebenfalls – aber wegen der fehlenden Pflichtfelder, und das
    // unbekannte Feld hätte es klaglos geschluckt.
    const gruende = ergebnis.success ? [] : ergebnis.error.issues;

    expect(
      gruende.some((grund) => grund.code === 'unrecognized_keys' && grund.keys.includes(UNBEKANNT)),
    ).toBe(true);
  });
});
