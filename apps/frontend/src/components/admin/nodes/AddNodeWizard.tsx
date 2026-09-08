'use client';

import { useState } from 'react';
import { type HostNodeDto } from '@palantir/contracts';
import {
  Badge,
  Button,
  FormMessage,
  Modal,
  NumberField,
  TextField,
  ToggleRow,
  useToast,
} from '@/components/shared';
import { createNode } from '@/lib/api/admin';
import { errorText } from '@/lib/api/client';
import { type NodeSetupStep, buildNodeSetupSteps } from './nodeSetupGuide';
import { buildSharedAgentTokenWarning } from './sharedAgentTokenWarning';

/**
 * Wizard zum Anbinden einer neuen Node (Lastenheft §3.7).
 *
 * Zwei Schritte: (1) die Node im Panel anlegen, (2) die Anleitung, mit der der
 * Agent auf dem Homeserver angebunden wird. Bewusst kein Token-Reveal: Der Agent
 * authentifiziert über das geteilte `AGENT_TOKEN` aus der zentralen `.env`; der
 * Wizard verweist nur darauf (siehe `nodeSetupGuide.ts` und SETUP.md §3.4).
 *
 * Vor dem ersten Schritt steht seit Fundpunkt 160 eine Warnung, wenn eine
 * bestehende Node noch am gemeinsamen `AGENT_TOKEN` hängt: Ab zwei Nodes lehnt
 * das Backend dieses Token ab, die bestehende Node fällt also beim nächsten
 * Verbindungsaufbau heraus. Bewusst **warnen und bestätigen lassen, nicht
 * blockieren** – es ist die Installation des Betreibers, und die umgekehrte
 * Reihenfolge kann gewollt sein (etwa wenn die bestehende Node ohnehin abgebaut
 * wird). Der Wortlaut steht in `sharedAgentTokenWarning.ts`.
 */
export function AddNodeWizard({
  open,
  onClose,
  onCreated,
  existingNodes = [],
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  /**
   * Bereits eingetragene Nodes – Grundlage der Warnung oben.
   *
   * Kommt aus der Liste, die die Node-Verwaltung ohnehin geladen hat; es braucht
   * dafür keine zweite Abfrage und kein neues Contract-Feld
   * (`HostNodeDto.hasAgentToken` gibt es seit Gefundener Punkt 57).
   */
  existingNodes?: readonly HostNodeDto[];
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<HostNodeDto | null>(null);
  /** Hat der Betreiber die Warnung gelesen und bestätigt? */
  const [warnungBestaetigt, setWarnungBestaetigt] = useState(false);
  /**
   * Wie viele Nodes bestanden im Moment des Absendens?
   *
   * Wird beim Absenden festgehalten, weil `existingNodes` gleich danach die
   * frisch angelegte Node mitbringt (`onCreated()` lädt die Liste neu). Ohne den
   * festgehaltenen Wert stünde in der Anleitung des zweiten Schritts für jede
   * Node „mehrere Nodes eingetragen".
   */
  const [nodesVorAnlegen, setNodesVorAnlegen] = useState(0);

  const [name, setName] = useState('');
  const [wireguardIp, setWireguardIp] = useState('');
  /*
   * Die drei Ressourcen-Felder dürfen leer sein (`null`), während der Admin
   * einen Wert austauscht. Vorher meldete ein geleertes Feld `Number('') = 0`;
   * wer nur löschte und weiterklickte, legte eine Node mit 0 MB RAM an
   * (Audit-Fundstelle frontend-lib-13). „Node anlegen" bleibt gesperrt, solange
   * ein Feld leer ist.
   */
  const [ramGb, setRamGb] = useState<number | null>(8);
  const [cpuCores, setCpuCores] = useState<number | null>(4);
  const [diskGb, setDiskGb] = useState<number | null>(100);

  function reset() {
    setCreated(null);
    setBusy(false);
    setWarnungBestaetigt(false);
    setNodesVorAnlegen(0);
    setName('');
    setWireguardIp('');
    setRamGb(8);
    setCpuCores(4);
    setDiskGb(100);
  }

  function close() {
    reset();
    onClose();
  }

  /** Alle Ressourcen-Felder gefüllt? Sonst gäbe es nichts zu senden. */
  const resourcesComplete = ramGb !== null && cpuCores !== null && diskGb !== null;

  /** `null`, solange es nichts zu warnen gibt (Fundpunkt 160). */
  const warnung = buildSharedAgentTokenWarning(existingNodes);

  async function onSubmit() {
    if (ramGb === null || cpuCores === null || diskGb === null) return;

    setNodesVorAnlegen(existingNodes.length);
    setBusy(true);
    const result = await createNode({
      name: name.trim(),
      wireguardIp: wireguardIp.trim(),
      totalResources: {
        ramMb: Math.round(ramGb * 1024),
        cpuCores,
        diskMb: Math.round(diskGb * 1024),
      },
    });
    setBusy(false);

    if (result.success) {
      setCreated(result.data);
      onCreated();
      toast.success(`Node „${result.data.name}" angelegt.`);
    } else {
      toast.error(errorText(result));
    }
  }

  if (created) {
    const steps = buildNodeSetupSteps({
      name: created.name,
      wireguardIp: created.wireguardIp,
      nodeId: created.id,
      // Der Rückfallweg auf das geteilte AGENT_TOKEN gilt nur bei genau einer
      // Node – die eben angelegte ist die erste (Fundpunkt 160).
      sharedTokenFallback: nodesVorAnlegen === 0,
    });
    return (
      <Modal
        open={open}
        onClose={close}
        title={`„${created.name}" anbinden`}
        footer={
          <Button variant="primary" onClick={close}>
            Fertig
          </Button>
        }
      >
        <p className="text-sm text-ink-soft">
          Die Node ist im Panel angelegt und wartet auf ihren Agenten. Führe die folgenden Schritte
          aus; sobald der Agent verbindet, wechselt die Node hier automatisch auf „online“. Die
          vollständige Fassung mit allen Begründungen steht in SETUP.md §3.4.
        </p>
        <ol className="mt-4 flex flex-col gap-3">
          {steps.map((step, index) => (
            <SetupStepRow key={step.title} step={step} index={index} />
          ))}
        </ol>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Neue Node anbinden"
      footer={
        <div className="flex justify-end gap-2.5">
          <Button variant="secondary" onClick={close} disabled={busy}>
            Abbrechen
          </Button>
          <Button
            variant="primary"
            onClick={onSubmit}
            disabled={busy || !resourcesComplete || (warnung !== null && !warnungBestaetigt)}
          >
            Node anlegen
          </Button>
        </div>
      }
    >
      {warnung ? (
        <div className="mb-4 flex flex-col gap-2.5">
          <FormMessage tone="warning">
            <strong className="font-semibold">{warnung.headline}</strong>
            {warnung.paragraphs.map((absatz) => (
              <span key={absatz} className="mt-1.5 block text-ink-muted">
                {absatz}
              </span>
            ))}
          </FormMessage>
          <ToggleRow
            title={warnung.acknowledgeTitle}
            description={warnung.acknowledgeDescription}
            checked={warnungBestaetigt}
            onChange={setWarnungBestaetigt}
            disabled={busy}
          />
        </div>
      ) : null}

      <p className="text-sm text-ink-soft">
        Lege die Node zunächst im Panel an. Danach zeigt der Wizard die Schritte, mit denen der
        Agent auf dem Homeserver angebunden wird.
      </p>
      <div className="mt-4 flex flex-col gap-3">
        <TextField
          label="Name"
          hint="Anzeigename, z. B. Homeserver."
          value={name}
          onChange={setName}
          inputProps={{ required: true }}
        />
        <TextField
          label="WireGuard-IP"
          hint="Feste Tunnel-Adresse der Node, z. B. 10.10.0.2."
          value={wireguardIp}
          onChange={setWireguardIp}
          inputProps={{ required: true }}
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <NumberField label="RAM" labelAside="GB" min={1} value={ramGb} onChange={setRamGb} />
          <NumberField
            label="CPU-Kerne"
            min={1}
            step={0.5}
            value={cpuCores}
            onChange={setCpuCores}
          />
          <NumberField
            label="Speicher"
            labelAside="GB"
            min={1}
            value={diskGb}
            onChange={setDiskGb}
          />
        </div>
        <p className="text-xs text-ink-faint">
          Nutzbare Gesamt-Ressourcen der Gameserver-VM – nicht die Hardware darunter (Lastenheft
          §5).
        </p>
      </div>
    </Modal>
  );
}

function SetupStepRow({ step, index }: { step: NodeSetupStep; index: number }) {
  return (
    <li className="rounded-lg border border-line bg-surface p-3.5">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-fill-strong text-xs text-ink-muted">
          {index + 1}
        </span>
        <span className="text-base font-semibold text-ink">{step.title}</span>
        <Badge tone={step.machine === 'vps' ? 'brand' : 'neutral'}>
          {step.machine === 'vps' ? 'auf der VPS' : 'auf dem Homeserver'}
        </Badge>
      </div>
      <p className="mt-2 text-sm text-ink-soft">{step.body}</p>
      {step.code ? (
        <pre className="mt-2 overflow-x-auto rounded-md border border-line bg-surface-deep p-2.5 font-mono text-xs text-ink-muted">
          <code>{step.code}</code>
        </pre>
      ) : null}
    </li>
  );
}
