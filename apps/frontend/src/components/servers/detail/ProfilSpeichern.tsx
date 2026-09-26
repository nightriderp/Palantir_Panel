'use client';

import { type GameConfigValues, type UserPresetDto } from '@palantir/contracts';
import { useState } from 'react';
import { Button, TextField, useToast } from '@/components/shared';
import { type ApiResult, errorText } from '@/lib/api/client';
import { createUserPreset, deleteUserPreset, updateUserPreset } from '@/lib/api/user-presets';

/**
 * Eigene Profile speichern und löschen (Idee P / A2, Betreiber 26.09.2026).
 *
 * Sitzt unten in der Steuerung neben „Übernehmen“: ein Speichern-Symbol, das
 * ein Namensfeld aufklappt. Heißt ein eigenes Profil schon so, wird es
 * überschrieben. Ausgewählt werden eigene Profile im normalen Profil-Menü.
 */
export interface ProfilSpeichernProps {
  gameType: string;
  /** Eigene Profile des Kontos für dieses Spiel. */
  eigene: readonly UserPresetDto[];
  /** Im Profil-Menü gewähltes eigenes Profil – dann lässt es sich löschen. */
  gewaehlt: UserPresetDto | null;
  /** Werte, die gespeichert werden (nur Felder der Steuerung). */
  werte: () => GameConfigValues;
  /** Nach Speichern oder Löschen – die Liste neu laden. */
  onGeaendert: (gespeichert: UserPresetDto | null) => void;
  disabled?: boolean;
}

export function ProfilSpeichern({
  gameType,
  eigene,
  gewaehlt,
  werte,
  onGeaendert,
  disabled = false,
}: ProfilSpeichernProps) {
  const toast = useToast();
  const [name, setName] = useState<string | null>(null);
  const [loeschenBestaetigen, setLoeschenBestaetigen] = useState(false);
  const [busy, setBusy] = useState(false);

  const vorhanden =
    name === null ? null : (eigene.find((profil) => profil.name === name.trim()) ?? null);

  async function ausfuehren<T>(arbeit: () => Promise<ApiResult<T>>, erfolg: string) {
    setBusy(true);
    const ergebnis = await arbeit();
    setBusy(false);

    if (!ergebnis.success) {
      toast.error(errorText(ergebnis));
    } else {
      toast.success(erfolg);
    }

    return ergebnis;
  }

  async function speichern() {
    const titel = (name ?? '').trim();
    if (titel === '') return;

    const ergebnis =
      vorhanden === null
        ? await ausfuehren(
            () => createUserPreset({ gameType, name: titel, values: werte() }),
            `Profil „${titel}“ gespeichert.`,
          )
        : await ausfuehren(
            () => updateUserPreset(vorhanden.id, { values: werte() }),
            `Profil „${titel}“ überschrieben.`,
          );

    if (ergebnis.success) {
      setName(null);
      onGeaendert(ergebnis.data);
    }
  }

  async function loeschen() {
    if (gewaehlt === null) return;

    if (!loeschenBestaetigen) {
      setLoeschenBestaetigen(true);

      return;
    }

    setLoeschenBestaetigen(false);
    const ergebnis = await ausfuehren(
      () => deleteUserPreset(gewaehlt.id),
      `Profil „${gewaehlt.name}“ gelöscht.`,
    );

    if (ergebnis.success) onGeaendert(null);
  }

  if (name !== null) {
    return (
      <div className="flex w-full flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <TextField
            label="Name des Profils"
            value={name}
            placeholder="z. B. Mirage Smokes"
            autoFocus
            onChange={setName}
          />
        </div>
        <Button
          variant="primary"
          iconLeft="save"
          loading={busy}
          disabled={name.trim() === ''}
          onClick={() => void speichern()}
        >
          {vorhanden === null ? 'Speichern' : 'Überschreiben'}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => setName(null)}>
          Abbrechen
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="secondary"
        iconLeft="save"
        aria-label="Als eigenes Profil speichern"
        title="Als eigenes Profil speichern"
        disabled={disabled || busy}
        onClick={() => setName(gewaehlt?.name ?? '')}
      />
      {gewaehlt === null ? null : (
        <Button
          variant="danger"
          iconLeft={loeschenBestaetigen ? undefined : 'trash'}
          aria-label={
            loeschenBestaetigen ? 'Wirklich löschen?' : `Profil „${gewaehlt.name}“ löschen`
          }
          title={`Profil „${gewaehlt.name}“ löschen`}
          loading={busy}
          onClick={() => void loeschen()}
        >
          {loeschenBestaetigen ? 'Wirklich löschen?' : undefined}
        </Button>
      )}
    </div>
  );
}
