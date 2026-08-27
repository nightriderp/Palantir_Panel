/**
 * Zod-Schemas der Notification-Engine (Lastenheft §3.6, Pflichtenheft §14).
 *
 * Gegenstück zu `NotificationChannelDto`, `NotificationRuleDto`,
 * `NotificationDto` und `AnnouncementDto` aus `@palantir/contracts`. Backend
 * (Request-Validierung) und Frontend (Inbox und Einstellungen in F6,
 * Regelverwaltung in F10) nutzen dieselben Schemas – kein zweiter, abweichender
 * Regelsatz.
 */

import {
  NOTIFIABLE_EVENTS,
  NOTIFICATION_CHANNEL_TYPES,
  NOTIFICATION_RECIPIENT_SCOPES,
  NOTIFICATION_SEVERITIES,
  NOTIFICATION_SUBJECT_TYPES,
} from '@palantir/contracts';
import { z } from 'zod';
import { idSchema } from './common.js';

export const notifiableEventSchema = z.enum(NOTIFIABLE_EVENTS);
export const notificationChannelTypeSchema = z.enum(NOTIFICATION_CHANNEL_TYPES);
export const notificationRecipientScopeSchema = z.enum(NOTIFICATION_RECIPIENT_SCOPES);
export const notificationSeveritySchema = z.enum(NOTIFICATION_SEVERITIES);
export const notificationSubjectTypeSchema = z.enum(NOTIFICATION_SUBJECT_TYPES);

/** Anzeigename eines Kanals – trägt die Auswahl im Regel-Editor. */
export const notificationChannelNameSchema = z
  .string()
  .trim()
  .min(1, { message: 'Der Name darf nicht leer sein.' })
  .max(80, { message: 'Der Name darf höchstens 80 Zeichen lang sein.' });

/**
 * Discord-Webhook-URL.
 *
 * Bewusst eng geprüft statt als beliebige URL: Eine falsch eingetragene Adresse
 * würde sonst erst beim ersten Ereignis auffallen – also genau dann, wenn die
 * Meldung gebraucht wird. `discord.com` und `discordapp.com` sind beide gültig,
 * ältere Webhooks tragen noch die zweite Form.
 */
export const discordWebhookUrlSchema = z
  .string()
  .trim()
  .url({ message: 'Die Webhook-Adresse ist keine gültige URL.' })
  .regex(/^https:\/\/(?:[a-z0-9-]+\.)*discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/, {
    message: 'Erwartet wird eine Discord-Webhook-URL (https://discord.com/api/webhooks/…).',
  });

/**
 * Zielangaben eines Kanals beim Anlegen oder Ändern.
 *
 * `webhookUrl` ist optional: Ohne Angabe nutzt der Kanal `DISCORD_WEBHOOK_URL`
 * aus der zentralen `.env` (Pflichtenheft §12.1). So kommt der Standardkanal
 * einer Instanz ohne ein Geheimnis in der Datenbank aus.
 */
export const discordWebhookTargetInputSchema = z.object({
  webhookUrl: discordWebhookUrlSchema.optional(),
  username: z
    .string()
    .trim()
    .min(1)
    .max(80, { message: 'Der Absendername darf höchstens 80 Zeichen lang sein.' })
    .optional(),
});

/** Eingabe zum Anlegen eines Kanals (F10 → Backend). */
export const createNotificationChannelInputSchema = z.object({
  name: notificationChannelNameSchema,
  type: notificationChannelTypeSchema.default('discordWebhook'),
  target: discordWebhookTargetInputSchema.default({}),
  enabled: z.boolean().default(true),
});

/**
 * Eingabe zum Ändern eines Kanals (F10 → Backend).
 *
 * Alle Felder optional; ein weggelassenes Feld bleibt unverändert. `target`
 * wird als Ganzes ersetzt, wenn es mitkommt – eine teilweise Übernahme einzelner
 * Zielangaben wäre nicht mehr eindeutig, sobald ein Feld absichtlich geleert
 * werden soll.
 */
export const updateNotificationChannelInputSchema = z
  .object({
    name: notificationChannelNameSchema.optional(),
    target: discordWebhookTargetInputSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Es wurde kein zu änderndes Feld angegeben.',
  });

/**
 * Regel beim Anlegen (F10 → Backend).
 *
 * `channelId: null` bedeutet „nur Inbox" (siehe `NotificationRuleDto`). Die
 * Kombination aus `recipientScope: 'role'` und fehlender `recipientRoleId` wird
 * hier abgelehnt: Eine Regel ohne Rolle träfe niemanden und wäre stiller
 * Ausfall statt sichtbarer Fehler.
 */
export const createNotificationRuleInputSchema = z
  .object({
    event: notifiableEventSchema,
    channelId: idSchema.nullable().default(null),
    recipientScope: notificationRecipientScopeSchema,
    recipientRoleId: idSchema.nullable().default(null),
    inboxEnabled: z.boolean().default(true),
    /** `null` = die Dringlichkeit des Ereignisses übernehmen (Standard). */
    severity: notificationSeveritySchema.nullable().default(null),
    enabled: z.boolean().default(true),
  })
  .refine((value) => value.recipientScope !== 'role' || value.recipientRoleId !== null, {
    message: 'Für den Empfängerkreis „Rolle" muss eine Rolle gewählt werden.',
    path: ['recipientRoleId'],
  })
  .refine((value) => value.recipientScope === 'role' || value.recipientRoleId === null, {
    message: 'Eine Rolle ist nur beim Empfängerkreis „Rolle" zulässig.',
    path: ['recipientRoleId'],
  })
  .refine((value) => value.inboxEnabled || value.channelId !== null, {
    message: 'Eine Regel ohne Inbox und ohne Kanal würde niemanden erreichen.',
    path: ['inboxEnabled'],
  });

/** Eingabe zum Ändern einer Regel (F10 → Backend). Ereignis und Regel-Id bleiben fest. */
export const updateNotificationRuleInputSchema = z
  .object({
    channelId: idSchema.nullable().optional(),
    recipientScope: notificationRecipientScopeSchema.optional(),
    recipientRoleId: idSchema.nullable().optional(),
    inboxEnabled: z.boolean().optional(),
    severity: notificationSeveritySchema.nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Es wurde kein zu änderndes Feld angegeben.',
  });

/**
 * Filter der Inbox (F6 → Backend).
 *
 * `unreadOnly` trägt den Zähler in der Navigation, `event` die Filterleiste.
 * Die Obergrenze von 100 hält eine einzelne Antwort klein – die Inbox wächst
 * dauerhaft und wird nie vollständig geliefert.
 */
export const notificationQuerySchema = z.object({
  unreadOnly: z.coerce.boolean().default(false),
  event: notifiableEventSchema.optional(),
  severity: notificationSeveritySchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * Mehrere Meldungen auf einmal als gelesen markieren (F6 → Backend).
 *
 * Ohne `ids` gilt der Vorgang für **alle** ungelesenen Meldungen des Kontos –
 * das ist der „Alle als gelesen markieren"-Knopf.
 */
export const markNotificationsReadInputSchema = z.object({
  ids: z.array(idSchema).max(200).optional(),
  read: z.boolean().default(true),
});

/** Titel einer systemweiten Ankündigung (Lastenheft §3.6). */
export const announcementTitleSchema = z
  .string()
  .trim()
  .min(1, { message: 'Der Titel darf nicht leer sein.' })
  .max(120, { message: 'Der Titel darf höchstens 120 Zeichen lang sein.' });

/**
 * Text einer Ankündigung.
 *
 * Die Obergrenze richtet sich nach dem engsten Weg nach außen: Eine
 * Discord-Nachricht fasst 2000 Zeichen, und eine Ankündigung, die im Panel
 * vollständig steht und in Discord abgeschnitten ankommt, wäre irreführend.
 */
export const announcementBodySchema = z
  .string()
  .trim()
  .min(1, { message: 'Der Text darf nicht leer sein.' })
  .max(1800, { message: 'Der Text darf höchstens 1800 Zeichen lang sein.' });

/** Eingabe zum Veröffentlichen einer systemweiten Ankündigung (F10 → Backend). */
export const createAnnouncementInputSchema = z.object({
  title: announcementTitleSchema,
  body: announcementBodySchema,
  severity: notificationSeveritySchema.default('info'),
  /** Ende der Banner-Anzeige (ISO-8601); ohne Angabe läuft die Ankündigung nicht ab. */
  expiresAt: z.string().datetime({ offset: true }).nullable().default(null),
});

/** Eingabe zum Ändern einer bereits veröffentlichten Ankündigung. */
export const updateAnnouncementInputSchema = z
  .object({
    title: announcementTitleSchema.optional(),
    body: announcementBodySchema.optional(),
    severity: notificationSeveritySchema.optional(),
    expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Es wurde kein zu änderndes Feld angegeben.',
  });

/**
 * Frames, die der Browser auf dem Live-Kanal der Inbox schickt
 * (Pflichtenheft §5.3, `NotificationClientFrame` in `@palantir/contracts`).
 *
 * Der Empfänger steckt bewusst **nicht** im Frame, sondern in der Sitzung – ein
 * Client kann damit nicht die Inbox eines fremden Kontos abonnieren.
 */
export const notificationClientFrameSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('subscribe') }),
  z.object({ kind: z.literal('unsubscribe') }),
  z.object({ kind: z.literal('ping') }),
]);

export type CreateNotificationChannelInput = z.infer<typeof createNotificationChannelInputSchema>;
export type UpdateNotificationChannelInput = z.infer<typeof updateNotificationChannelInputSchema>;
export type CreateNotificationRuleInput = z.infer<typeof createNotificationRuleInputSchema>;
export type UpdateNotificationRuleInput = z.infer<typeof updateNotificationRuleInputSchema>;
export type NotificationQuery = z.infer<typeof notificationQuerySchema>;
export type MarkNotificationsReadInput = z.infer<typeof markNotificationsReadInputSchema>;
export type CreateAnnouncementInput = z.infer<typeof createAnnouncementInputSchema>;
export type UpdateAnnouncementInput = z.infer<typeof updateAnnouncementInputSchema>;
export type NotificationClientFrameInput = z.infer<typeof notificationClientFrameSchema>;
