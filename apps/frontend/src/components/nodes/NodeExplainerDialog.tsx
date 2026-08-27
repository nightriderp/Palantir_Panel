'use client';

import { Button, Modal } from '@/components/shared';
import { NODE_EXPLAINERS } from './nodeStatus';

export interface NodeExplainerDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * „Was bedeutet das hier?" – die Erklärhinweise aus F7 in einem Dialog.
 *
 * Der Inhalt kommt aus {@link NODE_EXPLAINERS}, damit dieselben Texte auch an
 * anderer Stelle verwendbar bleiben. Der Dialog selbst ist der `Modal`-Baustein
 * aus F2 – kein eigener Overlay-Nachbau.
 */
export function NodeExplainerDialog({ open, onClose }: NodeExplainerDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Homeserver verständlich erklärt"
      description="Kurz zusammengefasst, was diese Seite zeigt und was die Angaben bedeuten."
      footer={
        <Button variant="primary" onClick={onClose}>
          Verstanden
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {NODE_EXPLAINERS.map((entry) => (
          <section key={entry.title}>
            <h3 className="text-md font-semibold">{entry.title}</h3>
            <p className="mt-1 text-base text-ink-muted">{entry.body}</p>
          </section>
        ))}
      </div>
    </Modal>
  );
}
