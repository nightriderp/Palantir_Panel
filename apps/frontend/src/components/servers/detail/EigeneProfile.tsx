'use client';

import { type GameConfigValues, type UserPresetDto } from '@palantir/contracts';
import { useState } from 'react';
import { Button, SelectField, TextField, useToast } from '@/components/shared';
import { type ApiResult, errorText } from '@/lib/api/client';
import { useApiResource } from '@/lib/api/useApiResource';
import {
  createUserPreset,
  deleteUserPreset,
  fetchUserPresets,
  updateUserPreset,
} from '@/lib/api/user-presets';

/**
 * Eigene Profile in der Steuerung (Idee P / A2, Betreiber 26.09.2026).
 *
 * Wählen legt die Werte in den Entwurf – übernommen wird wie immer mit
 * „Übernehmen“. Speichern nimmt den aktuellen Entwurf, nur Felder der
 * Steuerung. Jedes Konto sieht nur seine eigenen Profile.
 */
export interface EigeneProfileProps {
  gameType: string;
  /** Aktueller Entwurf der Steuerung. */
  entwurf: GameConfigValues;
  /** Schlüssel der Felder, die die Steuerung kennt – nur die werden gespeichert. */
  felder: readonly string[];
  onWaehlen: (werte: GameConfigValues) => void;
  disabled?: boolean;
}

export function EigeneProfile({
  gameType,
  entwurf,
  felder,
  onWaehlen,
  disabled = false,
}: EigeneProfileProps) {
  const toast = useToast();
  const profile = useApiResource<UserPresetDto[]>(
    (signal) => fetchUserPresets(gameType, signal),
    [gameType],
  );
  const [gewaehlt, setGewaehlt] = useState('');
  const [neuerName, setNeuerName] = useState<string | null>(null);
  const [loeschenBestaetigen, setLoeschenBestaetigen] = useState(false);
  const [busy, setBusy] = useState(false);

  const liste = profile.data ?? [];
  const aktiv = liste.find((profil) => profil.id === gewaehlt) ?? null;

  function werteZumSpeichern(): GameConfigValues {
    const werte: GameConfigValues = {};

    for (const key of felder) {
      const wert = entwurf[key];
      if (wert !== undefined) werte[key] = wert;
    }

    return werte;
  }

  /** `true` bei Erfolg; sonst steht der Fehler schon im Toast. */
  async function ausfuehren<T>(
    arbeit: () => Promise<ApiResult<T>>,
    erfolg: string,
  ): Promise<ApiResult<T>> {
    setBusy(true);
    const ergebnis = await arbeit();
    setBusy(false);

    if (!ergebnis.success) {
      toast.error(errorText(ergebnis));
    } else {
      toast.success(erfolg);
      profile.reload();
    }

    return ergebnis;
  }

  async function speichern() {
    const name = (neuerName ?? '').trim();
    if (name === '') return;

    const neu = await ausfuehren(
      () => createUserPreset({ gameType, name, values: werteZumSpeichern() }),
      `Profil „${name}“ gespeichert.`,
    );

    if (neu.success) {
      setNeuerName(null);
      setGewaehlt(neu.data.id);
    }
  }

  async function ueberschreiben() {
    if (aktiv === null) return;

    await ausfuehren(
      () => updateUserPreset(aktiv.id, { values: werteZumSpeichern() }),
      `Profil „${aktiv.name}“ mit den aktuellen Werten überschrieben.`,
    );
  }

  async function loeschen() {
    if (aktiv === null) return;

    if (!loeschenBestaetigen) {
      setLoeschenBestaetigen(true);

      return;
    }

    setLoeschenBestaetigen(false);
    const weg = await ausfuehren(
      () => deleteUserPreset(aktiv.id),
      `Profil „${aktiv.name}“ gelöscht.`,
    );

    if (weg.success) setGewaehlt('');
  }

  return (
    <section aria-label="Eigene Profile" className="flex flex-col gap-2">
      <p className="text-xs font-medium tracking-wide text-ink-faint uppercase">Eigene Profile</p>

      <SelectField
        label="Eigenes Profil"
        value={gewaehlt}
        placeholder={liste.length === 0 ? 'Noch keine eigenen Profile' : 'Profil wählen …'}
        options={liste.map((profil) => ({ value: profil.id, label: profil.name }))}
        disabled={disabled || busy || liste.length === 0}
        onChange={(id) => {
          setGewaehlt(id);
          setLoeschenBestaetigen(false);
          const profil = liste.find((eintrag) => eintrag.id === id);
          if (profil !== undefined) onWaehlen(profil.values);
        }}
      />

      {neuerName === null ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={disabled || busy} onClick={() => setNeuerName('')}>
            Als Profil speichern
          </Button>
          {aktiv === null ? null : (
            <>
              <Button
                variant="secondary"
                disabled={disabled || busy}
                onClick={() => void ueberschreiben()}
              >
                Überschreiben
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => void loeschen()}>
                {loeschenBestaetigen ? 'Wirklich löschen?' : 'Löschen'}
              </Button>
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <TextField
              label="Name des Profils"
              value={neuerName}
              placeholder="z. B. Mirage Smokes"
              autoFocus
              onChange={setNeuerName}
            />
          </div>
          <Button
            variant="primary"
            disabled={busy || neuerName.trim() === ''}
            onClick={() => void speichern()}
          >
            Speichern
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => setNeuerName(null)}>
            Abbrechen
          </Button>
        </div>
      )}
    </section>
  );
}
