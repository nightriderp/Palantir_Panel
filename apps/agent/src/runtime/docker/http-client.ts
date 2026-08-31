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
 */

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
  readonly #timeoutMs: number;

  constructor(options: DockerHttpClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.#fetch = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
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

  #init(method: string, options: DockerRequestOptions, signal: AbortSignal): RequestInit {
    const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
    let body: RequestInit['body'];

    if (options.rawBody !== undefined) {
      headers['Content-Type'] = options.contentType ?? 'application/x-tar';
      // Uint8Array statt Buffer: BodyInit kennt Buffer typseitig nicht.
      body = new Uint8Array(options.rawBody);
    } else if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }

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
    let meldung = `Die Container-Engine antwortete mit HTTP ${antwort.status}.`;
    try {
      const koerper = (await antwort.json()) as DockerErrorBody;
      if (typeof koerper.message === 'string' && koerper.message.length > 0) {
        meldung = koerper.message;
      }
    } catch {
      // Antwort ohne verwertbaren JSON-Koerper - die Standardmeldung genuegt.
    }

    const details = { method, pfad, httpStatus: antwort.status };
    const code = codeFuerStatus(antwort.status, meldung, options.notFoundCode);
    return new ContainerRuntimeError(code, { message: meldung, details });
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

  /** Anfrage ohne verwertbaren Antwortkoerper. */
  async requestVoid(
    method: string,
    pfad: string,
    options: DockerRequestOptions = {},
  ): Promise<void> {
    const antwort = await this.#send(method, pfad, options, this.#signal(options));
    // Koerper leeren, damit die Verbindung wiederverwendet werden kann.
    await antwort.arrayBuffer().catch(() => undefined);
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
   * Oeffnet einen langlebigen Stream (Logs, Statistiken, Engine-Events).
   * Bewusst ohne Zeitlimit - beendet wird ueber `cancel()`.
   */
  async openStream(
    method: string,
    pfad: string,
    options: DockerRequestOptions = {},
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
