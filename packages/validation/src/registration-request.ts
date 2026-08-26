/**
 * Zod-Schemas zur Freischalt-Warteliste (Lastenheft §3.1 und §3.7).
 *
 * Gegenstück zu `RegistrationRequestDto` aus `@palantir/contracts`. Die
 * Registrierung selbst gehört zu B1; hier stehen nur die Filter der
 * Admin-Übersicht und die beiden Aktionen „freigeben" und „sperren".
 */

import { REGISTRATION_REQUEST_STATUSES } from '@palantir/contracts';
import { z } from 'zod';
import { idSchema } from './common.js';

export const registrationRequestStatusSchema = z.enum(REGISTRATION_REQUEST_STATUSES);

/** Filter der Wartelisten-Übersicht. Ohne Angabe werden die wartenden Konten gezeigt. */
export const registrationRequestQuerySchema = z.object({
  status: registrationRequestStatusSchema.default('pending'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * Freigabe eines wartenden Kontos.
 *
 * `roleIds` sind die Rollen, die das Konto anstelle der Gast-Rolle erhält.
 * Ohne Angabe vergibt das Backend die Seed-Rolle „Nutzer" – der Regelfall aus
 * Lastenheft §2.
 */
export const approveRegistrationRequestInputSchema = z.object({
  roleIds: z.array(idSchema).max(20).optional(),
});

/** Sperre eines Kontos (Lastenheft §3.1: jederzeit, unabhängig von der Rolle). */
export const blockRegistrationRequestInputSchema = z.object({
  reason: z.string().trim().min(1).max(200).nullish(),
});

export type RegistrationRequestQuery = z.infer<typeof registrationRequestQuerySchema>;
export type ApproveRegistrationRequestInput = z.infer<typeof approveRegistrationRequestInputSchema>;
export type BlockRegistrationRequestInput = z.infer<typeof blockRegistrationRequestInputSchema>;
