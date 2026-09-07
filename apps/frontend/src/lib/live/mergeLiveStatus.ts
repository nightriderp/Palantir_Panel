import { type ServerStatus } from '@palantir/contracts';

/**
 * Live-Status und REST-Antwort versöhnen (Fundpunkt event-flow-04).
 *
 * Bis hierher galt in Detailansicht, Übersicht und Seitenleiste `live ?? dto`:
 * Der zuletzt über den Kanal gemeldete Status gewann immer. Das stimmt beim
 * Erstladen – dort lief die REST-Anfrage schon, als das Ereignis eintraf –,
 * aber nicht mehr, sobald eine Aktion (Start, Stopp, Neustart) einen frischen
 * DTO liefert. Wer einen Server startete, während der Kanal gerade im
 * Wiederanlauf steckte, sah danach weiter „Gestoppt" samt Start-Knopf; der
 * zweite Klick endete in `SERVER_STATE_CONFLICT`.
 *
 * Entschieden wird deshalb nach der Reihenfolge, in der die beiden Stände im
 * Browser eingetroffen sind (siehe `lib/revision.ts` und `useDtoRevision.ts`).
 */

/** Zuletzt über den Live-Kanal gemeldeter Status eines Servers. */
export interface LiveStatusEntry {
  status: ServerStatus;
  statusMessage: string | null;
  /** Nummer aus `nextRevision()`, vergeben beim Empfang des Frames. */
  revision: number;
}

/** Mindestumfang, den ein DTO für den Abgleich mitbringen muss. */
export interface StatusCarryingDto {
  status: ServerStatus;
  statusMessage: string | null;
}

/**
 * Den jüngeren der beiden Stände liefern.
 *
 * Gleichstand geht an den DTO: Er trägt den vollständigen Datensatz, das
 * Ereignis nur Status und Meldung. Stimmen beide ohnehin überein, wird das
 * DTO-Objekt unverändert zurückgegeben – so bleibt seine Identität erhalten,
 * und abhängige `useMemo`/`useEffect` (und die Revision selbst!) laufen nicht
 * ohne Grund erneut.
 */
export function mergeLiveStatus<TDto extends StatusCarryingDto>(
  dto: TDto,
  /** Nummer, unter der dieser DTO im Browser eintraf; `0` beim Erstladen. */
  dtoRevision: number,
  live: LiveStatusEntry | null,
): TDto {
  if (live === null || live.revision <= dtoRevision) return dto;
  if (live.status === dto.status && live.statusMessage === dto.statusMessage) return dto;

  return { ...dto, status: live.status, statusMessage: live.statusMessage };
}
