'use client';

import { type NotificationDeliveryDto } from '@palantir/contracts';
import { Badge, Button, formatDateTime, formatNumber } from '@/components/shared';
import { fetchNotificationDeliveries } from '@/lib/api/admin';
import { useApiResource } from '@/lib/api/useApiResource';
import { AdminError, AdminLoading, AdminTable, Td, Th } from '../common';
import { deliveryStatusLabel, deliveryStatusTone, notifiableEventLabel } from '../labels';

/**
 * Zustellungsprotokoll der externen Kanäle (Admin-Ansicht F10, Pflichtenheft §14).
 *
 * Rein lesend. Eine fehlgeschlagene Zustellung ist ein normaler Endzustand und
 * darf den auslösenden Vorgang nie scheitern lassen – ohne dieses Protokoll wäre
 * sie unsichtbar.
 */

const LIMIT = 100;

export function DeliveriesTab() {
  const resource = useApiResource<NotificationDeliveryDto[]>(
    (signal) => fetchNotificationDeliveries(LIMIT, signal),
    [],
  );

  const deliveries = resource.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-ink-faint">Letzte {formatNumber(LIMIT)} Zustellungen</span>
        <Button variant="ghost" iconLeft="restart" onClick={resource.reload}>
          Aktualisieren
        </Button>
      </div>

      {resource.loading ? (
        <AdminLoading label="Zustellungen werden geladen …" />
      ) : resource.error ? (
        <AdminError message={resource.error} onRetry={resource.reload} />
      ) : deliveries.length === 0 ? (
        <p className="py-8 text-center text-base text-ink-faint">
          Noch keine Zustellung an einen externen Kanal.
        </p>
      ) : (
        <AdminTable>
          <thead>
            <tr>
              <Th>Zeitpunkt</Th>
              <Th>Kanal</Th>
              <Th>Ereignis</Th>
              <Th>Status</Th>
              <Th className="text-right">Versuche</Th>
              <Th>Fehler</Th>
            </tr>
          </thead>
          <tbody>
            {deliveries.map((delivery) => (
              <tr key={delivery.id}>
                <Td className="whitespace-nowrap font-mono text-sm text-ink-faint">
                  {formatDateTime(delivery.deliveredAt ?? delivery.createdAt)}
                </Td>
                <Td className="text-ink">{delivery.channelName}</Td>
                <Td>{notifiableEventLabel(delivery.event)}</Td>
                <Td>
                  <Badge tone={deliveryStatusTone(delivery.status)}>
                    {deliveryStatusLabel(delivery.status)}
                  </Badge>
                </Td>
                <Td className="text-right">{formatNumber(delivery.attempts)}</Td>
                <Td
                  className="max-w-[240px] truncate text-sm text-ink-faint"
                  title={delivery.failureMessage ?? undefined}
                >
                  {delivery.failureMessage ?? delivery.failureCode ?? '—'}
                </Td>
              </tr>
            ))}
          </tbody>
        </AdminTable>
      )}
    </div>
  );
}
