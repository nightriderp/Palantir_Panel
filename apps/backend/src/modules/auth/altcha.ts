/**
 * ALTCHA-Serverseite (Pflichtenheft §3, §7 und §18 – selbstgehostetes
 * Proof-of-Work-CAPTCHA auf Registrierung und Login).
 *
 * Ablauf:
 * 1. Der Server erzeugt eine Challenge: eine Zufallszahl `n` aus `[0, maxnumber]`
 *    und veröffentlicht `challenge = SHA-256(salt + n)` sowie eine HMAC-Signatur
 *    über `challenge`. Die Zahl selbst bleibt geheim.
 * 2. Der Client zählt `n` von 0 hoch, bis der Hash passt – das ist die Arbeit.
 * 3. Er schickt `{ algorithm, challenge, salt, number, signature }` zurück. Der
 *    Server prüft die Signatur (also: die Challenge stammt wirklich von ihm) und
 *    rechnet den Hash einmal nach.
 *
 * Herkunft und Ablaufzeit stecken im signierten `salt` (Parameter `expires`);
 * ohne den HMAC-Schlüssel lässt sich keine Challenge fälschen. Über offene
 * Challenges führt der Server deshalb keine Liste. Über **eingelöste** schon:
 * {@link AltchaSolutionLedger} sorgt dafür, dass jeder Nachweis genau einmal
 * zählt (siehe {@link verifyAltchaSolution}).
 *
 * Bewusst ohne zusätzliche Abhängigkeit umgesetzt (CLAUDE.md §1) – es sind zwei
 * Hashes und ein HMAC aus `node:crypto`.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { type AltchaChallenge } from '@palantir/contracts';

/** Einziger unterstützter Algorithmus; das Widget kennt denselben Namen. */
const ALGORITHM = 'SHA-256';

export interface AltchaOptions {
  readonly hmacKey: string;
  /** Obere Grenze der Zufallszahl – bestimmt den Rechenaufwand des Clients. */
  readonly complexity: number;
  readonly expirySeconds: number;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function hmacHex(key: string, value: string): string {
  return createHmac('sha256', key).update(value, 'utf8').digest('hex');
}

/** Vergleich in konstanter Zeit; ungleiche Längen gelten sofort als ungleich. */
function equalsInConstantTime(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');

  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Erzeugt eine neue Challenge.
 *
 * Der `salt` trägt die Ablaufzeit als Parameter mit sich und ist über die
 * Signatur gegen Veränderung geschützt – deshalb braucht der Server keine
 * Liste offener Challenges.
 */
export function createAltchaChallenge(
  options: AltchaOptions,
  nowMs: number = Date.now(),
): AltchaChallenge {
  const expiresAtSeconds = Math.floor(nowMs / 1000) + options.expirySeconds;
  const salt = `${randomBytes(12).toString('hex')}?expires=${String(expiresAtSeconds)}`;
  const secretNumber = randomBytes(4).readUInt32BE(0) % (options.complexity + 1);
  const challenge = sha256Hex(`${salt}${String(secretNumber)}`);

  return {
    algorithm: ALGORITHM,
    challenge,
    salt,
    signature: hmacHex(options.hmacKey, challenge),
    maxnumber: options.complexity,
  };
}

/**
 * Verzeichnis bereits eingelöster Nachweise.
 *
 * Ein Proof-of-Work, der beliebig oft gilt, verteuert nur den *ersten* Versuch:
 * Wer eine Challenge einmal löst, könnte denselben Payload bis zum Ablauf an
 * jeden weiteren Anmeldeversuch hängen und wäre damit wieder so schnell wie
 * ohne CAPTCHA. Deshalb merkt sich der Server jeden angenommenen Nachweis für
 * den Rest seiner Gültigkeit.
 *
 * Gespeichert wird nur die Challenge (ein SHA-256-Hex) und ihre Ablaufzeit.
 * Danach greift ohnehin die Ablaufprüfung, der Eintrag kann also weg – die
 * Ablage wächst damit höchstens auf die Zahl der gelösten Challenges eines
 * Zeitfensters (`ALTCHA_EXPIRY_SECONDS`, Standard 5 Minuten).
 *
 * Im Arbeitsspeicher und ohne zusätzliche Abhängigkeit, aus demselben Grund
 * wie beim Rate-Limit (`rate-limit.ts`): Palantir läuft als eine
 * Backend-Instanz auf einer VPS (Pflichtenheft §1). Ein Neustart verliert die
 * Einträge – dann sind die offenen Challenges ohnehin gleich abgelaufen.
 */
export interface AltchaSolutionLedger {
  /**
   * Bucht einen Nachweis ein.
   *
   * `true`, wenn er zum ersten Mal gezählt hat; `false`, wenn derselbe schon
   * einmal angenommen wurde und damit verbraucht ist.
   */
  claim(challenge: string, expiresAtMs: number, nowMs?: number): boolean;
  /** Entfernt abgelaufene Einträge; verhindert unbegrenztes Wachstum. */
  sweep(nowMs?: number): void;
}

export function createAltchaSolutionLedger(): AltchaSolutionLedger {
  const claimed = new Map<string, number>();

  function removeExpired(nowMs: number): void {
    for (const [challenge, expiresAtMs] of claimed) {
      if (expiresAtMs <= nowMs) {
        claimed.delete(challenge);
      }
    }
  }

  return {
    claim(challenge, expiresAtMs, nowMs = Date.now()) {
      // Vor jeder Buchung aufräumen: einen Eintrag bekommt nur, wer die Arbeit
      // tatsächlich geleistet hat, die Ablage bleibt dadurch klein genug, dass
      // ein Durchlauf nicht ins Gewicht fällt. So braucht es keinen Zeitgeber.
      removeExpired(nowMs);

      if (claimed.has(challenge)) {
        return false;
      }

      claimed.set(challenge, expiresAtMs);

      return true;
    },

    sweep(nowMs = Date.now()) {
      removeExpired(nowMs);
    },
  };
}

/** Die vom Widget zurückgeschickte Lösung. */
interface AltchaSolution {
  algorithm: string;
  challenge: string;
  salt: string;
  number: number;
  signature: string;
}

function parseSolution(payload: string): AltchaSolution | null {
  let decoded: unknown;

  try {
    decoded = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
  } catch {
    return null;
  }

  if (typeof decoded !== 'object' || decoded === null) {
    return null;
  }

  const candidate = decoded as Record<string, unknown>;

  if (
    typeof candidate.algorithm !== 'string' ||
    typeof candidate.challenge !== 'string' ||
    typeof candidate.salt !== 'string' ||
    typeof candidate.signature !== 'string' ||
    typeof candidate.number !== 'number' ||
    !Number.isInteger(candidate.number) ||
    candidate.number < 0
  ) {
    return null;
  }

  return {
    algorithm: candidate.algorithm,
    challenge: candidate.challenge,
    salt: candidate.salt,
    number: candidate.number,
    signature: candidate.signature,
  };
}

/** Liest `?expires=` aus dem Salt; `null`, wenn nicht vorhanden oder unlesbar. */
function expiryFromSalt(salt: string): number | null {
  const separator = salt.indexOf('?');

  if (separator === -1) {
    return null;
  }

  const expires = new URLSearchParams(salt.slice(separator + 1)).get('expires');

  if (!expires) {
    return null;
  }

  const parsed = Number.parseInt(expires, 10);

  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Prüft eine gelöste Challenge und löst sie ein.
 *
 * Reihenfolge der Prüfungen ist Absicht: zuerst die Signatur (billig und
 * entscheidet, ob die Challenge überhaupt von uns stammt), dann die Ablaufzeit,
 * erst danach der Hash. So kostet ein gefälschter Nachweis keine Rechenzeit.
 * Eingebucht wird ganz zuletzt – sonst könnte ein beliebiger, nie geprüfter
 * Wert das Verzeichnis füllen.
 *
 * Jeder Nachweis zählt **genau einmal**: derselbe Payload wird ab dem zweiten
 * Mal abgelehnt, auch wenn er noch nicht abgelaufen ist. Registrierung und
 * Login teilen sich dasselbe Verzeichnis – eine für die Registrierung gelöste
 * Aufgabe taugt also auch nicht als Nachweis für einen Anmeldeversuch.
 *
 * Das Verzeichnis wird ausdrücklich übergeben und ist nicht optional: ein
 * vergessener Parameter wäre ein still wiederverwendbarer Proof-of-Work.
 */
export function verifyAltchaSolution(
  payload: string,
  options: AltchaOptions,
  ledger: AltchaSolutionLedger,
  nowMs: number = Date.now(),
): boolean {
  const solution = parseSolution(payload);

  if (!solution || solution.algorithm !== ALGORITHM) {
    return false;
  }

  if (!equalsInConstantTime(solution.signature, hmacHex(options.hmacKey, solution.challenge))) {
    return false;
  }

  const expiresAtSeconds = expiryFromSalt(solution.salt);

  if (expiresAtSeconds === null || expiresAtSeconds * 1000 < nowMs) {
    return false;
  }

  if (solution.number > options.complexity) {
    return false;
  }

  if (
    !equalsInConstantTime(
      solution.challenge,
      sha256Hex(`${solution.salt}${String(solution.number)}`),
    )
  ) {
    return false;
  }

  return ledger.claim(solution.challenge, expiresAtSeconds * 1000, nowMs);
}
