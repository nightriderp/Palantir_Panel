import { AUTH_METHOD_TYPES } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import { AUTH_METHOD_TYPE_CHECK_VALUES } from './auth.js';

describe('Check-Constraint der Spalte auth_methods.type', () => {
  it('deckt sich mit AUTH_METHOD_TYPES aus @palantir/contracts', () => {
    // Die Liste steht in `schema/auth.ts` bewusst als Literal: Drizzle Kit lädt
    // die Schema-Datei über den CommonJS-Loader und kann das reine ESM-Paket
    // `@palantir/contracts` dort nicht auflösen – ein Wert-Import würde
    // `db:generate` scheitern lassen. Dieser Test hält beide Listen zusammen:
    // ein neuer Typ im Vertrag ohne passende Migration fällt hier auf.
    expect([...AUTH_METHOD_TYPE_CHECK_VALUES]).toEqual([...AUTH_METHOD_TYPES]);
  });
});
