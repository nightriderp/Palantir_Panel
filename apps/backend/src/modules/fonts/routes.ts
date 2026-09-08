/**
 * Routen der Schriftverwaltung (Arbeitspaket S-2).
 *
 * Fünf Adressen:
 *
 * - `GET /public/fonts.css` – das erzeugte Stylesheet, **ohne Sitzung** (S-3).
 *   Alle `@font-face`-Regeln und die beiden CSS-Variablen der Auswahl in einem
 *   Aufruf; siehe `stylesheet.ts` für das Warum.
 * - `GET /api/fonts` – die Liste, für **jedes angemeldete Konto**. Sie ist
 *   keine Verwaltungsansicht: Die Oberfläche baut daraus die
 *   `@font-face`-Regeln, die jede Seite braucht. Sie deshalb wie die
 *   Instanz-Einstellungen hinter `user.manage` zu legen hieße, dass die
 *   Oberfläche für alle anderen ohne Schrift dasteht.
 * - `GET /api/fonts/:id/file` – die Datei, **ohne Sitzung**. Begründung unten.
 * - `POST /api/admin/fonts` – Upload, `user.manage`.
 * - `DELETE /api/admin/fonts/:id` – Löschung, `user.manage`.
 *
 * ## Warum die Datei ohne Sitzung erreichbar ist
 *
 * Eine Schriftdatei wird nicht vom Anwendungscode geholt, sondern vom Browser
 * beim Auswerten der `@font-face`-Regel – und dieser Abruf läuft
 * quellübergreifend **anonym** (CORS-Modus `anonymous`, keine Cookies), solange
 * das Stylesheet nicht ausdrücklich `crossorigin="use-credentials"` verlangt.
 * Panel und API liegen auf verschiedenen Subdomains (Pflichtenheft §12.1), also
 * käme jeder Schriftabruf ohne Sitzungs-Cookie an und die Antwort wäre
 * `AUTH_REQUIRED`: Die Oberfläche bliebe dauerhaft ohne ihre Schriften.
 * Hinzu kommt die Anmeldeseite selbst – dort gibt es noch keine Sitzung, die
 * Seite soll aber schon in der Schrift der Instanz stehen.
 *
 * Preisgegeben wird dadurch eine frei lizenzierte Schriftdatei an jemanden, der
 * ihre UUID bereits kennt. Die Liste der Kennungen bleibt angemeldeten Konten
 * vorbehalten.
 */

import { type ApiResponse, FONT_UPLOAD_MAX_SIZE_BYTES, ok } from '@palantir/contracts';
import { fontIdSchema, uploadFontInputSchema } from '@palantir/validation';
import { type MultipartFile } from '@fastify/multipart';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { attachmentContentDisposition } from '../../lib/content-disposition.js';
import { contextFrom } from '../admin/index.js';
import { isRbacError, replyWithErrorCode, requireActor, requirePermission } from '../rbac/index.js';
import { FontError, isFontError } from './errors.js';
import { type FontService, type UploadedFile } from './service.js';
import { FONT_FILE_ROUTE_PATH, FONT_STYLESHEET_ROUTE_PATH } from './stylesheet.js';

const fontIdParamsSchema = z.object({ id: fontIdSchema });

/**
 * Spielraum für den Formular-Rahmen um die Datei herum.
 *
 * `Content-Length` zählt das ganze Formular (Trenner, Feldnamen, `label`,
 * `family`), die Grenze gilt nur für die Datei. Dieselbe Überlegung wie beim
 * Datei-Manager in B3.
 */
const MULTIPART_ENVELOPE_ALLOWANCE_BYTES = 16 * 1024;

/** Textfeld aus einem Multipart-Formular; `undefined`, wenn es fehlt. */
function multipartField(fields: MultipartFile['fields'], name: string): string | undefined {
  const feld = fields[name];
  const eintrag = Array.isArray(feld) ? feld[0] : feld;

  if (eintrag === undefined || eintrag.type !== 'field') {
    return undefined;
  }

  return typeof eintrag.value === 'string' ? eintrag.value : undefined;
}

/** `"true"` → `true`, `"false"` → `false`, alles andere → `undefined`. */
function multipartFlag(fields: MultipartFile['fields'], name: string): boolean | undefined {
  const wert = multipartField(fields, name);

  return wert === undefined ? undefined : wert === 'true';
}

/**
 * Gewichtsbereich aus zwei Formularfeldern.
 *
 * `multipart/form-data` kennt nur Zeichenketten; der Vertrag beschreibt den
 * Bereich als Objekt. Übertragen wird er deshalb als `weightMin`/`weightMax`
 * und hier wieder zusammengesetzt – geprüft wird anschließend gegen
 * `uploadFontInputSchema`, nicht hier. Fehlt eines der beiden Felder, gilt der
 * Bereich als nicht angegeben.
 */
function multipartWeightRange(
  fields: MultipartFile['fields'],
): { min: number; max: number } | undefined {
  const min = multipartField(fields, 'weightMin');
  const max = multipartField(fields, 'weightMax');

  if (min === undefined || max === undefined) {
    return undefined;
  }

  return { min: Number(min), max: Number(max) };
}

/** Verdichtet die Zod-Fehler zu einer lesbaren Meldung. */
function describeValidationError(error: z.ZodError): string {
  return error.issues
    .map((issue) =>
      issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message,
    )
    .join('; ');
}

/** Antwortet im Envelope aus Pflichtenheft §5.1 – oder reicht weiter. */
async function replyWithError(reply: FastifyReply, error: unknown): Promise<void> {
  if (isFontError(error) || isRbacError(error)) {
    await replyWithErrorCode(reply, error.code, error.message);

    return;
  }

  if (error instanceof z.ZodError) {
    await replyWithErrorCode(reply, 'VALIDATION_FAILED', describeValidationError(error));

    return;
  }

  throw error;
}

async function handle<T>(
  reply: FastifyReply,
  run: () => Promise<T>,
): Promise<ApiResponse<T> | undefined> {
  try {
    return ok(await run());
  } catch (error: unknown) {
    await replyWithError(reply, error);

    return undefined;
  }
}

/**
 * Liest die hochgeladene Datei samt Formularfeldern.
 *
 * Die Grenze geht je Aufruf an `@fastify/multipart` und greift damit **vor**
 * dem Puffern: Mehr als `FONT_UPLOAD_MAX_SIZE_BYTES` wandert nie in den
 * Speicher, auch wenn die globale Multipart-Grenze aus `server.ts` höher liegt
 * (sie bedient den Datei-Manager mit ganz anderen Größen). Die feinere Grenze je
 * Format prüft anschließend der Dienst.
 */
async function readFontUpload(
  request: FastifyRequest,
): Promise<{ file: UploadedFile; fields: MultipartFile['fields'] }> {
  if (!request.isMultipart()) {
    throw new FontError(
      'VALIDATION_FAILED',
      'Der Upload muss als multipart/form-data gesendet werden.',
    );
  }

  const angekuendigt = Number(request.headers['content-length']);

  if (
    Number.isFinite(angekuendigt) &&
    angekuendigt > FONT_UPLOAD_MAX_SIZE_BYTES + MULTIPART_ENVELOPE_ALLOWANCE_BYTES
  ) {
    throw new FontError('FONT_FILE_TOO_LARGE');
  }

  // `throwFileSizeLimit: false`: Sonst wirft `toBuffer()` beim Abschneiden den
  // Bibliotheksfehler `FST_REQ_FILE_TOO_LARGE`; hier zählt allein `truncated`,
  // damit die Antwort den Code aus dem Schriften-Katalog trägt.
  const datei = await request.file({
    limits: { fileSize: FONT_UPLOAD_MAX_SIZE_BYTES },
    throwFileSizeLimit: false,
  });

  if (datei === undefined) {
    throw new FontError('VALIDATION_FAILED', 'Im Upload fehlt das Feld „file".');
  }

  const content = await datei.toBuffer();

  if (datei.file.truncated) {
    throw new FontError('FONT_FILE_TOO_LARGE');
  }

  return { file: { fileName: datei.filename, content }, fields: datei.fields };
}

export interface FontRouteOptions {
  readonly service: FontService;
}

export function registerFontRoutes(options: FontRouteOptions) {
  return async function register(app: FastifyInstance): Promise<void> {
    const { service } = options;

    app.get('/api/fonts', async (request, reply) =>
      // Kein `preHandler`-Guard, sondern `requireActor`: Verlangt wird eine
      // Sitzung, keine bestimmte Berechtigung – und auch keine Freischaltung,
      // denn auch ein wartendes Konto sieht die Oberfläche.
      handle(reply, async () => {
        requireActor(request);

        return service.list(contextFrom(request));
      }),
    );

    /*
     * Das erzeugte Stylesheet – **ohne Sitzung**, wie `/public/stats`.
     *
     * Antwortet bewusst nicht im Envelope aus Pflichtenheft §5.1: Empfänger ist
     * nicht der Anwendungscode, sondern der CSS-Parser des Browsers, und der
     * kennt nur `text/css`. Dieselbe Ausnahme wie bei der Auslieferung der
     * Schriftdatei eine Route weiter unten.
     *
     * **Zwischenspeicher.** `immutable` wäre hier falsch: Das CSS ändert sich,
     * sobald der Administrator eine andere Schrift wählt oder eine hochlädt.
     * Deshalb ein kurzes `max-age` plus `ETag` – innerhalb einer Minute fragt
     * der Browser gar nicht erst nach, danach fragt er und bekommt in aller
     * Regel ein leeres 304 statt des ganzen Stylesheets.
     */
    app.get(FONT_STYLESHEET_ROUTE_PATH, async (request, reply) => {
      const { css, fingerprint } = await service.stylesheet();
      const etag = `"${fingerprint}"`;

      if (request.headers['if-none-match'] === etag) {
        await reply.header('etag', etag).status(304).send();

        return;
      }

      await reply
        .header('content-type', 'text/css; charset=utf-8')
        .header('x-content-type-options', 'nosniff')
        .header('etag', etag)
        .header('cache-control', 'public, max-age=60, must-revalidate')
        .send(css);
    });

    app.get(FONT_FILE_ROUTE_PATH, async (request, reply) => {
      try {
        // Die Kennung wird gegen das Vertragsschema geprüft, **bevor** sie
        // irgendwo in die Nähe eines Pfades kommt: erlaubt sind ausschließlich
        // eine UUID und `bundled-<slug>`. Ein `../` scheitert damit hier – die
        // zweite Schranke steht in `storage.ts` (`resolveInside`).
        const { id } = fontIdParamsSchema.parse(request.params);
        const datei = await service.file(id);

        const etag = `"${datei.fingerprint}"`;

        if (request.headers['if-none-match'] === etag) {
          await reply.header('etag', etag).status(304).send();

          return;
        }

        await reply
          .header('content-type', datei.mimeType)
          // `nosniff` zusammen mit `attachment`: Die Datei wird nie als
          // Dokument im Ursprung der API ausgeführt, egal was jemand in sie
          // hineinschreibt. Das Laden über `@font-face` bleibt davon
          // unberührt – der CSS-Abruf wertet `Content-Disposition` nicht aus.
          .header('x-content-type-options', 'nosniff')
          .header('content-disposition', attachmentContentDisposition(datei.fileName))
          .header('etag', etag)
          .header(
            'cache-control',
            datei.immutable
              ? 'public, max-age=31536000, immutable'
              : 'public, max-age=86400, must-revalidate',
          )
          .send(datei.content);
      } catch (error: unknown) {
        await replyWithError(reply, error);
      }
    });

    app.post(
      '/api/admin/fonts',
      { preHandler: requirePermission('user.manage') },
      async (request, reply) =>
        handle(reply, async () => {
          const { file, fields } = await readFontUpload(request);
          const input = uploadFontInputSchema.parse({
            label: multipartField(fields, 'label'),
            family: multipartField(fields, 'family'),
            variable: multipartFlag(fields, 'variable'),
            // Wie `variable` hier und nicht im Schema umgewandelt: Das Schema
            // verlangt einen echten Schalter, sonst würde aus jedem beliebigen
            // Text stillschweigend „wahr".
            monospace: multipartFlag(fields, 'monospace'),
            weightRange: multipartWeightRange(fields),
          });

          return service.upload(contextFrom(request), input, file);
        }),
    );

    app.delete(
      '/api/admin/fonts/:id',
      { preHandler: requirePermission('user.manage') },
      async (request, reply) =>
        handle(reply, async () => {
          const { id } = fontIdParamsSchema.parse(request.params);
          await service.remove(contextFrom(request), id);

          return null;
        }),
    );
  };
}
