/**
 * Öffentliche Kennzahlen der Instanz (Mockup-Abgleich 2.1).
 *
 * Die Anmeldeseite zeigt am Fuß der Markenspalte drei Zahlen: verfügbare
 * Spiele, Tage im Dienst und gespielte Arcade-Partien. Sie stehen **vor** der
 * Anmeldung, brauchen also eine Route ohne Sitzung – die einzige neben der
 * ALTCHA-Challenge und dem Health-Check.
 *
 * **Was hier bewusst nicht steht:** keine Namen, keine Serverzahl, keine
 * Nutzerzahl. Wer vor der Anmeldung steht, soll sehen, dass die Instanz lebt –
 * nicht, wie viele Konten es gibt oder wie sie heißen. Die drei Zahlen sind
 * Kennzahlen des Betriebs, keine Angaben über Personen.
 *
 * „Tage im Dienst" zählt ab dem ersten angelegten Konto: Das ist der Zeitpunkt,
 * an dem die Instanz in Betrieb ging. Ohne Konto gibt es keinen Bezugspunkt,
 * dann steht dort `null` statt einer erfundenen Null.
 */

import { type PublicInstanceStatsDto } from '@palantir/contracts';
import { count, min } from 'drizzle-orm';
import { type DbConnection } from '../../db/client.js';
import { arcadeScores, users } from '../../db/schema.js';

export interface PublicStatsDependencies {
  readonly db: DbConnection;
  /** Zahl der Spiel-Definitionen – kommt aus der Registry in B3. */
  readonly gameTypeCount: () => number;
  /** Nur für Tests: fester „Jetzt"-Zeitpunkt. */
  readonly now?: () => Date;
}

export interface PublicStatsService {
  load(): Promise<PublicInstanceStatsDto>;
}

/** Volle Tage zwischen zwei Zeitpunkten; nie negativ. */
export function daysBetween(from: Date, to: Date): number {
  const millisekunden = to.getTime() - from.getTime();

  return millisekunden <= 0 ? 0 : Math.floor(millisekunden / 86_400_000);
}

export function createPublicStatsService(deps: PublicStatsDependencies): PublicStatsService {
  const jetzt = deps.now ?? ((): Date => new Date());

  return {
    async load() {
      const [erstesKonto] = await deps.db
        .select({ ersteAnmeldung: min(users.createdAt) })
        .from(users);
      const [partien] = await deps.db.select({ anzahl: count() }).from(arcadeScores);

      const start = erstesKonto?.ersteAnmeldung ?? null;

      return {
        gameTypes: deps.gameTypeCount(),
        daysInService: start === null ? null : daysBetween(new Date(start), jetzt()),
        arcadeRounds: partien?.anzahl ?? 0,
      };
    },
  };
}
