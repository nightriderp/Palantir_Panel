/**
 * Musik der Spielhalle (Admin-Seite „Arcade-Musik", Neubau 26.09.2026).
 *
 * Je Spiel lassen sich Stücke hochladen und eines davon aktivieren. Ohne
 * aktives Stück spielt die Oberfläche die mitgelieferte, im Browser erzeugte
 * Melodie. Gespeichert wird in `bytea` wie bei den Spielbildern
 * (`game-type-images`) – ein paar Megabyte je Stück, und die Sicherung der
 * Panel-Datenbank nimmt sie gleich mit.
 *
 * **Der Typ kommt aus den ersten Bytes, nicht vom Browser.** Ein als
 * `audio/mpeg` angekündigtes HTML-Dokument würde sonst unter der Adresse des
 * Panels ausgeliefert (`nosniff` hilft nur, wenn der Typ stimmt).
 */

import {
  ARCADE_TRACK_MAX_BYTES,
  type ArcadeActiveTracksDto,
  type ArcadeGameId,
  type ArcadeTrackDto,
  type ArcadeTrackListDto,
  type ArcadeTrackMimeType,
} from '@palantir/contracts';
import { ArcadeError } from './errors.js';

/**
 * Erkennt MP3, OGG und WAV an den ersten Bytes; `null` bei allem anderen.
 *
 * - MP3: ID3-Kopf („ID3") oder direkt ein MPEG-Frame (11 gesetzte Sync-Bits,
 *   `0xFF` und oberste drei Bits des zweiten Bytes).
 * - OGG: „OggS".
 * - WAV: „RIFF" … „WAVE" (Bytes 8–11).
 */
export function detectAudioMimeType(data: Uint8Array): ArcadeTrackMimeType | null {
  const ascii = (start: number, text: string): boolean =>
    data.length >= start + text.length &&
    [...text].every((char, i) => data[start + i] === char.charCodeAt(0));

  if (ascii(0, 'ID3')) return 'audio/mpeg';
  if (data.length >= 2 && data[0] === 0xff && ((data[1] ?? 0) & 0xe0) === 0xe0) return 'audio/mpeg';
  if (ascii(0, 'OggS')) return 'audio/ogg';
  if (ascii(0, 'RIFF') && ascii(8, 'WAVE')) return 'audio/wav';

  return null;
}

export interface ArcadeTrackRecord {
  id: string;
  gameId: ArcadeGameId;
  title: string;
  mimeType: ArcadeTrackMimeType;
  sizeBytes: number;
  isActive: boolean;
  uploadedAt: Date;
  uploadedByDisplayName: string | null;
}

export interface ArcadeTrackAudio {
  id: string;
  mimeType: ArcadeTrackMimeType;
  data: Buffer;
}

export interface ArcadeTrackRepository {
  list(): Promise<ArcadeTrackRecord[]>;
  listActive(): Promise<Pick<ArcadeTrackRecord, 'id' | 'gameId' | 'title' | 'mimeType'>[]>;
  audio(id: string): Promise<ArcadeTrackAudio | null>;
  insert(input: {
    gameId: ArcadeGameId;
    title: string;
    mimeType: ArcadeTrackMimeType;
    data: Buffer;
    uploadedBy: string | null;
  }): Promise<ArcadeTrackRecord>;
  /** Aktiviert das Stück und deaktiviert alle anderen desselben Spiels (eine Transaktion). */
  activate(id: string): Promise<boolean>;
  deactivate(id: string): Promise<boolean>;
  remove(id: string): Promise<boolean>;
}

export interface ArcadeTrackService {
  list(): Promise<ArcadeTrackListDto>;
  active(): Promise<ArcadeActiveTracksDto>;
  audio(id: string): Promise<ArcadeTrackAudio>;
  upload(input: {
    gameId: ArcadeGameId;
    title: string;
    data: Buffer;
    uploadedBy: string | null;
  }): Promise<ArcadeTrackDto>;
  activate(id: string): Promise<void>;
  deactivate(id: string): Promise<void>;
  remove(id: string): Promise<void>;
}

function toDto(record: ArcadeTrackRecord): ArcadeTrackDto {
  return {
    id: record.id,
    gameId: record.gameId,
    title: record.title,
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes,
    isActive: record.isActive,
    uploadedAt: record.uploadedAt.toISOString(),
    uploadedByDisplayName: record.uploadedByDisplayName,
  };
}

export function createArcadeTrackService(repository: ArcadeTrackRepository): ArcadeTrackService {
  function notFound(): never {
    throw new ArcadeError('ARCADE_TRACK_NOT_FOUND');
  }

  return {
    async list() {
      return { tracks: (await repository.list()).map(toDto), permissions: { canManage: true } };
    },

    async active() {
      const tracks: ArcadeActiveTracksDto['tracks'] = {};

      for (const track of await repository.listActive()) {
        tracks[track.gameId] = { id: track.id, title: track.title, mimeType: track.mimeType };
      }

      return { tracks };
    },

    async audio(id) {
      return (await repository.audio(id)) ?? notFound();
    },

    async upload(input) {
      if (input.data.length > ARCADE_TRACK_MAX_BYTES)
        throw new ArcadeError('ARCADE_TRACK_TOO_LARGE');

      const mimeType = detectAudioMimeType(input.data);

      if (mimeType === null) throw new ArcadeError('ARCADE_TRACK_INVALID');

      return toDto(await repository.insert({ ...input, mimeType }));
    },

    async activate(id) {
      if (!(await repository.activate(id))) notFound();
    },

    async deactivate(id) {
      if (!(await repository.deactivate(id))) notFound();
    },

    async remove(id) {
      if (!(await repository.remove(id))) notFound();
    },
  };
}
