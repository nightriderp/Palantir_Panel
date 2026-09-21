/**
 * API-Client für die Demo-Bühne.
 *
 * Spricht dieselbe HTTP-Schnittstelle wie das Panel im Browser: Sitzungs-Cookie,
 * CSRF-Doppel-Cookie (`palantir_csrf` + `x-csrf-token`) und der ALTCHA-Nachweis
 * bei Registrierung und Anmeldung. Damit entsteht der Demo-Zustand auf demselben
 * Weg wie echter Betrieb – es gibt keinen zweiten Pfad ins Datenmodell, der
 * etwas zeigen könnte, das es so nicht gibt.
 */

import { createHash } from 'node:crypto';

const CSRF_COOKIE = 'palantir_csrf';
const CSRF_HEADER = 'x-csrf-token';

export class PanelClient {
  /** @param {string} basis Adresse der Backend-API, z. B. http://127.0.0.1:4000 */
  constructor(basis) {
    this.basis = basis.replace(/\/$/, '');
    /** @type {Map<string, string>} Cookie-Krug: Name → Wert */
    this.cookies = new Map();
    /** @type {{username: string, password: string} | null} */
    this.zugang = null;
  }

  get cookieHeader() {
    return [...this.cookies].map(([name, wert]) => `${name}=${wert}`).join('; ');
  }

  #cookiesUebernehmen(antwort) {
    for (const zeile of antwort.headers.getSetCookie?.() ?? []) {
      const [paar] = zeile.split(';');
      const index = paar.indexOf('=');
      if (index <= 0) continue;
      const name = paar.slice(0, index).trim();
      const wert = paar.slice(index + 1).trim();
      if (wert === '' || wert === 'deleted') this.cookies.delete(name);
      else this.cookies.set(name, wert);
    }
  }

  /**
   * Ein Aufruf gegen die API. Wirft bei jedem Misserfolg – eine Bühne, die
   * halb aufgebaut ist, fällt im Video auf, ein Abbruch hier nicht.
   *
   * **Mit einem Anlauf, die Sitzung zu erneuern.** Ein vollständiger
   * Aufnahmelauf dauert eine Dreiviertelstunde; das Zugangs-Token lebt
   * kürzer. Beim ersten Lauf brach die Aufnahme deshalb nach elf Szenen mit
   * `AUTH_REQUIRED` ab – nicht an einem Fehler im Panel, sondern an einer
   * abgelaufenen Anmeldung. Kommt eine 401 zurück, wird einmal über
   * `/auth/refresh` verlängert und der Aufruf wiederholt; klappt auch das
   * nicht, meldet sich der Klient mit den gemerkten Zugangsdaten neu an.
   */
  async ruf(methode, pfad, koerper, optionen = {}) {
    try {
      return await this.#ruf(methode, pfad, koerper, optionen);
    } catch (fehler) {
      if (!String(fehler.message).includes('(401)') || pfad.startsWith('/auth/')) throw fehler;

      const erneuert = await this.#ruf('POST', '/auth/refresh').catch(() => null);
      if (erneuert === null && this.zugang !== null) {
        await this.anmelden(this.zugang.username, this.zugang.password).catch(() => null);
      }
      return this.#ruf(methode, pfad, koerper, optionen);
    }
  }

  async #ruf(methode, pfad, koerper, { roh = false } = {}) {
    const kopf = { Accept: 'application/json' };
    if (this.cookies.size > 0) kopf.Cookie = this.cookieHeader;
    const csrf = this.cookies.get(CSRF_COOKIE);
    if (csrf) kopf[CSRF_HEADER] = csrf;
    if (koerper !== undefined) kopf['Content-Type'] = 'application/json';

    const antwort = await fetch(`${this.basis}${pfad}`, {
      method: methode,
      headers: kopf,
      ...(koerper === undefined ? {} : { body: JSON.stringify(koerper) }),
    });
    this.#cookiesUebernehmen(antwort);

    const text = await antwort.text();
    let hülle;
    try {
      hülle = JSON.parse(text);
    } catch {
      throw new Error(
        `${methode} ${pfad}: keine JSON-Antwort (${antwort.status}): ${text.slice(0, 200)}`,
      );
    }

    if (roh) return hülle;
    if (hülle.success !== true) {
      throw new Error(
        `${methode} ${pfad} fehlgeschlagen (${antwort.status}): ${JSON.stringify(hülle.error)}`,
      );
    }
    return hülle.data;
  }

  /**
   * Den ALTCHA-Nachweis erbringen: die Zahl finden, deren Hash zur Challenge
   * passt. Genau die Arbeit, die das Widget im Browser leistet.
   */
  async #altcha() {
    const aufgabe = await this.ruf('GET', '/auth/altcha/challenge');
    for (let zahl = 0; zahl <= aufgabe.maxnumber; zahl += 1) {
      const hash = createHash('sha256').update(`${aufgabe.salt}${zahl}`, 'utf8').digest('hex');
      if (hash === aufgabe.challenge) {
        return Buffer.from(
          JSON.stringify({
            algorithm: aufgabe.algorithm,
            challenge: aufgabe.challenge,
            salt: aufgabe.salt,
            number: zahl,
            signature: aufgabe.signature,
          }),
          'utf8',
        ).toString('base64');
      }
    }
    throw new Error('ALTCHA: keine Lösung im erlaubten Bereich gefunden.');
  }

  async registrieren(username, password, displayName) {
    return this.ruf('POST', '/auth/register', {
      username,
      password,
      altcha: await this.#altcha(),
      ...(displayName === undefined ? {} : { displayName }),
    });
  }

  async anmelden(username, password) {
    // Gemerkt für den Fall, dass die Sitzung mitten im Aufnahmelauf abläuft
    // und auch das Verlängern nicht mehr greift.
    this.zugang = { username, password };
    return this.#ruf('POST', '/auth/login', {
      username,
      password,
      altcha: await this.#altcha(),
    });
  }

  async sitzung() {
    return this.ruf('GET', '/auth/session');
  }
}
