/**
 * Zod-Schemas zu Chat & Moderation (Lastenheft §3.6, Pflichtenheft §15).
 *
 * Gegenstück zu `chat.ts` aus `@palantir/contracts`. Backend und Frontend
 * prüfen gegen dieselben Schemas – es gibt keinen zweiten, abweichenden
 * Regelsatz im Backend (CLAUDE.md §3).
 *
 * **Kein Schema für eine Moderationssuche.** Die Übersicht der Moderation
 * filtert ausschließlich nach dem Bearbeitungsstand einer Meldung. Ein Filter
 * über Absender, Empfänger oder Inhalt stünde dem Datenschutz-Prinzip aus
 * Pflichtenheft §15 entgegen und fehlt hier deshalb bewusst.
 */

import {
  CONVERSATION_TYPES,
  MESSAGE_MAX_LENGTH,
  MESSAGE_MODERATION_ACTIONS,
  MESSAGE_MODERATION_NOTE_MAX_LENGTH,
  MESSAGE_PAGE_DEFAULT_LIMIT,
  MESSAGE_PAGE_MAX_LIMIT,
  MESSAGE_REPORT_REASON_MAX_LENGTH,
  MESSAGE_REPORT_STATUSES,
  type MessageDto,
  type MessagePermissions,
  type MessageReportDto,
  type MessageReportPermissions,
  type ReportedMessageDto,
} from '@palantir/contracts';
import { z } from 'zod';
import { idSchema } from './common.js';

export const conversationTypeSchema = z.enum(CONVERSATION_TYPES);
export const messageReportStatusSchema = z.enum(MESSAGE_REPORT_STATUSES);
export const messageModerationActionSchema = z.enum(MESSAGE_MODERATION_ACTIONS);

/**
 * Inhalt einer Nachricht.
 *
 * Wird beschnitten und darf danach nicht leer sein: Eine Nachricht aus lauter
 * Leerzeichen ist keine Nachricht, würde aber im Verlauf Platz belegen und
 * ließe sich melden.
 */
export const messageContentSchema = z
  .string()
  .trim()
  .min(1, { message: 'Die Nachricht darf nicht leer sein.' })
  .max(MESSAGE_MAX_LENGTH, {
    message: `Eine Nachricht darf höchstens ${String(MESSAGE_MAX_LENGTH)} Zeichen lang sein.`,
  });

/** Begründung einer Meldung – ohne Begründung kann ein Moderator nichts entscheiden. */
export const messageReportReasonSchema = z
  .string()
  .trim()
  .min(1, { message: 'Bitte gib an, warum du diese Nachricht meldest.' })
  .max(MESSAGE_REPORT_REASON_MAX_LENGTH, {
    message: `Die Begründung darf höchstens ${String(MESSAGE_REPORT_REASON_MAX_LENGTH)} Zeichen lang sein.`,
  });

/** Beginnt eine Direktnachricht mit genau einem anderen Konto (Lastenheft §3.6). */
export const createDirectConversationInputSchema = z.object({
  recipientId: idSchema,
});

/** Neue Nachricht in einer bestehenden Konversation. */
export const sendMessageInputSchema = z.object({
  content: messageContentSchema,
});

/** Meldung zu genau einer Nachricht. */
export const reportMessageInputSchema = z.object({
  reason: messageReportReasonSchema,
});

/**
 * Entscheidung eines Moderators zu einer Meldung.
 *
 * `note` ist freiwillig und geht in den Audit-Eintrag ein – die Entscheidung
 * selbst steht als benannte Aktion daneben, nicht als Freitext.
 */
export const resolveMessageReportInputSchema = z.object({
  action: messageModerationActionSchema,
  note: z.string().trim().min(1).max(MESSAGE_MODERATION_NOTE_MAX_LENGTH).nullish(),
});

/**
 * Blättern im Nachrichtenverlauf.
 *
 * `before` ist die `Message.id`, ab der weiter in die Vergangenheit geladen
 * wird – bewusst eine Id und kein Zeitstempel: Zwei Nachrichten können
 * denselben Zeitstempel tragen, eine Id ist eindeutig.
 */
export const messagePageQuerySchema = z.object({
  before: idSchema.optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MESSAGE_PAGE_MAX_LIMIT)
    .default(MESSAGE_PAGE_DEFAULT_LIMIT),
});

/** Filter der Moderationsübersicht. Ohne Angabe werden die offenen Meldungen gezeigt. */
export const messageReportQuerySchema = z.object({
  status: messageReportStatusSchema.default('open'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// ---------------------------------------------------------------------------
// Ausgabe-Schemas (Fundpunkt 141)
// ---------------------------------------------------------------------------
//
// Gegenstück zu den ausgelieferten DTOs, nicht zu einer Eingabe. Die
// Typ-Annotation `z.ZodType<…Dto>` ist der eigentliche Zweck: Ändert sich ein
// Feld im Vertrag, schlägt hier die Übersetzung fehl, statt dass Schema und Typ
// still auseinanderlaufen. Zod-Objekte entfernen unbekannte Schlüssel beim
// Parsen – ein hier vergessenes Feld käme über die Leitung an und wäre danach
// `undefined`, ohne Fehler und ohne Warnung (Audit-Fundstelle
// contracts-validation-01, dort am Konto-DTO aufgefallen).

/** `permissions`-Objekt einer Nachricht – Gegenstück zu `MessagePermissions`. */
export const messagePermissionsSchema: z.ZodType<MessagePermissions> = z.object({
  canDelete: z.boolean(),
  canReport: z.boolean(),
});

/**
 * Eine Nachricht – Gegenstück zu `MessageDto` (Pflichtenheft §5.2).
 *
 * `senderId` ist nullbar: Das Konto des Absenders kann gelöscht sein, die
 * Nachricht bleibt (Fundpunkt 141). `senderDisplayName` ist es **nicht** – dort
 * steht dann `DELETED_ACCOUNT_DISPLAY_NAME`, aber immer eine Zeichenkette.
 *
 * Der Unterschied zwischen `null` und „Feld fehlt" ist Absicht und wird
 * geprüft: `null` heißt „Konto gelöscht", ein fehlendes Feld heißt „das Backend
 * hat es vergessen" – das ist ein Fehler und muss einer bleiben.
 */
export const messageDtoSchema: z.ZodType<MessageDto> = z.object({
  id: idSchema,
  conversationId: idSchema,
  senderId: idSchema.nullable(),
  senderDisplayName: z.string().min(1),
  /** Bei gelöschten Nachrichten leer – deshalb ohne `min(1)`. */
  content: z.string(),
  createdAt: z.string().datetime({ offset: true }),
  deletedAt: z.string().datetime({ offset: true }).nullable(),
  deletedByModerator: z.boolean().nullable(),
  reportedByViewer: z.boolean(),
  permissions: messagePermissionsSchema,
});

/** Die gemeldete Nachricht – Gegenstück zu `ReportedMessageDto`. */
export const reportedMessageDtoSchema: z.ZodType<ReportedMessageDto> = z.object({
  id: idSchema,
  senderId: idSchema.nullable(),
  senderDisplayName: z.string().min(1),
  content: z.string(),
  createdAt: z.string().datetime({ offset: true }),
  deletedAt: z.string().datetime({ offset: true }).nullable(),
});

/** `permissions`-Objekt einer Meldung – Gegenstück zu `MessageReportPermissions`. */
export const messageReportPermissionsSchema: z.ZodType<MessageReportPermissions> = z.object({
  canView: z.boolean(),
  canResolve: z.boolean(),
});

/**
 * Eine Meldung – Gegenstück zu `MessageReportDto`.
 *
 * `reportedById` ist aus demselben Grund nullbar wie `senderId`: Auch das
 * Löschen des Melder-Kontos darf die Meldung und damit die Beweiskopie nicht
 * mitnehmen (Fundpunkt 141).
 */
export const messageReportDtoSchema: z.ZodType<MessageReportDto> = z.object({
  id: idSchema,
  messageId: idSchema,
  conversationId: idSchema,
  conversationType: conversationTypeSchema,
  serverId: idSchema.nullable(),
  reportedById: idSchema.nullable(),
  reportedByDisplayName: z.string().min(1),
  reason: z.string().min(1),
  status: messageReportStatusSchema,
  actionTaken: messageModerationActionSchema.nullable(),
  moderatorNote: z.string().nullable(),
  resolvedById: idSchema.nullable(),
  resolvedByDisplayName: z.string().nullable(),
  resolvedAt: z.string().datetime({ offset: true }).nullable(),
  createdAt: z.string().datetime({ offset: true }),
  message: reportedMessageDtoSchema,
  permissions: messageReportPermissionsSchema,
});

export type CreateDirectConversationInput = z.infer<typeof createDirectConversationInputSchema>;
export type SendMessageInput = z.infer<typeof sendMessageInputSchema>;
export type ReportMessageInput = z.infer<typeof reportMessageInputSchema>;
export type ResolveMessageReportInput = z.infer<typeof resolveMessageReportInputSchema>;
export type MessagePageQuery = z.infer<typeof messagePageQuerySchema>;
export type MessageReportQuery = z.infer<typeof messageReportQuerySchema>;
