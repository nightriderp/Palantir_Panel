import { z } from 'zod';
import {
  QUOTA_REQUEST_STATUSES,
  QUOTA_REQUEST_TRIGGERS,
  type QuotaRequestStatus,
  type QuotaRequestTrigger,
} from '@palantir/contracts';

/**
 * Eingaben der Kontingent-Anfragen (Mockup-Abgleich 12.3.1).
 *
 * Die Grenzen hier sind bewusst großzügig: Was vernünftig ist, entscheidet der
 * Administrator beim Lesen der Begründung, nicht ein Schema. Verhindert wird
 * nur Unsinn – null Server, negativer Speicher, eine leere Begründung.
 */

/** Gewünschter Arbeitsspeicher in MB. */
const requestedRamSchema = z
  .number()
  .int({ message: 'Bitte gib den Arbeitsspeicher in vollen MB an.' })
  .min(512, { message: 'Weniger als 512 MB ergibt keinen Server.' })
  .max(1_048_576, { message: 'So viel Arbeitsspeicher hat keine Node.' });

/** Gewünschte Zahl gleichzeitig laufender Server. */
const requestedServersSchema = z
  .number()
  .int({ message: 'Bitte gib eine ganze Zahl an.' })
  .min(1, { message: 'Mindestens ein Server.' })
  .max(100, { message: 'Mehr als 100 gleichzeitige Server sind kein Freundeskreis mehr.' });

export const quotaRequestTriggerSchema: z.ZodType<QuotaRequestTrigger> = z.enum(
  QUOTA_REQUEST_TRIGGERS as [QuotaRequestTrigger, ...QuotaRequestTrigger[]],
);

export const createQuotaRequestInputSchema = z
  .object({
    /**
     * Woran der Antragsteller geraten ist; ohne Angabe eine Kontingent-Anfrage.
     *
     * Die Vorgabe hält ältere Aufrufer am Leben, die das Feld nicht kennen –
     * und `quota` ist die strengere der beiden Formen, verlangt also einen
     * Wunsch statt ihn stillschweigend entfallen zu lassen.
     */
    trigger: quotaRequestTriggerSchema.optional(),
    requestedRamMb: requestedRamSchema.nullish(),
    requestedMaxConcurrentServers: requestedServersSchema.nullish(),
    reason: z
      .string()
      .trim()
      .min(10, { message: 'Bitte begründe deine Anfrage in einem Satz.' })
      .max(500, { message: 'Bitte fasse dich kürzer (höchstens 500 Zeichen).' }),
  })
  .strict()
  .refine(
    (input) => {
      /*
       * Nur eine Kontingent-Anfrage braucht einen Wunsch. Wer meldet, dass die
       * Node voll ist, bittet nicht um eine Zahl – ein Pflichtfeld wäre dort
       * eine erfundene Angabe, und der Betreiber hätte sie zu genehmigen.
       */
      if ((input.trigger ?? 'quota') !== 'quota') {
        return true;
      }

      return input.requestedRamMb !== null && input.requestedRamMb !== undefined
        ? true
        : input.requestedMaxConcurrentServers !== null &&
            input.requestedMaxConcurrentServers !== undefined;
    },
    {
      message: 'Bitte gib an, was du brauchst: mehr Arbeitsspeicher oder mehr Server.',
      path: ['requestedRamMb'],
    },
  );

/** Entscheidung des Administrators; die Anmerkung ist freiwillig. */
export const decideQuotaRequestInputSchema = z
  .object({
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export const quotaRequestStatusSchema: z.ZodType<QuotaRequestStatus> = z.enum(
  QUOTA_REQUEST_STATUSES as [QuotaRequestStatus, ...QuotaRequestStatus[]],
);

/** Filter der Admin-Liste; ohne Angabe kommen die offenen. */
export const quotaRequestQuerySchema = z
  .object({
    status: quotaRequestStatusSchema.optional(),
  })
  .strict();

export type CreateQuotaRequestInput = z.infer<typeof createQuotaRequestInputSchema>;
export type DecideQuotaRequestInput = z.infer<typeof decideQuotaRequestInputSchema>;
export type QuotaRequestQuery = z.infer<typeof quotaRequestQuerySchema>;
