'use client';

import { type QuotaRequestDto } from '@palantir/contracts';
import { useState } from 'react';
import {
  Badge,
  Button,
  Panel,
  formatDateTime,
  formatMegabytes,
  formatNumber,
  serverInitials,
  useToast,
} from '@/components/shared';
import { errorText } from '@/lib/api/client';
import { approveQuotaRequest, fetchQuotaRequests, rejectQuotaRequest } from '@/lib/api/admin';
import { useApiResource } from '@/lib/api/useApiResource';
import { AdminError, AdminLoading } from '../common';

/**
 * Abschnitt „Kontingent" der Anfragen-Seite (Mockup-Abgleich 12.3.1 und 12.3.2).
 *
 * Der Entwurf gliedert die Seite in zwei betitelte Abschnitte statt in eine
 * Filterleiste: oben die Registrierungen, hier die Kontingent-Anfragen. Gezeigt
 * werden nur die **offenen** – entschiedene stehen im Kontingent des Nutzers
 * und brauchen keine zweite Liste.
 *
 * Beim Genehmigen setzt das Backend die beantragten Grenzen; hier wird nur
 * gedrückt und nachgeladen.
 */
export function QuotaRequestSection() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const resource = useApiResource<QuotaRequestDto[]>(
    (signal) => fetchQuotaRequests({ status: 'pending' }, signal),
    [],
  );

  const requests = resource.data ?? [];

  async function entscheiden(
    request: QuotaRequestDto,
    aktion: 'approve' | 'reject',
  ): Promise<void> {
    setBusy(request.id);
    const result =
      aktion === 'approve'
        ? await approveQuotaRequest(request.id)
        : await rejectQuotaRequest(request.id);
    setBusy(null);

    if (!result.success) {
      toast.error(errorText(result));
      return;
    }

    toast.success(
      aktion === 'approve'
        ? `Kontingent von „${request.userDisplayName}" angehoben.`
        : `Anfrage von „${request.userDisplayName}" abgelehnt.`,
    );
    resource.reload();
  }

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-md font-semibold text-ink">Kontingent</h2>
        <p className="text-sm text-ink-muted">
          Anfragen auf mehr Arbeitsspeicher oder mehr gleichzeitige Server.
        </p>
      </div>

      {resource.loading ? (
        <AdminLoading label="Kontingent-Anfragen werden geladen …" />
      ) : resource.error ? (
        <AdminError message={resource.error} onRetry={resource.reload} />
      ) : requests.length === 0 ? (
        <Panel className="text-center text-base text-ink-faint">
          Keine offenen Kontingent-Anfragen.
        </Panel>
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
                        gestellt {formatDateTime(request.createdAt)}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {request.requestedRamMb === null ? null : (
                      <Badge tone="brand">{formatMegabytes(request.requestedRamMb)} RAM</Badge>
                    )}
                    {request.requestedMaxConcurrentServers === null ? null : (
                      <Badge tone="brand">
                        {formatNumber(request.requestedMaxConcurrentServers)} Server
                      </Badge>
                    )}
                  </div>
                </div>

                <p className="whitespace-pre-wrap text-base text-ink-muted">{request.reason}</p>

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
                      Genehmigen
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
