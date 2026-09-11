/**
 * Verschlüsselung der Panel-Sicherungen (Fundpunkt 241).
 *
 * ## Warum
 *
 * Ein Abzug der Panel-Datenbank enthält jedes Konto, jede Rolle, die
 * TOTP-Geheimnisse der Zwei-Faktor-Anmeldung und die Webhook-Adressen der
 * Benachrichtigungen. Er lag bisher im Klartext im Sicherungsverzeichnis der
 * VPS. Wer dort lesen kann – ein zweiter Dienst auf derselben Maschine, ein
 * versehentlich offenes Backup des Backups, ein späterer Betreiber des Servers
 * – hat damit die ganze Instanz, ohne je das Panel angefasst zu haben.
 *
 * ## Warum ein Schlüsselpaar und keine Passphrase
 *
 * Die tägliche Sicherung läuft unbeaufsichtigt (`panelBackupTask` im
 * Zeitgeber). Sie kann niemanden nach einem Kennwort fragen, und ein Kennwort
 * in der `.env` neben dem Abzug wäre kein Schutz, sondern die Illusion davon.
 *
 * Deshalb: **Der öffentliche Schlüssel liegt auf der VPS und verschlüsselt –
 * mehr kann er nicht.** Der private Schlüssel liegt beim Betreiber, geschützt
 * durch dessen Passphrase, und wird nur beim Zurückspielen gebraucht. Auf der
 * Maschine, die die Sicherung schreibt, liegt damit kein Geheimnis, mit dem man
 * sie wieder aufmachen könnte.
 *
 * ## Das Format
 *
 * Ein Hybridverfahren, wie es jede Sicherungs-Software benutzt: RSA ist zu
 * langsam für Megabyte an Daten und kann von Haus aus nur wenige hundert Byte
 * verschlüsseln. Also bekommt jeder Abzug einen frisch gewürfelten
 * AES-Schlüssel, und nur der wird mit RSA verpackt.
 *
 * ```
 * Byte 0..15    Magie      "PALANTIR-BACKUP\n" - erkennbar ohne Schlüssel
 * Byte 16       Fassung    1
 * Byte 17..18   Länge      Länge des verpackten Schlüssels, 16 Bit, Big Endian
 * ... Länge     Schlüssel  AES-256-Schlüssel, mit RSA-OAEP (SHA-256) verpackt
 * ... 12        IV         Zufallswert für AES-GCM
 * ... Rest-16   Chiffrat   der gzip-komprimierte pg_dump-Abzug
 * letzte 16     Siegel     GCM-Auth-Tag über Kopf und Chiffrat
 * ```
 *
 * Der **gesamte Kopf** geht als zusätzliche authentifizierte Daten (AAD) in das
 * Siegel ein. Wer den verpackten Schlüssel gegen einen anderen tauscht, ändert
 * damit das Siegel – das Entschlüsseln scheitert, statt stillschweigend Unsinn
 * zu liefern.
 *
 * Das Siegel steht am **Ende**, weil GCM es erst kennt, wenn alles durch ist –
 * der Abzug soll aber im Vorbeigehen verschlüsselt werden und nie vollständig
 * im Speicher liegen. Das Entschlüsseln hält deshalb immer die letzten 16 Byte
 * zurück: Solange noch etwas nachkommt, waren es Daten; kommt nichts mehr, war
 * es das Siegel.
 *
 * ## Was das Format nicht leistet
 *
 * Es schützt die Datei, nicht die laufende Instanz. Wer Zugriff auf die VPS
 * hat, liest die Datenbank direkt – die Sicherung zu verschlüsseln ändert
 * daran nichts und soll es auch nicht.
 *
 * Die Datei ist **ohne den privaten Schlüssel unwiederbringlich**. Ein
 * verlorener Schlüssel oder eine vergessene Passphrase heißt: keine
 * Wiederherstellung. Das steht bewusst so in der Ausgabe von
 * `panel:schluessel`.
 */

import {
  constants,
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  privateDecrypt,
  publicEncrypt,
  randomBytes,
  type DecipherGCM,
  type KeyObject,
} from 'node:crypto';
import { Transform, type TransformCallback } from 'node:stream';

/** Erkennungszeichen am Dateianfang – genau 16 Byte. */
export const SICHERUNGS_MAGIE = Buffer.from('PALANTIR-BACKUP\n', 'ascii');

/** Fassung des Formats; ein Leser weist alles Unbekannte benannt ab. */
export const SICHERUNGS_FASSUNG = 1;

/** Dateiendung eines verschlüsselten Abzugs. */
export const VERSCHLUESSELTE_ENDUNG = '.sql.gz.enc';

/** Dateiendung eines unverschlüsselten Abzugs (der bisherige Zustand). */
export const OFFENE_ENDUNG = '.sql.gz';

const IV_LAENGE = 12;
const SIEGEL_LAENGE = 16;
const SCHLUESSEL_LAENGE = 32;

/** Magie + Fassung + Längenfeld – so viel braucht es, um weiterzulesen. */
const KOPF_ANFANG = SICHERUNGS_MAGIE.length + 1 + 2;

/**
 * Kürzeste zulässige Passphrase.
 *
 * Der private Schlüssel wird als PKCS#8 mit AES-256-CBC abgelegt; die
 * Schlüsselableitung darin ist OpenSSLs Vorgabe und nicht besonders teuer. Die
 * Sicherheit kommt deshalb aus der Länge der Passphrase, nicht aus der
 * Ableitung – vier zufällige Wörter sind mehr wert als acht Sonderzeichen.
 */
export const MINDESTLAENGE_PASSPHRASE = 12;

const RSA_OPTIONEN = {
  padding: constants.RSA_PKCS1_OAEP_PADDING,
  oaepHash: 'sha256',
} as const;

/** Ein erzeugtes Paar, beide Teile als PEM. */
export interface Schluesselpaar {
  /** Gehört auf die VPS; verschlüsselt, mehr kann er nicht. */
  readonly oeffentlich: string;
  /** Gehört zum Betreiber; mit der Passphrase verschlossen. */
  readonly privat: string;
}

/**
 * Ein Schlüsselpaar erzeugen.
 *
 * RSA-4096 statt 2048: Der Schlüssel muss so lange halten, wie die ältesten
 * aufgehobenen Sicherungen lesbar bleiben sollen, und die paar Sekunden beim
 * Erzeugen fallen einmalig an. Verschlüsselt wird damit ohnehin nur der
 * 32-Byte-Sitzungsschlüssel.
 */
export function erzeugeSchluesselpaar(passphrase: string): Schluesselpaar {
  if (passphrase.length < MINDESTLAENGE_PASSPHRASE) {
    throw new Error(
      `Die Passphrase muss mindestens ${String(MINDESTLAENGE_PASSPHRASE)} Zeichen lang sein.`,
    );
  }

  const paar = generateKeyPairSync('rsa', {
    modulusLength: 4096,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem',
      cipher: 'aes-256-cbc',
      passphrase,
    },
  });

  return { oeffentlich: paar.publicKey, privat: paar.privateKey };
}

/**
 * Einen öffentlichen Schlüssel aus PEM lesen und prüfen, dass er taugt.
 *
 * Die Prüfung gehört hierher und nicht erst in den Sicherungslauf: Ein
 * vertippter Pfad oder eine versehentlich abgelegte *private* Datei soll
 * benannt scheitern, nicht erst beim nächtlichen Lauf als „Unbekannter Fehler".
 */
export function ladeOeffentlichenSchluessel(pem: string): KeyObject {
  let schluessel: KeyObject;

  try {
    schluessel = createPublicKey(pem);
  } catch (fehler: unknown) {
    const grund = fehler instanceof Error ? fehler.message : 'unbekannt';

    throw new Error(`Der öffentliche Schlüssel ließ sich nicht lesen (${grund}).`);
  }

  if (schluessel.asymmetricKeyType !== 'rsa') {
    throw new Error(
      `Erwartet wird ein RSA-Schlüssel, gelesen wurde "${schluessel.asymmetricKeyType ?? 'unbekannt'}".`,
    );
  }

  const bits = schluessel.asymmetricKeyDetails?.modulusLength ?? 0;

  if (bits < 2048) {
    throw new Error(`Der Schlüssel ist mit ${String(bits)} Bit zu kurz; mindestens 2048 nötig.`);
  }

  return schluessel;
}

/** Einen privaten Schlüssel aus PEM und Passphrase lesen. */
export function ladePrivatenSchluessel(pem: string, passphrase: string): KeyObject {
  try {
    return createPrivateKey({ key: pem, passphrase });
  } catch (fehler: unknown) {
    /*
     * OpenSSL meldet eine falsche Passphrase als "bad decrypt" – für sich
     * genommen unverständlich. Beide Fälle (falsche Passphrase, kaputte Datei)
     * sehen hier gleich aus, deshalb nennt die Meldung beide.
     */
    const grund = fehler instanceof Error ? fehler.message : 'unbekannt';

    throw new Error(
      `Der private Schlüssel ließ sich nicht öffnen. Passphrase falsch oder Datei beschädigt (${grund}).`,
    );
  }
}

/** Trägt die Datei unseren Kopf? Für eine verständliche Meldung beim Lesen. */
export function istVerschluesselteSicherung(anfang: Buffer): boolean {
  return (
    anfang.length >= SICHERUNGS_MAGIE.length &&
    anfang.subarray(0, SICHERUNGS_MAGIE.length).equals(SICHERUNGS_MAGIE)
  );
}

function baueKopf(verpackterSchluessel: Buffer, iv: Buffer): Buffer {
  const laenge = Buffer.alloc(2);

  laenge.writeUInt16BE(verpackterSchluessel.length);

  return Buffer.concat([
    SICHERUNGS_MAGIE,
    Buffer.from([SICHERUNGS_FASSUNG]),
    laenge,
    verpackterSchluessel,
    iv,
  ]);
}

interface Kopf {
  /** Der Kopf als Ganzes – er ist zugleich die AAD des Siegels. */
  readonly bytes: Buffer;
  readonly verpackterSchluessel: Buffer;
  readonly iv: Buffer;
}

/** Kopf lesen; `null` heißt „noch nicht genug Bytes da", nicht „kaputt". */
function leseKopf(roh: Buffer): Kopf | null {
  if (roh.length < KOPF_ANFANG) {
    return null;
  }

  if (!istVerschluesselteSicherung(roh)) {
    throw new Error(
      'Die Datei beginnt nicht mit dem Kopf einer verschlüsselten Palantir-Sicherung.',
    );
  }

  const fassung = roh.readUInt8(SICHERUNGS_MAGIE.length);

  if (fassung !== SICHERUNGS_FASSUNG) {
    throw new Error(
      `Die Datei trägt Format-Fassung ${String(fassung)}; dieses Panel kennt nur ${String(SICHERUNGS_FASSUNG)}.`,
    );
  }

  const schluesselLaenge = roh.readUInt16BE(SICHERUNGS_MAGIE.length + 1);
  const kopfLaenge = KOPF_ANFANG + schluesselLaenge + IV_LAENGE;

  if (roh.length < kopfLaenge) {
    return null;
  }

  return {
    bytes: roh.subarray(0, kopfLaenge),
    verpackterSchluessel: roh.subarray(KOPF_ANFANG, KOPF_ANFANG + schluesselLaenge),
    iv: roh.subarray(KOPF_ANFANG + schluesselLaenge, kopfLaenge),
  };
}

/**
 * Ein Strom, der Klartext annimmt und die fertige Datei ausgibt.
 *
 * Der Kopf geht mit dem ersten Stück hinaus, das Siegel am Ende – dazwischen
 * fließt der Abzug durch, ohne je vollständig im Speicher zu liegen.
 */
export function erzeugeVerschluesselungsStrom(oeffentlicherSchluessel: KeyObject): Transform {
  const sitzungsschluessel = randomBytes(SCHLUESSEL_LAENGE);
  const iv = randomBytes(IV_LAENGE);
  const kopf = baueKopf(
    publicEncrypt({ key: oeffentlicherSchluessel, ...RSA_OPTIONEN }, sitzungsschluessel),
    iv,
  );
  const chiffre = createCipheriv('aes-256-gcm', sitzungsschluessel, iv);

  chiffre.setAAD(kopf);

  let kopfGeschrieben = false;

  function schreibeKopf(strom: Transform): void {
    if (!kopfGeschrieben) {
      strom.push(kopf);
      kopfGeschrieben = true;
    }
  }

  return new Transform({
    transform(stueck: Buffer, _kodierung: BufferEncoding, weiter: TransformCallback) {
      try {
        schreibeKopf(this);
        weiter(null, chiffre.update(stueck));
      } catch (fehler: unknown) {
        weiter(fehler as Error);
      }
    },

    flush(fertig: TransformCallback) {
      try {
        // Auch ein leerer Abzug ergibt eine gültige Datei – sonst stünde am
        // Ende eine Datei ohne Kopf, die niemand einordnen kann.
        schreibeKopf(this);
        this.push(chiffre.final());
        this.push(chiffre.getAuthTag());
        fertig();
      } catch (fehler: unknown) {
        fertig(fehler as Error);
      }
    },
  });
}

/**
 * Ein Strom, der die fertige Datei annimmt und den Klartext ausgibt.
 *
 * Ausgegeben wird nur, was das Siegel deckt: `final()` wirft, wenn der Inhalt
 * unterwegs geändert wurde. Die bereits durchgereichten Stücke sind dann
 * allerdings schon draußen – wer auf Unversehrtheit angewiesen ist, schreibt
 * deshalb erst in eine Zwischendatei und benennt sie nach dem Ende um. Genau
 * das tut `panel:entschluesseln`.
 */
export function erzeugeEntschluesselungsStrom(privaterSchluessel: KeyObject): Transform {
  let puffer = Buffer.alloc(0);
  let entschluessler: DecipherGCM | null = null;

  return new Transform({
    transform(stueck: Buffer, _kodierung: BufferEncoding, weiter: TransformCallback) {
      try {
        puffer = Buffer.concat([puffer, stueck]);

        if (entschluessler === null) {
          const kopf = leseKopf(puffer);

          if (kopf === null) {
            weiter();

            return;
          }

          let sitzungsschluessel: Buffer;

          try {
            sitzungsschluessel = privateDecrypt(
              { key: privaterSchluessel, ...RSA_OPTIONEN },
              kopf.verpackterSchluessel,
            );
          } catch {
            throw new Error(
              'Der Sitzungsschlüssel ließ sich nicht auspacken. Die Datei gehört zu einem anderen Schlüsselpaar.',
            );
          }

          entschluessler = createDecipheriv('aes-256-gcm', sitzungsschluessel, kopf.iv);
          entschluessler.setAAD(kopf.bytes);
          puffer = puffer.subarray(kopf.bytes.length);
        }

        /*
         * Die letzten 16 Byte bleiben liegen: Sie könnten das Siegel sein.
         * Kommt noch etwas nach, waren es doch Daten und gehen beim nächsten
         * Stück mit.
         */
        if (puffer.length > SIEGEL_LAENGE) {
          const daten = puffer.subarray(0, puffer.length - SIEGEL_LAENGE);

          puffer = Buffer.from(puffer.subarray(puffer.length - SIEGEL_LAENGE));
          this.push(entschluessler.update(daten));
        }

        weiter();
      } catch (fehler: unknown) {
        weiter(fehler as Error);
      }
    },

    flush(fertig: TransformCallback) {
      try {
        if (entschluessler === null) {
          throw new Error('Die Datei ist zu kurz: Sie endet mitten im Kopf.');
        }

        if (puffer.length !== SIEGEL_LAENGE) {
          throw new Error('Die Datei ist abgeschnitten: Das Siegel am Ende fehlt.');
        }

        entschluessler.setAuthTag(puffer);
        this.push(entschluessler.final());
        fertig();
      } catch (fehler: unknown) {
        // `final()` wirft ohne eigene Meldung, wenn das Siegel nicht passt.
        const meldung = fehler instanceof Error ? fehler.message : '';

        fertig(
          meldung === '' || meldung.includes('unable to authenticate')
            ? new Error(
                'Das Siegel passt nicht: Die Datei wurde nach dem Schreiben verändert oder ist unvollständig.',
              )
            : (fehler as Error),
        );
      }
    },
  });
}
