/**
 * HTTP-Client fuer die Docker-Engine-API - **ausschliesslich ueber den
 * Docker-Socket-Proxy** (Pflichtenheft §2.3, §18).
 *
 * Der Agent spricht nie direkt mit `/var/run/docker.sock`. Die Basis-URL kommt
 * aus `DOCKER_SOCKET_PROXY_URL`; der Proxy gibt nur die tatsaechlich benoetigten
 * Endpunkte frei. Ein Unix-Socket-Transport ist hier bewusst nicht
 * implementiert, damit ein direkter Socket-Zugriff gar nicht erst moeglich ist.
 *
 * `fetch` ist injizierbar - so laufen die Tests der Docker-Implementierung ohne
 * laufenden Proxy.
 *
 * **Streams laufen ueber `node:http`, nicht ueber `fetch` (Fundpunkt 189).**
 * Nodes `fetch` (undici) bricht einen Antwortkoerper ab, auf dem 300 s lang
 * nichts ankommt (`bodyTimeout`), und diese Frist laesst sich ohne `undici` als
 * eigene Abhaengigkeit nicht abschalten. Fuer `/events` - ein Strom, der
 * stundenlang schweigen darf - riss die Verbindung deshalb alle fuenf Minuten
 * mit `UND_ERR_BODY_TIMEOUT`; der Wiederaufbau fing es, aber mit Laerm im Log
 * und einem kurzen Loch, in dem ein Container-Ereignis erst der Abgleich
 * nachholte. `node:http` kennt keine solche Frist. Einzelne Anfragen bleiben
 * bei `fetch`; mit injiziertem `fetch` (Tests) laufen auch die Streams darueber.
 */

import http from 'node:http';
import https from 'node:https';
import { ContainerRuntimeError, type ContainerRuntimeErrorCode } from '../errors.js';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface DockerHttpClientOptions {
  /** Basis-URL des Docker-Socket-Proxys, z. B. `http://127.0.0.1:2375`. */
  readonly baseUrl: string;
  /** Ersatz fuer `globalThis.fetch` (Tests). */
  readonly fetchImpl?: FetchLike;
  /** Zeitlimit fuer einzelne Anfragen ohne Stream. */
  readonly requestTimeoutMs?: number;
}

export interface DockerRequestOptions {
  readonly query?: Readonly<Record<string, string | number | boolean | undefined>>;
  readonly body?: unknown;
  /** Roher Anfragekoerper (TAR-Upload). Schliesst `body` aus. */
  readonly rawBody?: Buffer;
  readonly contentType?: string;
  /**
   * Fehlercode bei HTTP 404. Vorgabe `CONTAINER_NOT_FOUND` - beim Anlegen eines
   * Containers bedeutet 404 dagegen ein fehlendes Image.
   */
  readonly notFoundCode?: ContainerRuntimeErrorCode;
  /** HTTP-Status, die als Erfolg gelten (z. B. 304 "laeuft bereits"). */
  readonly tolerateStatus?: readonly number[];
  /** Zusaetzliche Kopfzeilen, z. B. `X-Registry-Auth` beim Holen eines Images. */
  readonly headers?: Readonly<Record<string, string>>;
  /**
   * Abweichende Frist fuer diese eine Anfrage.
   *
   * Das Holen eines Images dauert Minuten und sprengt die uebliche Frist; ein
   * Container zu starten dagegen nicht. Deshalb je Anfrage statt global
   * grosszuegig.
   */
  readonly timeoutMs?: number;
}

export interface DockerStream {
  readonly body: AsyncIterable<Uint8Array>;
  /** Bricht den Stream serverseitig ab und gibt die Verbindung frei. */
  readonly cancel: () => void;
}

export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/**
 * Frist bis zu den Kopfzeilen eines Datenstroms (Fundpunkt 227).
 *
 * Gilt **nur** fuer den Aufbau: Sobald die Antwort begonnen hat, darf der
 * Koerper beliebig lange schweigen - ein Logstrom tut genau das. Dieselben
 * dreissig Sekunden wie fuer eine gewoehnliche Anfrage; wer so lange nicht
 * einmal mit Kopfzeilen antwortet, antwortet nicht mehr.
 */
export const STREAM_HEADER_TIMEOUT_MS = DEFAULT_REQUEST_TIMEOUT_MS;

/** Macht aus einem Web-ReadableStream ein `AsyncIterable`, ohne auf Node-Interna zu bauen. */
export async function* streamToAsyncIterable(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value !== undefined) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

interface DockerErrorBody {
  readonly message?: string;
}

export class DockerHttpClient {
  readonly #baseUrl: string;
  readonly #fetch: FetchLike;
  /** Injiziertes `fetch` (Tests): Dann gehen auch die Streams darueber. */
  readonly #fetchInjiziert: boolean;
  readonly #timeoutMs: number;

  constructor(options: DockerHttpClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.#fetch = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.#fetchInjiziert = options.fetchImpl !== undefined;
    this.#timeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  #url(pfad: string, query?: DockerRequestOptions['query']): string {
    const params = new URLSearchParams();
    for (const [key, wert] of Object.entries(query ?? {})) {
      if (wert !== undefined) params.set(key, String(wert));
    }
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    return `${this.#baseUrl}${pfad}${suffix}`;
  }

  /** Kopfzeilen und Koerper einer Anfrage - fuer `fetch` und `node:http` gleich. */
  #kopfUndKoerper(options: DockerRequestOptions): {
    headers: Record<string, string>;
    body: string | Uint8Array | undefined;
  } {
    const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
    let body: string | Uint8Array | undefined;

    if (options.rawBody !== undefined) {
      headers['Content-Type'] = options.contentType ?? 'application/x-tar';
      // Uint8Array statt Buffer: BodyInit kennt Buffer typseitig nicht.
      body = new Uint8Array(options.rawBody);
    } else if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }

    return { headers, body };
  }

  #init(method: string, options: DockerRequestOptions, signal: AbortSignal): RequestInit {
    const { headers, body } = this.#kopfUndKoerper(options);

    return { method, headers, body, signal };
  }

  async #send(
    method: string,
    pfad: string,
    options: DockerRequestOptions,
    signal: AbortSignal,
  ): Promise<Response> {
    let antwort: Response;
    try {
      antwort = await this.#fetch(
        this.#url(pfad, options.query),
        this.#init(method, options, signal),
      );
    } catch (ursache) {
      throw new ContainerRuntimeError('RUNTIME_UNAVAILABLE', {
        message: 'Der Docker-Socket-Proxy ist nicht erreichbar.',
        cause: ursache,
        details: { method, pfad },
      });
    }

    if (antwort.ok || (options.tolerateStatus ?? []).includes(antwort.status)) {
      return antwort;
    }

    throw await this.#fehlerAusAntwort(antwort, options, method, pfad);
  }

  async #fehlerAusAntwort(
    antwort: Response,
    options: DockerRequestOptions,
    method: string,
    pfad: string,
  ): Promise<ContainerRuntimeError> {
    const text = await antwort.text().catch(() => '');

    return fehlerAusKoerper(antwort.status, text, options, method, pfad);
  }

  /** Frist dieser Anfrage – die uebliche, sofern keine eigene mitgegeben wurde. */
  #signal(options: DockerRequestOptions): AbortSignal {
    return AbortSignal.timeout(options.timeoutMs ?? this.#timeoutMs);
  }

  /** Anfrage mit JSON-Antwort. */
  async requestJson<T>(
    method: string,
    pfad: string,
    options: DockerRequestOptions = {},
  ): Promise<T> {
    const antwort = await this.#send(method, pfad, options, this.#signal(options));
    return (await antwort.json()) as T;
  }

  /**
   * Anfrage ohne verwertbaren Antwortkoerper.
   *
   * Rueckgabe ist der HTTP-Status: Wer `tolerateStatus` nutzt, muss die
   * geduldeten Faelle auseinanderhalten koennen - ein 304 beim Stoppen heisst
   * "war schon gestoppt", und darauf folgt kein `die`-Event.
   */
  async requestVoid(
    method: string,
    pfad: string,
    options: DockerRequestOptions = {},
  ): Promise<number> {
    const antwort = await this.#send(method, pfad, options, this.#signal(options));
    // Koerper leeren, damit die Verbindung wiederverwendet werden kann.
    await antwort.arrayBuffer().catch(() => undefined);
    return antwort.status;
  }

  /**
   * Anfrage, bei der nur die Antwort-Header interessieren (`HEAD` auf
   * `/archive`, um Groesse und Typ einer Datei zu erfahren, bevor sie geladen wird).
   */
  async requestRaw(
    method: string,
    pfad: string,
    options: DockerRequestOptions = {},
  ): Promise<Response> {
    return this.#send(method, pfad, options, this.#signal(options));
  }

  /** Anfrage, deren Antwort vollstaendig als Puffer gelesen wird (TAR-Download, Exec-Ausgabe). */
  async requestBuffer(
    method: string,
    pfad: string,
    options: DockerRequestOptions = {},
  ): Promise<Buffer> {
    const antwort = await this.#send(method, pfad, options, this.#signal(options));
    return Buffer.from(await antwort.arrayBuffer());
  }

  /**
   * Oeffnet einen langlebigen Stream (Logs, Statistiken, Engine-Events,
   * Exec-Ausgabe). Bewusst ohne Zeitlimit - beendet wird ueber `cancel()`.
   *
   * Ueber `node:http` (siehe Kopf der Datei, Fundpunkt 189); nur mit
   * injiziertem `fetch` ueber diesen - so bleiben die Tests der
   * Docker-Implementierung bei ihrem Stub.
   */
  async openStream(
    method: string,
    pfad: string,
    options: DockerRequestOptions = {},
  ): Promise<DockerStream> {
    if (this.#fetchInjiziert) {
      return this.#openFetchStream(method, pfad, options);
    }

    return this.#openNodeStream(method, pfad, options);
  }

  async #openFetchStream(
    method: string,
    pfad: string,
    options: DockerRequestOptions,
  ): Promise<DockerStream> {
    const controller = new AbortController();
    const antwort = await this.#send(method, pfad, options, controller.signal);

    if (antwort.body === null) {
      throw new ContainerRuntimeError('RUNTIME_ERROR', {
        message: 'Die Container-Engine lieferte keinen Datenstrom.',
        details: { method, pfad },
      });
    }

    return {
      body: streamToAsyncIterable(antwort.body),
      cancel: () => {
        controller.abort();
      },
    };
  }

  #openNodeStream(
    method: string,
    pfad: string,
    options: DockerRequestOptions,
  ): Promise<DockerStream> {
    const ziel = new URL(this.#url(pfad, options.query));
    const { headers, body } = this.#kopfUndKoerper(options);
    const modul = ziel.protocol === 'https:' ? https : http;

    return new Promise<DockerStream>((resolve, reject) => {
      const nichtErreichbar = (ursache: unknown): ContainerRuntimeError =>
        new ContainerRuntimeError('RUNTIME_UNAVAILABLE', {
          message: 'Der Docker-Socket-Proxy ist nicht erreichbar.',
          cause: ursache,
          details: { method, pfad },
        });

      /*
       * Keine Frist fuer **Stille im Koerper** - das ist der ganze Grund fuer
       * diesen Weg: Ein Logstrom darf stundenlang schweigen.
       *
       * Fuer den **Aufbau** gilt das nicht (Fundpunkt 227). Antwortet der
       * Socket-Proxy gar nicht - Verbindung angenommen, aber keine Kopfzeilen -,
       * wurde diese Promise weder erfuellt noch abgelehnt. Der Aufrufer wartete
       * fuer immer, und im Agent blieb die Befehls-Warteschlange dieses Servers
       * dauerhaft haengen (siehe `raeumeBefehlsspuren`).
       *
       * Die Frist laeuft nur bis zu den Kopfzeilen und wird dort geloescht.
       */
      const aufbauFrist = setTimeout(() => {
        anfrage.destroy(
          new ContainerRuntimeError('RUNTIME_UNAVAILABLE', {
            message: 'Der Docker-Socket-Proxy hat den Datenstrom nicht begonnen.',
            details: { method, pfad, fristMs: STREAM_HEADER_TIMEOUT_MS },
          }),
        );
      }, STREAM_HEADER_TIMEOUT_MS);
      const anfrage = modul.request(ziel, { method, headers }, (antwort) => {
        clearTimeout(aufbauFrist);
        const status = antwort.statusCode ?? 0;
        const geduldet = (options.tolerateStatus ?? []).includes(status);

        if ((status >= 200 && status < 300) || geduldet) {
          // Nach dem Abbruch hoert niemand mehr zu; ohne diesen Zuhoerer waere
          // das 'error'-Ereignis von destroy() unbehandelt und riss den Agent.
          antwort.on('error', () => undefined);
          resolve({
            body: antwort as AsyncIterable<Uint8Array>,
            cancel: () => {
              // Mit `AbortError`, damit die Leser den gewollten Abbruch von einem
              // Netzfehler unterscheiden (`istAbbruch` in der Runtime) - genau
              // wie `AbortController.abort()` beim fetch-Weg.
              antwort.destroy(abbruchFehler());
              anfrage.destroy();
            },
          });

          return;
        }

        // Fehlerantwort: Koerper einsammeln und in den Katalog uebersetzen.
        const teile: Buffer[] = [];
        antwort.on('data', (teil: Buffer) => teile.push(teil));
        antwort.on('error', (ursache) => reject(nichtErreichbar(ursache)));
        antwort.on('end', () => {
          reject(
            fehlerAusKoerper(status, Buffer.concat(teile).toString('utf8'), options, method, pfad),
          );
        });
      });

      anfrage.on('error', (ursache: unknown) => {
        clearTimeout(aufbauFrist);
        // Der Abbruch durch die Frist traegt bereits den passenden Fehler.
        reject(ursache instanceof ContainerRuntimeError ? ursache : nichtErreichbar(ursache));
      });

      if (body !== undefined) {
        anfrage.write(body);
      }

      anfrage.end();
    });
  }
}

/** Fehler, den ein gewollter Abbruch in den Strom gibt - erkennbar am Namen. */
function abbruchFehler(): Error {
  const fehler = new Error('Der Datenstrom wurde abgebrochen.');
  fehler.name = 'AbortError';

  return fehler;
}

/**
 * Uebersetzt eine Fehlerantwort der Engine in den Katalog. Docker antwortet
 * mit `{ "message": "..." }`; fehlt das, bleibt der HTTP-Status als Meldung.
 */
function fehlerAusKoerper(
  status: number,
  text: string,
  options: DockerRequestOptions,
  method: string,
  pfad: string,
): ContainerRuntimeError {
  let meldung = `Die Container-Engine antwortete mit HTTP ${status}.`;
  try {
    const koerper = JSON.parse(text) as DockerErrorBody;
    if (typeof koerper.message === 'string' && koerper.message.length > 0) {
      meldung = koerper.message;
    }
  } catch {
    // Antwort ohne verwertbaren JSON-Koerper - die Standardmeldung genuegt.
  }

  const details = { method, pfad, httpStatus: status };
  const code = codeFuerStatus(status, meldung, options.notFoundCode);
  return new ContainerRuntimeError(code, { message: meldung, details });
}

function codeFuerStatus(
  status: number,
  meldung: string,
  notFoundCode: ContainerRuntimeErrorCode | undefined,
): ContainerRuntimeErrorCode {
  if (status === 404) {
    return notFoundCode ?? 'CONTAINER_NOT_FOUND';
  }
  if (status === 409) {
    return /already in use|name.*conflict/i.test(meldung)
      ? 'CONTAINER_NAME_CONFLICT'
      : 'CONTAINER_STATE_CONFLICT';
  }
  if (status === 503 || status === 502 || status === 504) {
    return 'RUNTIME_UNAVAILABLE';
  }
  return 'RUNTIME_ERROR';
}
