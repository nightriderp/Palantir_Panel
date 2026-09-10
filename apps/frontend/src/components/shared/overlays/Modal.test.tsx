import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ConfirmDialog } from './ConfirmDialog';
import { DangerConfirmDialog } from './DangerConfirmDialog';
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

/**
 * Fokus bleibt im Dialog (Fundpunkt 215).
 *
 * Am laufenden System gemessen: Tab lief aus dem Dialog heraus und weiter durch
 * die Seite dahinter - bedienbar war dort alles, was der Dialog gerade
 * verdeckte. Beim Schliessen landete der Fokus wieder am Seitenanfang.
 */
describe('Modal - Fokusfang (Fundpunkt 215)', () => {
  function zeichne(onClose = () => {}) {
    return render(
      <div>
        <button type="button">Dahinter</button>
        <Modal
          open
          onClose={onClose}
          title="Umbenennen"
          footer={
            <>
              <button type="button">Abbrechen</button>
              <button type="button">Speichern</button>
            </>
          }
        >
          <input aria-label="Name" />
        </Modal>
      </div>,
    );
  }

  it('springt von der letzten Schaltflaeche zurueck an den Anfang', () => {
    zeichne();

    const speichern = screen.getByRole('button', { name: 'Speichern' });
    speichern.focus();
    fireEvent.keyDown(document, { key: 'Tab' });

    // Erstes fokussierbares Element im Dialog ist das Kreuz zum Schliessen.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Dialog schließen' }));
  });

  it('springt mit Umschalt+Tab vom Anfang ans Ende', () => {
    zeichne();

    screen.getByRole('button', { name: 'Dialog schließen' }).focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Speichern' }));
  });

  it('holt den Fokus zurueck, wenn er hinter dem Dialog gelandet ist', () => {
    zeichne();

    const dahinter = screen.getByRole('button', { name: 'Dahinter' });
    dahinter.focus();
    fireEvent.keyDown(document, { key: 'Tab' });

    expect(document.activeElement).not.toBe(dahinter);
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  it('gibt den Fokus beim Schliessen dorthin zurueck, wo er herkam', () => {
    render(<button type="button">Loeschen</button>);
    const ausloeser = screen.getByRole('button', { name: 'Loeschen' });
    ausloeser.focus();

    const { unmount } = render(
      <Modal open onClose={() => {}} title="Wirklich?">
        <p>Inhalt</p>
      </Modal>,
    );
    expect(document.activeElement).not.toBe(ausloeser);

    unmount();

    expect(document.activeElement).toBe(ausloeser);
  });
});

/**
 * Loeschdialog: Name kopieren und Leerzeichen am Rand (Fundpunkt 216).
 *
 * Der abzutippende Name stand nur als Text da, und verglichen wurde
 * zeichengenau - ein aus einer Tabelle kopierter Name mit angehaengtem
 * Leerzeichen liess den Knopf grau, ohne zu sagen warum.
 */
describe('DangerConfirmDialog - Bestaetigung abtippen (Fundpunkt 216)', () => {
  function zeichne(onConfirm = () => {}) {
    return render(
      <DangerConfirmDialog
        open
        onClose={() => {}}
        onConfirm={onConfirm}
        title="Server löschen"
        message="Alles weg."
        confirmationPhrase="Survival-Welt"
      />,
    );
  }

  it('bietet den Namen zum Kopieren an', () => {
    zeichne();

    expect(screen.getByRole('button', { name: /Kopieren/ })).toBeTruthy();
  });

  it('nimmt einen kopierten Namen mit Leerzeichen am Rand an', () => {
    const bestaetigt = vi.fn();
    zeichne(bestaetigt);

    fireEvent.change(screen.getByLabelText(/bestätigen/), { target: { value: ' Survival-Welt ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Endgültig löschen' }));

    expect(bestaetigt).toHaveBeenCalledTimes(1);
  });

  it('sagt, dass es noch nicht passt, statt nur grau zu bleiben', () => {
    const bestaetigt = vi.fn();
    zeichne(bestaetigt);

    fireEvent.change(screen.getByLabelText(/bestätigen/), { target: { value: 'Survival' } });

    expect(screen.getByText('Stimmt noch nicht überein.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Endgültig löschen' }));
    expect(bestaetigt).not.toHaveBeenCalled();
  });

  it('schweigt, solange nichts eingetippt ist', () => {
    zeichne();

    expect(screen.queryByText('Stimmt noch nicht überein.')).toBeNull();
  });
});
