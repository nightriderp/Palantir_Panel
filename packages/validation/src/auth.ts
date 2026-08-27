/**
 * Zod-Schemas zu Anmeldung, Registrierung und 2FA (Pflichtenheft §7).
 *
 * Gegenstück zu `AccountDto`, `LoginResult` und den ALTCHA-Typen aus
 * `@palantir/contracts`. Backend (Request-Validierung) und Frontend
 * (Formularprüfung, Antwort-Prüfung) nutzen dieselben Schemas – kein zweiter,
 * abweichender Regelsatz (CLAUDE.md §3).
 */

import {
  ALTCHA_ALGORITHM,
  AUTH_METHOD_TYPES,
  type AccountDto,
  type GlobalPermissions,
  LOGIN_RESULT_STATUSES,
  OAUTH_PROVIDERS,
  type PasswordResetResultDto,
  type SessionDto,
  type SessionPermissions,
  type TwoFactorSetupDto,
} from '@palantir/contracts';
import { z } from 'zod';

import { idSchema } from './common.js';

/** Mindestlänge eines Passworts (Pflichtenheft §7). */
export const PASSWORD_MIN_LENGTH = 12;

/**
 * Obergrenze der Passwortlänge.
 *
 * Argon2id selbst braucht keine Grenze; sie verhindert nur, dass sehr lange
 * Eingaben unnötig Rechenzeit binden. Der Wert liegt weit über jedem
 * realistischen Passwort und ist bewusst kein Sicherheitsmerkmal.
 */
export const PASSWORD_MAX_LENGTH = 200;

/**
 * Benutzername des Passwort-Verfahrens.
 *
 * Bewusst eng gefasst: der Name taucht im Audit-Log, in der Admin-Warteliste
 * und in Serveradressen-nahen Ansichten auf. Erlaubt sind Buchstaben, Ziffern
 * sowie `.`, `_` und `-`.
 */
export const usernameSchema = z
  .string()
  .trim()
  .min(3, { message: 'Der Benutzername muss mindestens 3 Zeichen lang sein.' })
  .max(32, { message: 'Der Benutzername darf höchstens 32 Zeichen lang sein.' })
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/, {
    message:
      'Erlaubt sind Buchstaben, Ziffern, Punkt, Unterstrich und Bindestrich – nicht am Anfang oder Ende.',
  });

/** Passwort bei der Registrierung und beim Ändern (Pflichtenheft §7). */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, {
    message: `Das Passwort muss mindestens ${PASSWORD_MIN_LENGTH} Zeichen lang sein.`,
  })
  .max(PASSWORD_MAX_LENGTH, {
    message: `Das Passwort darf höchstens ${PASSWORD_MAX_LENGTH} Zeichen lang sein.`,
  });

/** Frei wählbarer Anzeigename; leer bedeutet „aus dem Benutzernamen ableiten". */
export const displayNameSchema = z
  .string()
  .trim()
  .min(2, { message: 'Der Anzeigename muss mindestens 2 Zeichen lang sein.' })
  .max(32, { message: 'Der Anzeigename darf höchstens 32 Zeichen lang sein.' });

/**
 * Gelöste ALTCHA-Challenge, base64-kodiert (Pflichtenheft §3).
 *
 * Der Inhalt wird hier nicht entschlüsselt – die Signatur prüft ausschließlich
 * das Backend gegen `ALTCHA_HMAC_KEY`. Das Schema stellt nur sicher, dass
 * überhaupt etwas Plausibles mitgeschickt wurde.
 */
export const altchaSolutionPayloadSchema = z
  .string()
  .min(1, { message: 'Bitte schließe die Sicherheitsprüfung ab.' })
  .max(4096);

/**
 * Anmeldung mit Benutzername und Passwort.
 *
 * Das Passwort wird hier **nicht** gegen `passwordSchema` geprüft: bestehende
 * Konten können älteren Regeln folgen, und eine Längenmeldung beim Login würde
 * verraten, wie das hinterlegte Passwort aussieht. Falsche Zugangsdaten
 * beantwortet das Backend einheitlich mit `AUTH_INVALID_CREDENTIALS`.
 */
export const loginInputSchema = z.object({
  username: z.string().trim().min(1, { message: 'Bitte gib deinen Benutzernamen ein.' }),
  password: z.string().min(1, { message: 'Bitte gib dein Passwort ein.' }),
  /**
   * Gelöste ALTCHA-Challenge – **Pflichtfeld** (Breaking Change aus R5).
   *
   * Pflichtenheft §7 und §18 verlangen den Spam-Schutz ausdrücklich auch beim
   * **Login**, nicht nur bei der Registrierung – sonst steht das Passwortfeld
   * für automatisiertes Durchprobieren offen und es bliebe allein das
   * IP-Rate-Limit. B1 hat das Feld zunächst als `optional()` eingeführt, weil
   * das Frontend es noch nicht mitschickte; abgelehnt hat das Backend einen
   * Login ohne gültigen Nachweis trotzdem immer. Seit R5 schickt `LoginView`
   * ihn mit, deshalb steht die Pflicht jetzt auch im Schema: ein fehlender
   * Nachweis soll schon im Formular auffallen und nicht erst als
   * `AUTH_CAPTCHA_INVALID` aus dem Backend zurückkommen.
   */
  altcha: altchaSolutionPayloadSchema,
});

/** Registrierung eines Passwort-Kontos (Lastenheft §3.1). */
export const registerInputSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  /** Optional – ohne Angabe übernimmt das Backend den Benutzernamen. */
  displayName: displayNameSchema.optional(),
  altcha: altchaSolutionPayloadSchema,
});

/**
 * Zweiter Anmeldeschritt (Pflichtenheft §7).
 *
 * Akzeptiert den sechsstelligen TOTP-Code und den längeren Backup-Code; welche
 * Form vorliegt, entscheidet das Backend. Leerzeichen und Bindestriche werden
 * vorher entfernt, damit ein kopierter Code nicht scheitert.
 */
export const twoFactorCodeSchema = z
  .string()
  .transform((value) => value.replace(/[\s-]/g, ''))
  .pipe(
    z
      .string()
      .min(6, { message: 'Bitte gib den vollständigen Code ein.' })
      .max(32, { message: 'Der Code ist zu lang.' })
      .regex(/^[A-Za-z0-9]+$/, { message: 'Der Code darf nur Buchstaben und Ziffern enthalten.' }),
  );

export const twoFactorInputSchema = z.object({
  /** Kurzlebiger Zwischen-Token aus dem ersten Schritt – kein Access-Token. */
  twoFactorToken: z.string().min(1),
  code: twoFactorCodeSchema,
});

// -- Antwort-Schemas (Frontend prüft, statt blind zu vertrauen) --------------

export const authMethodTypeSchema = z.enum(AUTH_METHOD_TYPES);
export const oauthProviderSchema = z.enum(OAUTH_PROVIDERS);

export const linkedAuthMethodSchema = z.object({
  type: authMethodTypeSchema,
  providerDisplayName: z.string().nullable(),
  linkedAt: z.string().datetime({ offset: true }),
});

export const accountRoleSummarySchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  isProtected: z.boolean(),
});

/**
 * Instanzweite Rechte des Kontos (`GlobalPermissions`, Pflichtenheft §5.2).
 *
 * Die Typ-Annotation ist Absicht: kommt in `@palantir/contracts` ein Flag dazu
 * oder fällt eines weg, schlägt hier die Übersetzung fehl, statt dass Schema
 * und Typ still auseinanderlaufen.
 */
export const globalPermissionsSchema: z.ZodType<GlobalPermissions> = z.object({
  canCreateServer: z.boolean(),
  canViewAnyServer: z.boolean(),
  canManageAnyBackup: z.boolean(),
  canManageUsers: z.boolean(),
  canManageRoles: z.boolean(),
  canManageNotifications: z.boolean(),
  canViewNodes: z.boolean(),
  canManageNodes: z.boolean(),
  canManageAddresses: z.boolean(),
  canViewAuditLog: z.boolean(),
  canModerateMessages: z.boolean(),
  canManageGameTypes: z.boolean(),
});

/** Angemeldetes Konto – Gegenstück zu `AccountDto` (Pflichtenheft §5.2, §7). */
export const accountDtoSchema: z.ZodType<AccountDto> = z.object({
  id: idSchema,
  displayName: z.string().min(1),
  username: z.string().nullable(),
  isOwner: z.boolean(),
  banned: z.boolean(),
  awaitingApproval: z.boolean(),
  twoFactorEnabled: z.boolean(),
  roles: z.array(accountRoleSummarySchema),
  authMethods: z.array(linkedAuthMethodSchema),
  createdAt: z.string().datetime({ offset: true }),
  permissions: globalPermissionsSchema,
});

export const authenticatedResultSchema = z.object({ account: accountDtoSchema });

export const loginResultStatusSchema = z.enum(LOGIN_RESULT_STATUSES);

export const loginResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('authenticated'), account: accountDtoSchema }),
  z.object({
    status: z.literal('two_factor_required'),
    twoFactorToken: z.string().min(1),
    expiresAt: z.string().datetime({ offset: true }),
  }),
]);

/** Vom Backend ausgelieferte Proof-of-Work-Aufgabe (Pflichtenheft §3). */
export const altchaChallengeSchema = z.object({
  algorithm: z.literal(ALTCHA_ALGORITHM),
  challenge: z.string().regex(/^[0-9a-f]+$/, { message: 'Ungültiger Challenge-Hash.' }),
  salt: z.string().min(1),
  maxnumber: z.number().int().positive(),
  signature: z.string().min(1),
});

export type LoginInput = z.infer<typeof loginInputSchema>;
export type RegisterInput = z.infer<typeof registerInputSchema>;
export type TwoFactorInput = z.infer<typeof twoFactorInputSchema>;

// ---------------------------------------------------------------------------
// Ergänzungen aus Arbeitspaket B1 (Backend, Pflichtenheft §7)
// ---------------------------------------------------------------------------
// Rein additiv zu den Schemas oben, die aus F1 stammen. Alles hier gehört zu
// Vorgängen, die es im Frontend-Paket F1 noch nicht gab: Passwort ändern und
// verknüpfen, 2FA einrichten und abschalten, Konto löschen, Sitzungsübersicht.

/**
 * TOTP-Code nach RFC 6238: genau sechs Ziffern.
 *
 * Enger gefasst als {@link twoFactorCodeSchema}, das zusätzlich längere Codes
 * durchlässt. Beim Einrichten und Abschalten von 2FA ist ausschließlich ein
 * echter TOTP-Code zulässig – Wiederherstellungscodes gibt es bewusst nicht
 * (Pflichtenheft §7: die Wiederherstellung läuft über einen Admin).
 */
export const totpCodeSchema = z
  .string()
  .trim()
  .regex(/^[0-9]{6}$/, { message: 'Der Bestätigungscode besteht aus 6 Ziffern.' });

/** Passwortwechsel im eingeloggten Zustand (Pflichtenheft §7). */
export const changePasswordInputSchema = z
  .object({
    currentPassword: z.string().min(1, { message: 'Bitte gib dein aktuelles Passwort ein.' }),
    newPassword: passwordSchema,
  })
  .refine((input) => input.currentPassword !== input.newPassword, {
    message: 'Das neue Passwort muss sich vom bisherigen unterscheiden.',
    path: ['newPassword'],
  });

/**
 * Passwort als weiteres Anmeldeverfahren zu einem Provider-Konto hinzufügen
 * (Lastenheft §3.1). Nur im eingeloggten Zustand (Pflichtenheft §7).
 */
export const linkPasswordInputSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
});

/** Bestätigung der 2FA-Einrichtung mit einem gültigen Code (Pflichtenheft §7). */
export const confirmTwoFactorInputSchema = z.object({
  code: totpCodeSchema,
});

/**
 * 2FA abschalten: verlangt Passwort **und** gültigen Code.
 *
 * Beides, damit weder ein übernommenes Gerät noch ein abgegriffenes Passwort
 * allein reicht, um den zweiten Faktor zu entfernen.
 */
export const disableTwoFactorInputSchema = z.object({
  password: z.string().min(1, { message: 'Bitte gib dein Passwort ein.' }),
  code: totpCodeSchema,
});

/**
 * Selbstständige Konto-Löschung (Lastenheft §3.1).
 *
 * Der Anmeldename muss zur Bestätigung abgetippt werden; bei Konten mit
 * Passwort-Verfahren kommt das Passwort dazu. Ob es verlangt wird, entscheidet
 * das Backend anhand der verknüpften Verfahren – reine Provider-Konten haben
 * keins.
 */
export const deleteAccountInputSchema = z.object({
  confirmName: z
    .string()
    .trim()
    .min(1, { message: 'Bitte tippe deinen Namen zur Bestätigung ab.' }),
  password: z.string().min(1).optional(),
});

// -- Antwort-Schemas ---------------------------------------------------------

export const sessionPermissionsSchema: z.ZodType<SessionPermissions> = z.object({
  canRevoke: z.boolean(),
});

/** Eine aktive Sitzung der Geräteübersicht (Lastenheft §3.1). */
export const sessionDtoSchema: z.ZodType<SessionDto> = z.object({
  id: idSchema,
  deviceInfo: z.string().nullable(),
  ipHint: z.string().nullable(),
  createdAt: z.string().datetime({ offset: true }),
  lastUsedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  current: z.boolean(),
  permissions: sessionPermissionsSchema,
});

/** Einmalige Ausgabe beim Einrichten von 2FA (Pflichtenheft §7). */
export const twoFactorSetupSchema: z.ZodType<TwoFactorSetupDto> = z.object({
  secret: z.string().min(1),
  otpauthUri: z.string().startsWith('otpauth://'),
});

/** Ergebnis eines vom Admin ausgelösten Passwort-Resets (Lastenheft §3.1). */
export const passwordResetResultSchema: z.ZodType<PasswordResetResultDto> = z.object({
  userId: idSchema,
  temporaryPassword: z.string().min(1),
});

export type ChangePasswordInput = z.infer<typeof changePasswordInputSchema>;
export type LinkPasswordInput = z.infer<typeof linkPasswordInputSchema>;
export type ConfirmTwoFactorInput = z.infer<typeof confirmTwoFactorInputSchema>;
export type DisableTwoFactorInput = z.infer<typeof disableTwoFactorInputSchema>;
export type DeleteAccountInput = z.infer<typeof deleteAccountInputSchema>;
