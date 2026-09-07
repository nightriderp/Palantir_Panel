/**
 * Die Auth-Attrappe gegen den gemeinsamen Vertrag (Audit W3-12, `test-gaps-07`).
 *
 * Dieselben Zusicherungen laufen in `repository.db.test.ts` gegen das echte
 * Drizzle-Repository. Läuft hier also etwas grün, das dort rot ist (oder
 * umgekehrt), sind Attrappe und Produktion auseinandergelaufen – und die
 * Dienst-Tests, die auf der Attrappe stehen, beweisen weniger, als sie
 * behaupten.
 *
 * Diese Datei braucht **keine** Datenbank und läuft in jedem `pnpm test`.
 */

import { describe } from 'vitest';
import { describeAuthRepositoryContract } from './repository-contract.js';
import { createFakeAuthRepository } from './test-doubles.js';

describe('AuthRepository-Vertrag: Attrappe aus test-doubles.ts', () => {
  describeAuthRepositoryContract(() => createFakeAuthRepository());
});
