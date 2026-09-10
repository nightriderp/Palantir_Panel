'use client';

import { type BackupOverviewDto, type BackupStorageBucket } from '@palantir/contracts';
import {
  MetricTile,
  PageHeader,
  Panel,
  formatBytes,
  formatDateTime,
  formatNumber,
} from '@/components/shared';
import { useSession } from '@/app/(dashboard)/SessionProvider';
import { fetchBackupOverview } from '@/lib/api/admin';
import { useApiResource } from '@/lib/api/useApiResource';
import {
  AdminAccessNotice,
  AdminError,
  AdminLoading,
  AdminTable,
  Blaetterleiste,
  SortTh,
  Td,
} from '../common';
import { useSeitenteilung, useTabellenSortierung } from '../tableSort';
import { PanelBackupSection } from './PanelBackupSection';

/**
 * Globale Backup-Übersicht (Lastenheft §3.7).
 *
 * Aggregat über alle Nutzer und Server samt Speicherverbrauch – geliefert vom
 * Backend als fertige {@link BackupOverviewDto}. Rein lesend: Das Löschen
 * einzelner Backups gehört in die jeweilige Server- bzw. Backup-Ansicht, nicht
 * in diese Übersicht.
 */

/** Spalten einer {@link BucketTable} (Fundpunkt 212). */
const EIMER_SPALTEN = ['name', 'anzahl', 'speicher'] as const;

type EimerSpalte = (typeof EIMER_SPALTEN)[number];

function BucketTable({
  title,
  emptyLabel,
  buckets,
  nameHeader,
  praefix,
}: {
  title: string;
  emptyLabel: string;
  buckets: BackupStorageBucket[];
  nameHeader: string;
  /**
   * Beide Tabellen stehen auf derselben Seite – ohne eigene Kennung schrieben
   * sie in dasselbe `?sort=` und stellten sich gegenseitig um.
   */
  praefix: string;
}) {
  /*
   * Vorgabe „Speicher absteigend" (Fundpunkt 212): Diese Übersicht beantwortet
   * genau eine Frage – wessen Sicherungen belegen den Platz. Vorher stand oben,
   * was das Backend zufällig zuerst zusammengezählt hatte.
   */
  const sortierung = useTabellenSortierung<EimerSpalte>(EIMER_SPALTEN, 'speicher', 'desc', praefix);
  const sortiert = sortierung.sortiere(buckets, {
    name: (eimer) => eimer.name ?? null,
    anzahl: (eimer) => eimer.backupCount,
    speicher: (eimer) => eimer.totalSizeBytes,
  });
  const seite = useSeitenteilung(sortiert, praefix);

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      {buckets.length === 0 ? (
        <Panel className="text-center text-sm text-ink-faint">{emptyLabel}</Panel>
      ) : (
        <AdminTable>
          <thead>
            <tr>
              <SortTh
                aktiv={sortierung.schluessel === 'name'}
                richtung={sortierung.richtung}
                onSort={() => sortierung.umschalten('name')}
              >
                {nameHeader}
              </SortTh>
              <SortTh
                className="text-right"
                aktiv={sortierung.schluessel === 'anzahl'}
                richtung={sortierung.richtung}
                onSort={() => sortierung.umschalten('anzahl')}
              >
                Backups
              </SortTh>
              <SortTh
                className="text-right"
                aktiv={sortierung.schluessel === 'speicher'}
                richtung={sortierung.richtung}
                onSort={() => sortierung.umschalten('speicher')}
              >
                Speicher
              </SortTh>
            </tr>
          </thead>
          <tbody>
            {seite.zeilen.map((bucket) => (
              <tr key={bucket.id ?? bucket.name ?? 'unbekannt'}>
                <Td className="text-ink">{bucket.name ?? 'Unbekannt'}</Td>
                <Td className="text-right">{formatNumber(bucket.backupCount)}</Td>
                <Td className="text-right">{formatBytes(bucket.totalSizeBytes)}</Td>
              </tr>
            ))}
          </tbody>
        </AdminTable>
      )}
      <Blaetterleiste
        seite={seite.seite}
        seiten={seite.seiten}
        gesamt={seite.gesamt}
        onBlaettern={seite.blaettere}
      />
    </section>
  );
}

export function BackupsView() {
  const { user } = useSession();
  const canView = user?.permissions.canManageAnyBackup ?? false;

  const resource = useApiResource<BackupOverviewDto>(
    (signal) => fetchBackupOverview({}, signal),
    canView ? [] : null,
  );

  if (!canView) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Backups" className="-mx-5 -mt-5 px-5" />
        <AdminAccessNotice area="die globale Backup-Übersicht" />
      </div>
    );
  }

  const overview = resource.data;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Backups"
        subtitle="Sicherungen der Panel-Datenbank und Speicherverbrauch der Server-Backups"
        className="-mx-5 -mt-5 px-5"
      />

      <PanelBackupSection />

      {resource.loading ? (
        <AdminLoading label="Übersicht wird geladen …" />
      ) : resource.error ? (
        <AdminError message={resource.error} onRetry={resource.reload} />
      ) : overview ? (
        <>
          <h2 className="text-base font-semibold text-ink">Server-Backups</h2>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <MetricTile label="Backups" value={formatNumber(overview.totalCount)} />
            <MetricTile label="Speicher gesamt" value={formatBytes(overview.totalSizeBytes)} />
            <MetricTile
              label="Manuell"
              value={formatNumber(overview.manualCount)}
              note={formatBytes(overview.manualSizeBytes)}
            />
            <MetricTile
              label="Automatisch"
              value={formatNumber(overview.automaticCount)}
              note={formatBytes(overview.automaticSizeBytes)}
            />
            <MetricTile label="Laufend/Ausstehend" value={formatNumber(overview.pendingCount)} />
            <MetricTile label="Fehlgeschlagen" value={formatNumber(overview.failedCount)} />
          </div>

          <BucketTable
            title="Nach Nutzer"
            nameHeader="Nutzer"
            emptyLabel="Keine Backups vorhanden."
            buckets={overview.perUser}
            praefix="nutzer"
          />
          <BucketTable
            title="Nach Server"
            nameHeader="Server"
            emptyLabel="Keine Backups vorhanden."
            buckets={overview.perServer}
            praefix="server"
          />

          <p className="text-sm text-ink-faint">Stand: {formatDateTime(overview.generatedAt)}</p>
        </>
      ) : null}
    </div>
  );
}
