/**
 * Container-Image holen (WORK_STATUS.md, Gefundener Punkt 111).
 *
 * Bis hierher hat der Agent nie ein Image geholt: `create()` rief allein
 * `/containers/create`, und fehlte das Image auf dem Homeserver, kam ein 404
 * zurueck – im Panel als „Das Container-Image ist auf dem Homeserver nicht
 * vorhanden." Jede neue Spiele-Definition haette damit von Hand auf jede Node
 * gezogen werden muessen.
 *
 * **Zugangsdaten:** Oeffentliche Images brauchen keine. Die eigenen Spiel-Images
 * liegen in einem privaten GHCR-Repository; dafuer erwartet die Engine den Kopf
 * `X-Registry-Auth`. Der Docker-CLI-Login auf der Node hilft hier nicht: Der
 * Agent spricht die Engine-API ueber den Socket-Proxy an, und die liest keine
 * Client-Konfiguration. Die Zugangsdaten kommen deshalb aus der Umgebung des
 * Agents (`AGENT_REGISTRY_*`) und werden nur an die Registry geschickt, zu der
 * sie gehoeren – ein Token fuer ghcr.io hat bei Docker Hub nichts verloren.
 *
 * **Fehler stehen im Stream, nicht im Status.** `/images/create` antwortet mit
 * HTTP 200 und meldet Fehlschlaege erst im Antwortkoerper. Wer nur den Status
 * prueft, haelt einen gescheiterten Zug fuer gelungen und scheitert erst beim
 * naechsten Schritt mit einer irrefuehrenden Meldung.
 */

import { ContainerRuntimeError } from '../errors.js';
import { type DockerHttpClient } from './http-client.js';

/** Zugang zu einer Registry, aus der Images geholt werden duerfen. */
export interface RegistryCredentials {
  /** Adresse der Registry, z. B. `ghcr.io`. */
  readonly server: string;
  readonly username: string;
  /** Passwort oder Token (bei GHCR ein PAT mit `read:packages`). */
  readonly password: string;
}

export interface PullImageOptions {
  readonly credentials?: RegistryCredentials | undefined;
  /** Frist fuer den gesamten Zug. Ein Spiel-Image bringt schnell Hunderte MB mit. */
  readonly timeoutMs: number;
}

/**
 * Image-Referenz in Name und Fassung zerlegen.
 *
 * `/images/create` erwartet beides getrennt. Der Doppelpunkt einer Portangabe
 * (`registry:5000/bild`) darf dabei nicht als Fassung durchgehen – deshalb wird
 * nur hinter dem letzten `/` gesucht.
 */
export function splitImageReference(image: string): { name: string; tag: string } {
  const letzterSchraegstrich = image.lastIndexOf('/');
  const doppelpunkt = image.indexOf(':', letzterSchraegstrich + 1);

  if (doppelpunkt === -1) {
    return { name: image, tag: 'latest' };
  }

  return { name: image.slice(0, doppelpunkt), tag: image.slice(doppelpunkt + 1) };
}

/**
 * Gehoert die Image-Referenz zu dieser Registry?
 *
 * Ohne Angabe einer Registry im Namen meint Docker die oeffentliche Bibliothek –
 * dorthin gehen keine Zugangsdaten.
 */
export function belongsToRegistry(image: string, server: string): boolean {
  return image.startsWith(`${server}/`);
}

/** Kopf `X-Registry-Auth`, wie die Engine ihn erwartet: Base64URL eines JSON-Objekts. */
function registryAuthHeader(credentials: RegistryCredentials): string {
  return Buffer.from(
    JSON.stringify({
      username: credentials.username,
      password: credentials.password,
      serveraddress: credentials.server,
    }),
    'utf8',
  ).toString('base64url');
}

/**
 * Meldet der Antwortstrom einen Fehlschlag?
 *
 * Der Koerper ist eine Folge von JSON-Objekten, eines je Zeile. Interessant ist
 * allein `error`; die Fortschrittszeilen werden verworfen.
 */
export function pullErrorFrom(body: string): string | null {
  for (const zeile of body.split('\n')) {
    const inhalt = zeile.trim();

    if (inhalt.length === 0) {
      continue;
    }

    try {
      const gelesen = JSON.parse(inhalt) as { error?: unknown };

      if (typeof gelesen.error === 'string' && gelesen.error.length > 0) {
        return gelesen.error;
      }
    } catch {
      // Keine verwertbare Zeile – der Zug gilt deshalb nicht als gescheitert.
    }
  }

  return null;
}

/**
 * Holt ein Image auf die Node.
 *
 * Ist es bereits da, holt die Engine nur die fehlenden Schichten – der Aufruf
 * ist damit auch als Wiederholung guenstig und braucht keine Vorabpruefung.
 */
export async function pullImage(
  client: DockerHttpClient,
  image: string,
  options: PullImageOptions,
): Promise<void> {
  const { name, tag } = splitImageReference(image);
  const zugang =
    options.credentials && belongsToRegistry(image, options.credentials.server)
      ? { 'X-Registry-Auth': registryAuthHeader(options.credentials) }
      : undefined;

  const antwort = await client.requestRaw('POST', '/images/create', {
    query: { fromImage: name, tag },
    ...(zugang === undefined ? {} : { headers: zugang }),
    timeoutMs: options.timeoutMs,
  });

  const fehler = pullErrorFrom(await antwort.text());

  if (fehler !== null) {
    throw new ContainerRuntimeError('IMAGE_NOT_FOUND', {
      message: `Das Image „${image}" konnte nicht geholt werden: ${fehler}`,
      details: { image },
    });
  }
}
