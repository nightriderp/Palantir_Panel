'use client';

import { type GameRequestDto } from '@palantir/contracts';
import { useState } from 'react';
import {
  Badge,
  Button,
  Panel,
  formatDateTime,
  serverInitials,
  useToast,
} from '@/components/shared';
import { errorText } from '@/lib/api/client';
import { approveGameRequest, fetchGameRequests, rejectGameRequest } from '@/lib/api/admin';
import { useApiResource } from '@/lib/api/useApiResource';
import { AdminError, AdminLoading } from '../common';

/**
 * Abschnitt „Spiel-Wünsche" der Anfragen-Seite (Betreiber, 19.09.2026).
 *
 * Gezeigt werden nur die **offenen** – beschiedene stehen im Protokoll und
 * brauchen keine zweite Liste.
 *
 * Anders als beim Kontingent gibt es hier keine Rückfrage vor der Zusage: Sie
 * ändert nichts an einem fremden Konto und lässt sich nicht „zu viel"
 * vergeben. Sie sagt zu, dass das Spiel aufgenommen werden soll; gebaut wird
 * es danach von Hand.
 */
export function GameRequestSection() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const resource = useApiResource<GameRequestDto[]>(
    (signal) => fetchGameRequests({ status: 'pending' }, signal),
    [],
  );

  const requests = resource.data ?? [];

  async function entscheiden(request: GameRequestDto, aktion: 'approve' | 'reject'): Promise<void> {
    setBusy(request.id);
    const result =
      aktion === 'approve'
        ? await approveGameRequest(request.id)
        : await rejectGameRequest(request.id);
    setBusy(null);

    if (!result.success) {
      toast.error(errorText(result));

      return;
    }

    toast.success(
      aktion === 'approve'
        ? `„${request.game}" ist zugesagt.`
        : `Wunsch nach „${request.game}" abgelehnt.`,
    );
    resource.reload();
  }

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-md font-semibold text-ink">Spiel-Wünsche</h2>
        <p className="text-sm text-ink-muted">
          Spiele, die ein Konto vermisst. Eine Zusage schaltet nichts frei – sie hält fest, dass das
          Spiel aufgenommen werden soll.
        </p>
      </div>

      {resource.loading ? (
        <AdminLoading label="Spiel-Wünsche werden geladen …" />
      ) : resource.error ? (
        <AdminError message={resource.error} onRetry={resource.reload} />
      ) : requests.length === 0 ? (
        <Panel className="text-center text-base text-ink-faint">Keine offenen Spiel-Wünsche.</Panel>
      ) : (
        <ul className="flex flex-col gap-3">
          {requests.map((request) => (
            <li key={request.id}>
              <Panel className="flex flex-col gap-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-soft font-semibold text-brand">
                      {serverInitials(request.userDisplayName)}
                    </span>
                    <div>
                      <div className="font-semibold text-ink">{request.userDisplayName}</div>
                      <div className="text-xs text-ink-faint">
                        gewünscht {formatDateTime(request.createdAt)}
                      </div>
                    </div>
                  </div>

                  <Badge tone="brand">{request.game}</Badge>
                </div>

                {request.reason === null ? null : (
                  <p className="whitespace-pre-wrap text-base text-ink-muted">{request.reason}</p>
                )}

                {request.permissions.canDecide ? (
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy === request.id}
                      onClick={() => void entscheiden(request, 'reject')}
                    >
                      Ablehnen
                    </Button>
                    <Button
                      size="sm"
                      disabled={busy === request.id}
                      onClick={() => void entscheiden(request, 'approve')}
                    >
                      Zusagen
                    </Button>
                  </div>
                ) : null}
              </Panel>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
