/**
 * Zod-Schemas rund um Gameserver (Lastenheft §3.3, Pflichtenheft §9 und §13).
 *
 * Gegenstück zu den DTOs aus `@palantir/contracts`. Backend (Request-Prüfung)
 * und Frontend (Wizard, Einstellungen, Aufgaben-Dialog) nutzen dieselben
 * Regeln – kein zweiter, abweichender Regelsatz und keine eigene Prüfung im
 * Frontend, die vom Backend abweicht.
 */

import {
  SCHEDULE_ACTIONS,
  SERVER_MEMBER_LEVELS,
  isReservedSubdomain,
  type GameConfigValue,
} from '@palantir/contracts';
import { z } from 'zod';
import { idSchema } from './common.js';
import { cronExpressionSchema } from './backups.js';
import { cpuCoresSchema, megabytesSchema } from './resources.js';

/**
 * Steuerzeichen (C0-Bereich und DEL).
 *
 * Bewusst als Funktion statt als Regex: ein Regex mit Steuerzeichen-Bereich
 * müsste per `eslint-disable` freigeschaltet werden und ist beim Lesen deutlich
 * schwerer zu prüfen.
 */
function isControlCharacter(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return code < 0x20 || code === 0x7f;
}

/**
 * Servername.
 *
 * Frei wählbar (Lastenheft §3.3), begrenzt wird nur die Länge. Steuerzeichen
 * werden abgelehnt, damit ein Name Listen und Konsolenausgaben nicht zerlegt.
 */
export const serverNameSchema = z
  .string()
  .trim()
  .min(3, { message: 'Der Servername muss mindestens 3 Zeichen lang sein.' })
  .max(48, { message: 'Der Servername darf höchstens 48 Zeichen lang sein.' })
  .refine((value) => ![...value].some(isControlCharacter), {
    message: 'Der Servername darf keine Steuerzeichen enthalten.',
  });

/**
 * Subdomain eines Servers (Pflichtenheft §13).
 *
 * Regeln wie bei einem DNS-Label: Kleinbuchstaben, Ziffern und Bindestriche,
 * nicht mit Bindestrich beginnen oder enden, 3–30 Zeichen. Zusätzlich sind die
 * reservierten Systemnamen gesperrt. Ob der Name noch frei ist, prüft das
 * Backend gegen die Datenbank (`SUBDOMAIN_TAKEN`).
 */
export const subdomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, { message: 'Die Subdomain muss mindestens 3 Zeichen lang sein.' })
  .max(30, { message: 'Die Subdomain darf höchstens 30 Zeichen lang sein.' })
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, {
    message: 'Erlaubt sind Kleinbuchstaben, Ziffern und Bindestriche – nicht am Anfang oder Ende.',
  })
  .refine((value) => !isReservedSubdomain(value), {
    message: 'Dieser Name ist für das System reserviert.',
  });

/**
 * Ressourcen-Limits eines Servers (Pflichtenheft §6 und §10).
 *
 * Baut auf `megabytesSchema` und `cpuCoresSchema` aus `resources.js` (B4) auf –
 * dieselbe Zählweise, dieselbe Nachkommastellen-Regel. Ergänzt werden nur die
 * **Untergrenzen**: ein Kontingent von 0 ist eine gültige Verwaltungsaussage,
 * ein Server mit 0 MB Arbeitsspeicher wäre dagegen nicht startfähig.
 *
 * Ob die Werte tatsächlich vergeben werden dürfen, entscheidet immer das
 * Backend gegen Nutzer-Kontingent und freie Node-Kapazität
 * (`RESOURCE_LIMIT_EXCEEDED`).
 */
export const serverResourceLimitsSchema = z.object({
  ramMb: megabytesSchema
    .min(512, { message: 'Mindestens 512 MB Arbeitsspeicher.' })
    .max(262144, { message: 'Höchstens 256 GB Arbeitsspeicher.' }),
  cpuCores: cpuCoresSchema.refine((value) => value >= 0.5 && value <= 64, {
    message: 'Zwischen einem halben und 64 CPU-Kernen.',
  }),
  diskMb: megabytesSchema
    .min(1024, { message: 'Mindestens 1 GB Speicherplatz.' })
    .max(4194304, { message: 'Höchstens 4 TB Speicherplatz.' }),
});

/** Startparameter als eine Zeile (Lastenheft §3.3). */
export const startupParametersSchema = z
  .string()
  .trim()
  .max(1024, { message: 'Die Startparameter dürfen höchstens 1024 Zeichen lang sein.' });

/**
 * Werte des spielspezifischen Config-Schemas.
 *
 * Welche Schlüssel erlaubt sind, steht in der `GameTypeDefinition` und ist
 * deshalb erst zur Laufzeit bekannt – hier wird nur die Form der Werte geprüft.
 */
export const gameConfigValueSchema: z.ZodType<GameConfigValue> = z.union([
  z.string().max(2048),
  z.number(),
  z.boolean(),
]);

export const gameConfigValuesSchema = z.record(z.string().min(1), gameConfigValueSchema);

/**
 * Ein Konsolenbefehl (Lastenheft §3.3).
 *
 * Zeilenumbrüche werden abgelehnt: ein Feld schickt genau einen Befehl, damit
 * nicht versehentlich mehrere Zeilen auf einmal in den Server laufen.
 */
export const consoleCommandSchema = z
  .string()
  .trim()
  .min(1, { message: 'Bitte einen Befehl eingeben.' })
  .max(512, { message: 'Der Befehl darf höchstens 512 Zeichen lang sein.' })
  .refine((value) => !/[\r\n]/.test(value), {
    message: 'Ein Befehl darf keine Zeilenumbrüche enthalten.',
  });

/**
 * Übernahme bestehender Weltdaten beim Anlegen (Lastenheft §3.3: Migration von
 * anderen Hosting-Anbietern).
 *
 * Das Archiv selbst wird getrennt hochgeladen; hier steht nur der Verweis auf
 * den abgeschlossenen Upload.
 */
export const worldImportInputSchema = z.object({
  /** Id des zuvor hochgeladenen Archivs. */
  uploadId: idSchema,
  /** Ursprünglicher Dateiname – erscheint in der Zusammenfassung des Wizards. */
  fileName: z.string().trim().min(1).max(255),
});

/** Eingaben des „Server erstellen"-Wizards (Lastenheft §3.3). */
export const createServerInputSchema = z.object({
  gameType: z.string().trim().min(1, { message: 'Bitte ein Spiel wählen.' }),
  name: serverNameSchema,
  subdomain: subdomainSchema,
  /** Ziel-Node; das Backend prüft die freie Kapazität erneut. */
  hostId: idSchema,
  resourceLimits: serverResourceLimitsSchema,
  config: gameConfigValuesSchema,
  startupParameters: startupParametersSchema,
  autoShutdownEnabled: z.boolean(),
  worldImport: worldImportInputSchema.nullable(),
});

export type CreateServerInput = z.infer<typeof createServerInputSchema>;

/**
 * Änderbare Einstellungen eines bestehenden Servers.
 *
 * Die Subdomain fehlt bewusst: sie steht seit dem Anlegen fest, ein Wechsel
 * liefe über einen neuen DNS-Eintrag und ist in Version 1 nicht vorgesehen
 * (Pflichtenheft §13).
 */
export const updateServerSettingsInputSchema = z.object({
  name: serverNameSchema,
  resourceLimits: serverResourceLimitsSchema,
  config: gameConfigValuesSchema,
  startupParameters: startupParametersSchema,
  autoShutdownEnabled: z.boolean(),
  autoShutdownTimeoutMinutes: z
    .number()
    .int()
    .min(5, { message: 'Der Timeout beträgt mindestens 5 Minuten.' })
    .max(1440, { message: 'Der Timeout beträgt höchstens 24 Stunden.' })
    .nullable(),
});

export type UpdateServerSettingsInput = z.infer<typeof updateServerSettingsInputSchema>;

/**
 * Klonen eines Servers (Pflichtenheft §9).
 *
 * Die neue Subdomain ist Pflicht und wird nach denselben Regeln geprüft wie
 * beim Anlegen – zwei Server dürfen sich nie eine Adresse teilen.
 */
export const cloneServerInputSchema = z.object({
  name: serverNameSchema,
  subdomain: subdomainSchema,
  includeWorldData: z.boolean(),
});

export type CloneServerInput = z.infer<typeof cloneServerInputSchema>;

export const scheduleActionSchema = z.enum(SCHEDULE_ACTIONS);

/**
 * Anlegen und Ändern einer geplanten Aufgabe (Entität `Schedule`,
 * Pflichtenheft §6, Lastenheft §3.3).
 *
 * Der Cron-Ausdruck wird mit `cronExpressionSchema` aus `backups.js` (B5)
 * geprüft – dieselbe Regel für den Backup-Zeitplan und für jede andere Aufgabe.
 */
export const scheduleInputSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(3, { message: 'Der Name muss mindestens 3 Zeichen lang sein.' })
      .max(60, { message: 'Der Name darf höchstens 60 Zeichen lang sein.' }),
    action: scheduleActionSchema,
    /** Nur bei `action === 'command'` gefüllt. */
    command: consoleCommandSchema.nullable(),
    cronExpression: cronExpressionSchema,
    timezone: z.string().trim().min(1).max(64),
    enabled: z.boolean(),
  })
  .refine((input) => input.action !== 'command' || input.command !== null, {
    message: 'Für die Aktion „Konsolenbefehl" muss ein Befehl angegeben werden.',
    path: ['command'],
  });

export type ScheduleInput = z.infer<typeof scheduleInputSchema>;

export const serverMemberLevelSchema = z.enum(SERVER_MEMBER_LEVELS);

/** Mitverwalter hinzufügen oder seine Stufe ändern (Lastenheft §3.3). */
export const serverMemberInputSchema = z.object({
  userId: idSchema,
  level: serverMemberLevelSchema,
});

export type ServerMemberInput = z.infer<typeof serverMemberInputSchema>;

/**
 * Pfad im Datenordner eines Servers (Datei-Manager).
 *
 * Immer relativ, immer mit `/` getrennt. `..` ist ausgeschlossen, damit über
 * den Pfad nicht aus dem Datenordner herausgelaufen werden kann; der Agent
 * prüft das zusätzlich (`AGENT_INVALID_PATH`).
 */
export const serverFilePathSchema = z
  .string()
  .max(1024, { message: 'Der Pfad ist zu lang.' })
  .refine((value) => !value.startsWith('/') && !value.includes('\\'), {
    message: 'Erwartet wird ein relativer Pfad mit „/" als Trenner.',
  })
  .refine((value) => !value.split('/').includes('..'), {
    message: 'Der Pfad darf nicht aus dem Datenordner herausführen.',
  });
