import {
  type ArcadeActiveTracksDto,
  type ArcadeGameId,
  type ArcadeLeaderboardDto,
  type ArcadeRoomDto,
  type ArcadeRoomMoveInput,
  type ArcadeRoomSummaryDto,
  type ArcadeSeedDto,
  type ArcadeSubmitResultDto,
  type ArcadeTrackDto,
  type ArcadeTrackListDto,
  type CreateArcadeRoomInput,
  type JoinArcadeRoomInput,
  type SetArcadeRoomSeatInput,
  type SubmitArcadeRunInput,
} from '@palantir/contracts';
import { type ApiResult, apiRequest } from '@/lib/api/client';
import { apiUrl } from '@/lib/auth/api';

/**
 * REST-Endpunkte der Spielhalle (Pflichtenheft §17).
 *
 * Ergebnis ist immer der Response-Envelope aus Pflichtenheft §5.1 – hier wird
 * nichts ausgepackt und nichts geworfen; die Ansicht entscheidet, ob ein Fehler
 * Toast, Zeile oder Leerzustand wird.
 *
 * Seit dem Neubau (26.09.2026) schickt der Browser keinen Punktestand mehr,
 * sondern Startwert-Kennung plus Eingabeband bzw. Zugfolge. Den Stand rechnet
 * das Backend selbst nach – ein im Browser erfundener Rekord kommt so nicht in
 * die Bestenliste.
 */

const enc = encodeURIComponent;

// ---------------------------------------------------------------------------
// Bestenliste, Startwerte, Einsendungen
// ---------------------------------------------------------------------------

export function fetchArcadeLeaderboard(
  gameId: ArcadeGameId,
  signal?: AbortSignal,
): Promise<ApiResult<ArcadeLeaderboardDto>> {
  return apiRequest<ArcadeLeaderboardDto>(`/arcade/leaderboard/${gameId}`, { signal });
}

/** Startwert für eine gewertete Partie holen – einmal verwendbar. */
export function requestArcadeSeed(
  gameId: ArcadeGameId,
  signal?: AbortSignal,
): Promise<ApiResult<ArcadeSeedDto>> {
  return apiRequest<ArcadeSeedDto>(`/arcade/games/${gameId}/seed`, { method: 'POST', signal });
}

/** Band (Echtzeit) oder Zugfolge (rundenbasiert) zum Nachrechnen einreichen. */
export function submitArcadeRun(
  input: SubmitArcadeRunInput,
): Promise<ApiResult<ArcadeSubmitResultDto>> {
  return apiRequest<ArcadeSubmitResultDto>('/arcade/scores', { method: 'POST', json: input });
}

// ---------------------------------------------------------------------------
// Online-Räume
// ---------------------------------------------------------------------------

/** Offene, öffentliche Räume – eines Spiels oder aller Spiele. */
export function listArcadeRooms(
  gameId: ArcadeGameId | null,
  signal?: AbortSignal,
): Promise<ApiResult<ArcadeRoomSummaryDto[]>> {
  return apiRequest<ArcadeRoomSummaryDto[]>('/arcade/rooms', {
    signal,
    query: { gameId: gameId ?? undefined },
  });
}

export function createArcadeRoom(input: CreateArcadeRoomInput): Promise<ApiResult<ArcadeRoomDto>> {
  return apiRequest<ArcadeRoomDto>('/arcade/rooms', { method: 'POST', json: input });
}

export function fetchArcadeRoom(
  id: string,
  signal?: AbortSignal,
): Promise<ApiResult<ArcadeRoomDto>> {
  return apiRequest<ArcadeRoomDto>(`/arcade/rooms/${enc(id)}`, { signal });
}

export function fetchArcadeRoomByCode(
  code: string,
  signal?: AbortSignal,
): Promise<ApiResult<ArcadeRoomDto>> {
  return apiRequest<ArcadeRoomDto>(`/arcade/rooms/code/${enc(code)}`, { signal });
}

export function joinArcadeRoom(
  id: string,
  input: JoinArcadeRoomInput = {},
): Promise<ApiResult<ArcadeRoomDto>> {
  return apiRequest<ArcadeRoomDto>(`/arcade/rooms/${enc(id)}/join`, {
    method: 'POST',
    json: input,
  });
}

export function leaveArcadeRoom(id: string): Promise<ApiResult<ArcadeRoomDto>> {
  return apiRequest<ArcadeRoomDto>(`/arcade/rooms/${enc(id)}/leave`, { method: 'POST' });
}

export function startArcadeRoom(id: string): Promise<ApiResult<ArcadeRoomDto>> {
  return apiRequest<ArcadeRoomDto>(`/arcade/rooms/${enc(id)}/start`, { method: 'POST' });
}

export function rematchArcadeRoom(id: string): Promise<ApiResult<ArcadeRoomDto>> {
  return apiRequest<ArcadeRoomDto>(`/arcade/rooms/${enc(id)}/rematch`, { method: 'POST' });
}

export function setArcadeRoomSeat(
  id: string,
  input: SetArcadeRoomSeatInput,
): Promise<ApiResult<ArcadeRoomDto>> {
  return apiRequest<ArcadeRoomDto>(`/arcade/rooms/${enc(id)}/seats`, {
    method: 'POST',
    json: input,
  });
}

/** Zug vorschlagen; der Server wendet ihn an. 409 `ARCADE_ROOM_VERSION_CONFLICT` ⇒ neu laden. */
export function sendArcadeRoomMove(
  id: string,
  input: ArcadeRoomMoveInput,
): Promise<ApiResult<ArcadeRoomDto>> {
  return apiRequest<ArcadeRoomDto>(`/arcade/rooms/${enc(id)}/moves`, {
    method: 'POST',
    json: input,
  });
}

export function sendArcadeRoomChat(id: string, text: string): Promise<ApiResult<ArcadeRoomDto>> {
  return apiRequest<ArcadeRoomDto>(`/arcade/rooms/${enc(id)}/chat`, {
    method: 'POST',
    json: { text },
  });
}

/** Raum schließen. Liefert den geschlossenen Raum bzw. `null` (204). */
export function closeArcadeRoom(id: string): Promise<ApiResult<ArcadeRoomDto | null>> {
  return apiRequest<ArcadeRoomDto | null>(`/arcade/rooms/${enc(id)}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Musik
// ---------------------------------------------------------------------------

/** Alle hochgeladenen Stücke (Admin, `canManageGameTypes`). */
export function fetchArcadeTracks(signal?: AbortSignal): Promise<ApiResult<ArcadeTrackListDto>> {
  return apiRequest<ArcadeTrackListDto>('/arcade/tracks', { signal });
}

/** Aktive Stücke je Spiel – für alle angemeldeten Konten. */
export function fetchActiveArcadeTracks(
  signal?: AbortSignal,
): Promise<ApiResult<ArcadeActiveTracksDto>> {
  return apiRequest<ArcadeActiveTracksDto>('/arcade/tracks/active', { signal });
}

export interface UploadArcadeTrackFields {
  gameId: ArcadeGameId;
  title: string;
}

export function uploadArcadeTrack(
  file: File,
  fields: UploadArcadeTrackFields,
): Promise<ApiResult<ArcadeTrackDto>> {
  const form = new FormData();
  form.set('gameId', fields.gameId);
  form.set('title', fields.title);
  // Die Datei zuletzt: Das Backend liest den Multipart-Strom der Reihe nach und
  // braucht Spiel und Titel, bevor es die Bytes annimmt.
  form.set('file', file);
  return apiRequest<ArcadeTrackDto>('/arcade/tracks', { method: 'POST', body: form });
}

export function activateArcadeTrack(id: string): Promise<ApiResult<ArcadeTrackDto>> {
  return apiRequest<ArcadeTrackDto>(`/arcade/tracks/${enc(id)}/activate`, { method: 'POST' });
}

export function deactivateArcadeTrack(id: string): Promise<ApiResult<ArcadeTrackDto>> {
  return apiRequest<ArcadeTrackDto>(`/arcade/tracks/${enc(id)}/deactivate`, { method: 'POST' });
}

export function deleteArcadeTrack(id: string): Promise<ApiResult<null>> {
  return apiRequest<null>(`/arcade/tracks/${enc(id)}`, { method: 'DELETE' });
}

/**
 * Bytes eines hochgeladenen Stücks.
 *
 * Kein `<audio src>`: Die CSP gibt für die API kein `media-src` frei, und das
 * soll so bleiben. Die Bytes kommen per `fetch` (mit Sitzungs-Cookie wie
 * `apiRequest`) und gehen an `decodeAudioData`. `null` bei jedem Fehler – dann
 * spielt die mitgelieferte Melodie.
 */
export async function fetchArcadeTrackAudio(
  id: string,
  signal?: AbortSignal,
): Promise<ArrayBuffer | null> {
  try {
    const response = await fetch(apiUrl(`/arcade/tracks/${enc(id)}/audio`), {
      credentials: 'include',
      signal,
    });
    if (!response.ok) return null;
    return await response.arrayBuffer();
  } catch {
    return null;
  }
}
