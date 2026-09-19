/**
 * Symbol und Kachelbild eines Spieltyps (Betreiber-Wunsch vom 19.09.2026).
 *
 * Bis hierher trugen die Kacheln im Assistenten und die Server-Karten die
 * Anfangsbuchstaben des Spiels. Der Vertrag kannte `iconUrl` und
 * `coverImageUrl` schon, nur setzte sie niemand – es gab keine Stelle zum
 * Hochladen. Diese hier ist es.
 *
 * **Ohne Bildbibliothek**, wie beim Profilbild: Zugeschnitten und verkleinert
 * wird im Browser (`ImageCropper`), das Backend prüft Typ, Größe und die
 * ersten Bytes. Ein Bildparser im Backend wäre eine bekannt gefährliche
 * Stelle und eine Abhängigkeit mehr.
 */

import { type ErrorCode } from '@palantir/contracts';
import { AppError } from '../../lib/app-error.js';
import { type GameTypeImageKind } from '../../db/schema/game-type-images.js';

export { type GameTypeImageKind } from '../../db/schema/game-type-images.js';

export class GameTypeImageError extends AppError {
  constructor(code: ErrorCode, message?: string) {
    super(code, message);
    this.name = 'GameTypeImageError';
  }
}

export function isGameTypeImageError(error: unknown): error is GameTypeImageError {
  return error instanceof GameTypeImageError;
}

/** Erlaubte Formate – die drei, die jeder Browser zuverlässig zeichnet. */
export const GAME_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export type GameImageMimeType = (typeof GAME_IMAGE_MIME_TYPES)[number];

/**
 * Obergrenzen je Stelle.
 *
 * Das Symbol steht in 44 Pixeln, das Kachelbild über die Breite einer Karte.
 * Nach dem Zuschneiden im Browser liegt das eine bei wenigen Dutzend Kilobyte,
 * das andere bei ein paar Hundert; die Grenzen lassen Luft, ohne dass jemand
 * ein Foto in Rohgröße in die Datenbank legt.
 */
export const GAME_IMAGE_MAX_BYTES: Record<GameTypeImageKind, number> = {
  icon: 512 * 1024,
  cover: 2 * 1024 * 1024,
};

/** Kantenlängen, auf die der Browser zuschneidet – hier zur Dokumentation. */
export const GAME_IMAGE_EDGE_PIXELS: Record<GameTypeImageKind, { width: number; height: number }> =
  {
    icon: { width: 512, height: 512 },
    cover: { width: 1280, height: 720 },
  };

/** Erkennungsmerkmale am Dateianfang, je erlaubtem Typ. */
const SIGNATURES: Record<GameImageMimeType, (bytes: Buffer) => boolean> = {
  'image/png': (bytes) =>
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47,
  'image/jpeg': (bytes) =>
    bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  'image/webp': (bytes) =>
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP',
};

export function isGameImageMimeType(value: string): value is GameImageMimeType {
  return (GAME_IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

export function isGameTypeImageKind(value: string): value is GameTypeImageKind {
  return value === 'icon' || value === 'cover';
}

/**
 * Nimmt ein hochgeladenes Bild an – oder sagt, warum nicht.
 *
 * Der gemeldete Typ allein ist eine Behauptung des Browsers; ein Programm, das
 * sich als `image/png` ausgibt, fällt an der Signatur auf.
 */
export function pruefeGameImage(input: {
  kind: GameTypeImageKind;
  mimeType: string;
  data: Buffer;
}): { mimeType: GameImageMimeType; data: Buffer } {
  if (!isGameImageMimeType(input.mimeType)) {
    throw new GameTypeImageError(
      'UNSUPPORTED_MEDIA_TYPE',
      `Nur ${GAME_IMAGE_MIME_TYPES.join(', ')} sind als Bild erlaubt.`,
    );
  }

  if (input.data.length === 0) {
    throw new GameTypeImageError('VALIDATION_FAILED', 'Das Bild ist leer.');
  }

  if (input.data.length > GAME_IMAGE_MAX_BYTES[input.kind]) {
    throw new GameTypeImageError('FILE_TOO_LARGE');
  }

  if (!SIGNATURES[input.mimeType](input.data)) {
    throw new GameTypeImageError(
      'UNSUPPORTED_MEDIA_TYPE',
      'Die Datei ist kein Bild des angegebenen Formats.',
    );
  }

  return { mimeType: input.mimeType, data: input.data };
}

export interface GameTypeImageRecord {
  readonly gameTypeId: string;
  readonly kind: GameTypeImageKind;
  readonly data: Buffer;
  readonly mimeType: string;
  readonly updatedAt: Date;
}

export interface GameTypeImageRepository {
  find(gameTypeId: string, kind: GameTypeImageKind): Promise<GameTypeImageRecord | null>;
  /** Zeitstempel aller vorhandenen Bilder – Grundlage der Adressen im DTO. */
  listUpdatedAt(): Promise<Map<string, Partial<Record<GameTypeImageKind, Date>>>>;
  save(input: {
    gameTypeId: string;
    kind: GameTypeImageKind;
    data: Buffer;
    mimeType: string;
    uploadedById: string | null;
  }): Promise<GameTypeImageRecord>;
  remove(gameTypeId: string, kind: GameTypeImageKind): Promise<boolean>;
}

export interface GameTypeImageService {
  find(gameTypeId: string, kind: GameTypeImageKind): Promise<GameTypeImageRecord | null>;
  /**
   * Adressen je Spieltyp, fertig für das DTO.
   *
   * Mit `?v=` am Ende: Der Browser darf das Bild lange behalten, bekommt aber
   * nach einem Austausch sofort das neue – ohne den Zwischenspeicher zu
   * leeren.
   */
  urls(): Promise<Map<string, { iconUrl: string | null; coverImageUrl: string | null }>>;
  save(input: {
    gameTypeId: string;
    kind: GameTypeImageKind;
    mimeType: string;
    data: Buffer;
    uploadedById: string | null;
  }): Promise<GameTypeImageRecord>;
  remove(gameTypeId: string, kind: GameTypeImageKind): Promise<void>;
}

export interface GameTypeImageDependencies {
  readonly repository: GameTypeImageRepository;
  /** Gibt es diesen Spieltyp überhaupt? Verhindert Bilder für Tippfehler. */
  readonly kennt: (gameTypeId: string) => boolean;
}

/** Adresse eines Bildes, wie sie im DTO steht. */
export function gameImageUrl(gameTypeId: string, kind: GameTypeImageKind, updatedAt: Date): string {
  return `/api/game-types/${encodeURIComponent(gameTypeId)}/images/${kind}?v=${String(
    updatedAt.getTime(),
  )}`;
}

export function createGameTypeImageService(deps: GameTypeImageDependencies): GameTypeImageService {
  function requireGameType(gameTypeId: string): void {
    if (!deps.kennt(gameTypeId)) {
      throw new GameTypeImageError('NOT_FOUND', 'Diesen Spieltyp gibt es nicht.');
    }
  }

  return {
    async find(gameTypeId, kind) {
      return deps.repository.find(gameTypeId, kind);
    },

    async urls() {
      const stand = await deps.repository.listUpdatedAt();
      const adressen = new Map<string, { iconUrl: string | null; coverImageUrl: string | null }>();

      for (const [gameTypeId, zeiten] of stand) {
        adressen.set(gameTypeId, {
          iconUrl: zeiten.icon === undefined ? null : gameImageUrl(gameTypeId, 'icon', zeiten.icon),
          coverImageUrl:
            zeiten.cover === undefined ? null : gameImageUrl(gameTypeId, 'cover', zeiten.cover),
        });
      }

      return adressen;
    },

    async save(input) {
      requireGameType(input.gameTypeId);

      const geprueft = pruefeGameImage({
        kind: input.kind,
        mimeType: input.mimeType,
        data: input.data,
      });

      return deps.repository.save({
        gameTypeId: input.gameTypeId,
        kind: input.kind,
        data: geprueft.data,
        mimeType: geprueft.mimeType,
        uploadedById: input.uploadedById,
      });
    },

    async remove(gameTypeId, kind) {
      requireGameType(gameTypeId);

      // Ein bereits fehlendes Bild ist kein Fehler: Das Ziel ist „kein Bild".
      await deps.repository.remove(gameTypeId, kind);
    },
  };
}
