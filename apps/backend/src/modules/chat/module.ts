/**
 * Zusammenbau des Chat-Moduls für den Betrieb (B7).
 *
 * Hier werden die Drizzle-Repositories mit den Diensten verdrahtet. Die Dienste
 * selbst kennen keine Datenbank – deshalb laufen alle Sichtbarkeits- und
 * Moderationsregeln in Tests mit Attrappen (CLAUDE.md §4), und deshalb steht
 * diese Verdrahtung an genau einer Stelle.
 *
 * Der Audit-Dienst kommt aus B8 und wird nicht nachgebaut: Jede
 * Moderationsentscheidung landet über `AuditService.record()` im append-only
 * Log (Pflichtenheft §15).
 */

import type { Database } from '../../db/index.js';
import type { AuditService } from '../admin/index.js';
import { ChatLiveHub } from './live.js';
import {
  type ChatEventPublisher,
  type ModerationService,
  createModerationService,
} from './moderation.js';
import {
  createDrizzleChatRepository,
  createDrizzleChatUserDirectory,
  createDrizzleServerMembershipSource,
} from './repositories.js';
import { type ChatService, createChatService } from './service.js';
import type { Clock } from './types.js';

export interface ChatModuleOptions {
  readonly db: Database;
  /** Audit-Log aus B8 – Ziel jeder Moderationsentscheidung. */
  readonly audit: AuditService;
  /** Anschluss an B6: Ereignis `message.reported`. Ohne Angabe wirkungslos. */
  readonly events?: ChatEventPublisher;
  /** Nur für Tests: feste Zeit. */
  readonly clock?: Clock;
}

export interface ChatModule {
  readonly chat: ChatService;
  readonly moderation: ModerationService;
  /** Verteiler der Live-Zustellung; die Route meldet Verbindungen hier an. */
  readonly live: ChatLiveHub;
}

export function createChatModule(options: ChatModuleOptions): ChatModule {
  const repository = createDrizzleChatRepository(options.db);
  const users = createDrizzleChatUserDirectory(options.db);
  const servers = createDrizzleServerMembershipSource(options.db);
  const live = new ChatLiveHub();

  const chat = createChatService({
    repository,
    users,
    servers,
    delivery: live,
    ...(options.clock ? { clock: options.clock } : {}),
  });

  const moderation = createModerationService({
    repository,
    chat,
    users,
    audit: options.audit,
    delivery: live,
    ...(options.events ? { events: options.events } : {}),
    ...(options.clock ? { clock: options.clock } : {}),
  });

  return { chat, moderation, live };
}
