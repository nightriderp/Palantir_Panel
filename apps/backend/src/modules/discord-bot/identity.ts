/**
 * Discord-Id → Palantir-Konto (Pflichtenheft §14a.3).
 *
 * Keine eigene Zuordnungstabelle: Maßgeblich ist die `AuthMethod` vom Typ
 * `discord`, die beim Verknüpfen im Panel entsteht. Wer die Discord-Anmeldung
 * dort trennt, verliert den Zugang über den Bot im selben Moment.
 *
 * Freischaltung und Sperre kommen aus denselben Quellen wie bei jeder
 * Panel-Anfrage – `buildActor()` des Auth-Moduls und `UserRecord.banned`.
 */

import type { AuthRepository, UserRecord } from '../auth/types.js';
import type { PermissionActor } from '../rbac/index.js';
import type { DiscordIdentityResolver } from './interactions.js';

export interface AuthIdentityDeps {
  readonly repository: Pick<AuthRepository, 'findAuthMethodByProvider' | 'findUserById'>;
  readonly buildActor: (user: UserRecord) => Promise<Pick<PermissionActor, 'approved'>>;
}

export function createAuthIdentityResolver(deps: AuthIdentityDeps): DiscordIdentityResolver {
  return {
    async resolve(discordUserId) {
      const method = await deps.repository.findAuthMethodByProvider('discord', discordUserId);

      if (!method) {
        return null;
      }

      const user = await deps.repository.findUserById(method.userId);

      if (!user) {
        return null;
      }

      const actor = await deps.buildActor(user);

      return {
        userId: user.id,
        displayName: user.displayName,
        banned: user.banned,
        approved: actor.approved && !user.banned,
      };
    },
  };
}
