'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import { Button } from '../primitives/Button';
import { Modal } from './Modal';

export interface DangerConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Was endgültig verloren geht – deutlich benennen, nicht beschönigen. */
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  /**
   * Läuft die Aktion noch, sind beide Schaltflächen gesperrt – und der Dialog
   * schließt weder über Escape noch über den Hintergrund
   * (Audit-Fundstelle frontend-lib-08).
   */
  busy?: boolean;
  /**
   * Muss der Nutzer einen Text abtippen, um freizuschalten? Angegeben wird der
   * erwartete Text (z. B. der Servername). Ohne Angabe genügt der Klick.
   */
  confirmationPhrase?: string;
  /**
   * Zusätzliche Eingabe unter der Nachricht, etwa das Passwort bei der
   * Kontolöschung. Den Wert hält der Aufrufer; der Dialog reicht ihn nur durch.
   */
  extra?: ReactNode;
  /** Sperrt die Bestätigung zusätzlich zur abgetippten Zeichenkette. */
  extraBlocked?: boolean;
}

/**
 * Gefahren-/Löschbestätigung für endgültige Aktionen (Server löschen, Konto
 * löschen, Sicherung löschen).
 *
 * Ist `confirmationPhrase` gesetzt, bleibt die Schaltfläche gesperrt, bis der
 * Text eingegeben wurde – bewusst ohne Groß-/Kleinschreibungs-Toleranz, damit
 * die Bestätigung eine bewusste Handlung bleibt.
 *
 * Zwei Nachbesserungen aus dem Audit (Fundpunkt 216):
 *
 * 1. **Kopieren.** Der abzutippende Name stand nur als Text da. Wer ihn nicht
 *    fehlerfrei abtippte, kam nicht weiter – bei einem Namen wie
 *    „Survival-Welt (2026)" ist das keine Seltenheit. Die Schaltfläche daneben
 *    nimmt ihm das ab; abtippen bleibt möglich.
 * 2. **Leerzeichen am Rand.** Verglichen wurde zeichengenau, auch führende und
 *    folgende Leerzeichen. Kopiert man den Namen aus einer Tabelle, hängt oft
 *    eines dran – der Knopf blieb grau, ohne zu sagen warum. Beide Seiten
 *    werden jetzt am Rand beschnitten, und solange etwas dasteht, das nicht
 *    passt, sagt der Dialog es.
 */
export function DangerConfirmDialog({
  open,
  onClose,
  title,
  message,
  confirmLabel = 'Endgültig löschen',
  cancelLabel = 'Abbrechen',
  onConfirm,
  busy = false,
  confirmationPhrase,
  extra,
  extraBlocked = false,
}: DangerConfirmDialogProps) {
  const inputId = useId();
  const hintId = useId();
  const [typed, setTyped] = useState('');
  /** `null` = noch nichts kopiert, sonst die Rückmeldung am Knopf. */
  const [kopierstand, setKopierstand] = useState<'ok' | 'fehler' | null>(null);

  // Beim Öffnen und Schließen zurücksetzen, damit eine frühere Eingabe nicht
  // versehentlich die nächste Löschung freischaltet.
  useEffect(() => {
    setTyped('');
    setKopierstand(null);
  }, [open, confirmationPhrase]);

  /*
   * „Kopiert" verschwindet nach zwei Sekunden wieder. Die Rückmeldung steht
   * bewusst am Knopf und nicht als Toast: Der Dialog liegt über der Seite, eine
   * Meldung am Bildschirmrand wäre hier die schwächere Antwort - und der
   * Basis-Dialog des Design-Systems soll keinen Provider voraussetzen, den ein
   * Aufrufer vielleicht nicht hat.
   */
  useEffect(() => {
    if (kopierstand !== 'ok') return;
    const timer = setTimeout(() => setKopierstand(null), 2000);
    return () => clearTimeout(timer);
  }, [kopierstand]);

  const passt = confirmationPhrase == null || typed.trim() === confirmationPhrase.trim();
  const unlocked = passt && !extraBlocked;
  const danebengetippt = confirmationPhrase != null && typed.trim() !== '' && !passt;

  function kopieren(): void {
    if (confirmationPhrase == null) return;

    // `navigator.clipboard` gibt es nur in einem sicheren Kontext; fehlt es,
    // sagt der Dialog das, statt an einer undefinierten Eigenschaft zu
    // scheitern (wie in `PasswordResultDialog` der Nutzerverwaltung).
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    if (!clipboard) {
      setKopierstand('fehler');
      return;
    }

    void clipboard
      .writeText(confirmationPhrase)
      .then(() => setKopierstand('ok'))
      .catch(() => setKopierstand('fehler'));
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      tone="danger"
      busy={busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={busy || !unlocked}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-base text-ink-muted">{message}</div>

      {extra ? <div className="mt-4">{extra}</div> : null}

      {confirmationPhrase != null ? (
        <div className="mt-4">
          <label htmlFor={inputId} className="block text-sm text-ink-muted">
            Gib <span className="font-mono text-ink">{confirmationPhrase}</span> ein, um zu
            bestätigen.
          </label>
          <div className="mt-2 flex items-center gap-2">
            <input
              id={inputId}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              aria-describedby={danebengetippt ? hintId : undefined}
              className="w-full min-w-0 rounded-md border border-line-strong bg-fill px-3 py-2.5 text-base text-ink outline-none focus-visible:border-brand"
            />
            <Button
              variant="secondary"
              iconLeft="copy"
              onClick={kopieren}
              disabled={busy}
              title={`„${confirmationPhrase}" kopieren`}
            >
              {kopierstand === 'ok' ? 'Kopiert' : 'Kopieren'}
            </Button>
          </div>
          {kopierstand === 'fehler' ? (
            <p className="mt-1.5 text-sm text-warning">
              Kopieren ist hier nicht möglich – bitte von Hand abtippen.
            </p>
          ) : null}
          {danebengetippt ? (
            <p id={hintId} className="mt-1.5 text-sm text-ink-faint">
              Stimmt noch nicht überein.
            </p>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
