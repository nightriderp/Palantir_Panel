'use client';

import { type GameRequestDto } from '@palantir/contracts';
import { useEffect, useState, type FormEvent } from 'react';
import { Badge, Button, Modal, TextField, formatDateTime, useToast } from '@/components/shared';
import { errorText } from '@/lib/api/client';
import {
  createGameRequest,
  fetchOwnGameRequests,
  withdrawGameRequest,
} from '@/lib/api/game-requests';

/**
 * Ein Spiel wünschen, das es im Panel nicht gibt (Betreiber, 19.09.2026).
 *
 * Steht dort, wo es auffällt: in der Spielauswahl des Assistenten. Seit dort
 * nur noch freigeschaltete Spiele stehen, ist das der einzige Weg zu allem
 * anderen – wer erst suchen muss, wo man fragt, fragt nicht.
 *
 * Der Dialog lädt beim Öffnen die eigenen Wünsche. Liegt schon einer offen,
 * zeigt er ihn, statt ein Formular anzubieten, das das Backend ohnehin mit
 * `GAME_REQUEST_ALREADY_OPEN` abweisen würde. Zurückziehen geht an derselben
 * Stelle: Wer einen dringenderen Wunsch hat, tauscht ihn hier.
 */
export function GameRequestDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [game, setGame] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [laedt, setLaedt] = useState(true);
  const [offen, setOffen] = useState<GameRequestDto | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      const result = await fetchOwnGameRequests(controller.signal);

      if (controller.signal.aborted) {
        return;
      }

      setLaedt(false);

      if (result.success) {
        setOffen(result.data.find((wunsch) => wunsch.status === 'pending') ?? null);
      }
    })();

    return () => {
      controller.abort();
    };
  }, []);

  async function wuenschen(event: FormEvent) {
    event.preventDefault();

    if (busy || game.trim() === '') {
      return;
    }

    setBusy(true);
    const result = await createGameRequest({
      game: game.trim(),
      ...(reason.trim() === '' ? {} : { reason: reason.trim() }),
    });
    setBusy(false);

    if (!result.success) {
      toast.error(errorText(result));

      return;
    }

    toast.success('Wunsch abgeschickt. Die Administration entscheidet darüber.');
    onClose();
  }

  async function zurueckziehen(): Promise<void> {
    if (offen === null) {
      return;
    }

    setBusy(true);
    const result = await withdrawGameRequest(offen.id);
    setBusy(false);

    if (!result.success) {
      toast.error(errorText(result));

      return;
    }

    toast.success('Wunsch zurückgezogen.');
    setOffen(null);
  }

  return (
    <Modal open onClose={onClose} busy={busy} title="Spiel wünschen">
      {laedt ? (
        <p className="pb-2 text-sm text-ink-muted">Wird geladen …</p>
      ) : offen === null ? (
        <form className="flex flex-col gap-3 pb-2" onSubmit={wuenschen}>
          <p className="text-sm text-ink-muted">
            Nenne das Spiel, das dir fehlt. Ein Administrator entscheidet darüber; die Antwort steht
            danach bei deinen Wünschen.
          </p>

          <TextField
            label="Spiel"
            hint="Der Name reicht, zum Beispiel Terraria."
            value={game}
            onChange={setGame}
            inputProps={{ required: true, minLength: 2, maxLength: 80 }}
          />

          <TextField
            label="Warum? (freiwillig)"
            hint="Ein Satz hilft bei der Entscheidung, ist aber kein Muss."
            value={reason}
            onChange={setReason}
            inputProps={{ maxLength: 500 }}
          />

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={busy || game.trim() === ''}>
              Wunsch abschicken
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-3 pb-2">
          <p className="text-sm text-ink-muted">
            Du hast schon einen offenen Wunsch. Solange er offen ist, geht kein zweiter – ziehe ihn
            zurück, wenn dir ein anderes Spiel wichtiger ist.
          </p>

          <div className="flex flex-col gap-1 rounded-xl border border-line bg-fill p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-semibold text-ink">{offen.game}</span>
              <Badge tone="warning">Offen</Badge>
            </div>
            <span className="text-xs text-ink-faint">
              gewünscht {formatDateTime(offen.createdAt)}
            </span>
            {offen.reason === null ? null : (
              <p className="whitespace-pre-wrap pt-1 text-sm text-ink-muted">{offen.reason}</p>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
              Schließen
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={busy || !offen.permissions.canWithdraw}
              onClick={() => void zurueckziehen()}
            >
              Zurückziehen
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
