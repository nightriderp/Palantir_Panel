import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ConfirmDialog } from './ConfirmDialog';
import { Modal } from './Modal';

/**
 * Audit-Fundstelle frontend-lib-08 – der Dialog schloss zu früh.
 *
 * Zwei Wege führten dorthin: (1) Wer im Dialog Text markierte und die Maus
 * außerhalb losließ, erzeugte ein `click` am gemeinsamen Vorfahren – dem
 * Hintergrund – und verlor im Datei-Editor seine ungespeicherten Änderungen.
 * (2) Escape schloss auch, während die bestätigte Aktion noch lief; der Dialog
 * verschwand, die Aktion lief weiter, und die Rückmeldung kam aus dem Nichts.
 */

/** Der Hintergrund ist der Elternknoten des Dialogs – ohne eigene Rolle. */
function hintergrund(): HTMLElement {
  const dialog = screen.getByRole('dialog');
  const parent = dialog.parentElement;
  if (parent === null) throw new Error('Der Dialog hat keinen Hintergrund.');
  return parent;
}

describe('Modal – Hintergrundklick (frontend-lib-08)', () => {
  it('bleibt offen, wenn der Klick im Dialog begann und auf dem Hintergrund endete', () => {
    const geschlossen = vi.fn();
    render(
      <Modal open onClose={geschlossen} title="Datei bearbeiten">
        <p>Inhalt</p>
      </Modal>,
    );

    // Textauswahl per Ziehen: gedrückt im Inhalt, losgelassen daneben. Der
    // Browser feuert danach ein `click` am gemeinsamen Vorfahren – dem
    // Hintergrund; genau daran schloss der Dialog vorher.
    fireEvent.mouseDown(screen.getByText('Inhalt'));
    fireEvent.mouseUp(hintergrund());
    fireEvent.click(hintergrund());

    expect(geschlossen).not.toHaveBeenCalled();
  });

  it('bleibt offen, wenn der Klick auf dem Hintergrund begann und im Dialog endete', () => {
    const geschlossen = vi.fn();
    render(
      <Modal open onClose={geschlossen} title="Datei bearbeiten">
        <p>Inhalt</p>
      </Modal>,
    );

    fireEvent.mouseDown(hintergrund());
    fireEvent.mouseUp(screen.getByText('Inhalt'));
    fireEvent.click(hintergrund());

    expect(geschlossen).not.toHaveBeenCalled();
  });

  it('schließt, wenn Drücken und Loslassen auf dem Hintergrund lagen', () => {
    const geschlossen = vi.fn();
    render(
      <Modal open onClose={geschlossen} title="Datei bearbeiten">
        <p>Inhalt</p>
      </Modal>,
    );

    fireEvent.mouseDown(hintergrund());
    fireEvent.mouseUp(hintergrund());
    fireEvent.click(hintergrund());

    // Genau einmal – nicht zusätzlich über einen zweiten Klick-Handler.
    expect(geschlossen).toHaveBeenCalledTimes(1);
  });

  it('lässt den Hintergrund in Ruhe, wenn `closeOnBackdrop` aus ist', () => {
    const geschlossen = vi.fn();
    render(
      <Modal open onClose={geschlossen} title="Datei bearbeiten" closeOnBackdrop={false}>
        <p>Inhalt</p>
      </Modal>,
    );

    fireEvent.mouseDown(hintergrund());
    fireEvent.mouseUp(hintergrund());

    expect(geschlossen).not.toHaveBeenCalled();
  });

  it('schließt nicht über den Hintergrund, solange eine Aktion läuft', () => {
    const geschlossen = vi.fn();
    render(
      <Modal open onClose={geschlossen} title="Server löschen" busy>
        <p>Inhalt</p>
      </Modal>,
    );

    fireEvent.mouseDown(hintergrund());
    fireEvent.mouseUp(hintergrund());

    expect(geschlossen).not.toHaveBeenCalled();
  });
});

describe('Modal – Escape (frontend-lib-08)', () => {
  it('schließt bei Escape', () => {
    const geschlossen = vi.fn();
    render(
      <Modal open onClose={geschlossen} title="Server löschen">
        <p>Inhalt</p>
      </Modal>,
    );

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(geschlossen).toHaveBeenCalledTimes(1);
  });

  it('bleibt bei Escape stehen, solange eine Aktion läuft', () => {
    const geschlossen = vi.fn();
    render(
      <Modal open onClose={geschlossen} title="Server löschen" busy>
        <p>Inhalt</p>
      </Modal>,
    );

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(geschlossen).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('sperrt auch das Kreuz, solange eine Aktion läuft', () => {
    const geschlossen = vi.fn();
    render(
      <Modal open onClose={geschlossen} title="Server löschen" busy>
        <p>Inhalt</p>
      </Modal>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Dialog schließen' }));

    expect(geschlossen).not.toHaveBeenCalled();
  });
});

describe('ConfirmDialog reicht `busy` an den Dialog durch', () => {
  it('schließt während der laufenden Aktion weder über Escape noch über den Hintergrund', () => {
    const geschlossen = vi.fn();
    render(
      <ConfirmDialog
        open
        busy
        onClose={geschlossen}
        onConfirm={() => {}}
        title="Neu starten?"
        message="Der Server wird kurz nicht erreichbar sein."
        confirmLabel="Neu starten"
      />,
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.mouseDown(hintergrund());
    fireEvent.mouseUp(hintergrund());
    fireEvent.click(hintergrund());

    expect(geschlossen).not.toHaveBeenCalled();
  });

  it('schließt ohne laufende Aktion weiterhin über den Hintergrund', () => {
    const geschlossen = vi.fn();
    render(
      <ConfirmDialog
        open
        onClose={geschlossen}
        onConfirm={() => {}}
        title="Neu starten?"
        message="Der Server wird kurz nicht erreichbar sein."
        confirmLabel="Neu starten"
      />,
    );

    fireEvent.mouseDown(hintergrund());
    fireEvent.mouseUp(hintergrund());

    expect(geschlossen).toHaveBeenCalledTimes(1);
  });
});
