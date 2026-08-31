'use client';

import { type GameTypeDto, type HostNodeDto } from '@palantir/contracts';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Button, EmptyState, Icon, MetricTile, PageHeader, Panel } from '@/components/shared';
import { fetchGameTypes } from '@/lib/api/servers';
import { fetchNodes } from '@/lib/api/nodes';
import { useApiResource } from '@/lib/api/useApiResource';
import { useSession } from '@/app/(dashboard)/SessionProvider';
import { NodeCard } from './NodeCard';
import { NodeExplainerDialog } from './NodeExplainerDialog';
import { NODE_EXPLAINERS, nodesSummary, startCapacityHint } from './nodeStatus';

/**
 * Nodes aus Nutzersicht (Arbeitspaket F7, Lastenheft §3.7).
 *
 * Zeigt Zustand, Auslastung und freie Kapazität der Nodes und erklärt
 * verständlich, was das bedeutet. Die Ansicht **verwaltet nichts** – Anlegen,
 * Pausieren, Löschen sowie Port-Pool und Storage-Explorer gehören zur
 * Admin-Ansicht (F10). Wer dort hin darf, findet oben den Weg dorthin: Das
 * Mockup setzt „Node hinzufügen" und „Node einrichten – Anleitung" direkt in
 * diesen Seitenkopf, die App hat beides fertig unter `/admin/nodes` – ein
 * zweiter Assistent an dieser Stelle wäre dieselbe Funktion doppelt.
 *
 * Sichtbarkeit richtet sich nach `node.view` aus dem `permissions`-Objekt
 * (Pflichtenheft §5.2, §8). Die Navigation blendet den Eintrag bereits danach
 * aus; wer die Seite dennoch direkt aufruft, bekommt hier einen klaren Hinweis
 * statt einer leeren Seite.
 */
export function NodesView() {
  const { user, loading: sessionLoading } = useSession();
  const [helpOpen, setHelpOpen] = useState(false);

  const canView = user?.permissions.canViewNodes ?? false;
  const canManage = user?.permissions.canManageNodes ?? false;
  const router = useRouter();

  // Nur laden, wenn das Konto steht und die Sicht erlaubt ist – sonst gar nicht
  // (dependencies === null hält `useApiResource` an).
  const nodes = useApiResource<HostNodeDto[]>((signal) => fetchNodes(signal), canView ? [] : null);
  const gameTypes = useApiResource<GameTypeDto[]>(
    (signal) => fetchGameTypes(signal),
    canView ? [] : null,
  );

  const nodeList = useMemo(() => nodes.data ?? [], [nodes.data]);
  const gameTypeList = useMemo(() => gameTypes.data ?? [], [gameTypes.data]);

  const summary = useMemo(() => nodesSummary(nodeList), [nodeList]);
  const hint = useMemo(() => startCapacityHint(nodeList, gameTypeList), [nodeList, gameTypeList]);

  const intro = NODE_EXPLAINERS[0];

  const headerActions = (
    <>
      <Button variant="secondary" iconLeft="smile" onClick={() => setHelpOpen(true)}>
        Was ist das?
      </Button>
      {canManage ? (
        <Button iconLeft="server" onClick={() => router.push('/admin/nodes')}>
          Nodes verwalten
        </Button>
      ) : null}
    </>
  );

  if (!canView) {
    return (
      <>
        <PageHeader
          title="Nodes"
          subtitle="Zustand und Auslastung der Rechner, auf denen die Gameserver laufen."
        />
        <div className="p-5">
          <EmptyState
            icon="lock"
            title={sessionLoading ? 'Einen Moment …' : 'Kein Zugriff auf die Node-Übersicht'}
            description={
              sessionLoading
                ? 'Dein Konto wird geladen.'
                : 'Für diese Ansicht fehlt dir die Berechtigung „Nodes sehen". Wende dich an die Administration, wenn du sie brauchst.'
            }
          />
        </div>
      </>
    );
  }

  const loading = nodes.loading || gameTypes.loading;
  const hasError = nodes.error !== null;

  return (
    <>
      <PageHeader
        title="Nodes"
        subtitle="Zustand und Auslastung der Rechner, auf denen die Gameserver laufen."
        actions={headerActions}
      />

      <div className="flex flex-col gap-5 p-5">
        {intro ? (
          <Panel variant="outline" className="flex items-start gap-3">
            <Icon name="server" size={18} className="mt-0.5 shrink-0 text-brand" />
            <div>
              <div className="text-md font-semibold">{intro.title}</div>
              <p className="mt-1 text-base text-ink-muted">{intro.body}</p>
            </div>
          </Panel>
        ) : null}

        {hasError ? (
          <EmptyState
            icon="warning"
            title="Die Node-Übersicht konnte nicht geladen werden"
            description={nodes.error ?? undefined}
            action={
              <Button variant="secondary" onClick={() => nodes.reload()}>
                Erneut versuchen
              </Button>
            }
          />
        ) : loading ? (
          <p className="text-base text-ink-muted">Nodes werden geladen …</p>
        ) : nodeList.length === 0 ? (
          <EmptyState
            icon="server"
            title="Noch keine Node eingerichtet"
            description="Sobald die Administration eine Node verbindet, erscheint sie hier."
          />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {summary.map((entry) => (
                <MetricTile
                  key={entry.key}
                  label={entry.label}
                  value={entry.value}
                  note={entry.note}
                />
              ))}
            </div>

            {hint ? (
              <Panel variant="raised" className="flex items-start gap-3 border-warning-line">
                <Icon name="warning" size={18} className="mt-0.5 shrink-0 text-warning" />
                <div>
                  <div className="text-md font-semibold text-warning">{hint.title}</div>
                  <p className="mt-1 text-base text-ink-muted">{hint.description}</p>
                </div>
              </Panel>
            ) : null}

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {nodeList.map((node) => (
                <NodeCard key={node.id} node={node} />
              ))}
            </div>
          </>
        )}
      </div>

      <NodeExplainerDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
    </>
  );
}
