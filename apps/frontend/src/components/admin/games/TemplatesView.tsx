'use client';

import { type GameTypeDto, type InstanceSettingsDto } from '@palantir/contracts';
import { useState } from 'react';
import { useSession } from '@/app/(dashboard)/SessionProvider';
import { PageHeader, Panel, Toggle, cn, useToast } from '@/components/shared';
import { errorText } from '@/lib/api/client';
import { fetchInstanceSettings, updateInstanceSettings } from '@/lib/api/admin';
import { fetchGameTypes } from '@/lib/api/servers';
import { useApiResource } from '@/lib/api/useApiResource';
import { AdminAccessNotice, AdminError, AdminLoading } from '../common';

/**
 * Verwaltung der Spiel-Vorlagen (Wunsch des Betreibers, 2026-09-11).
 *
 * **Was hier nicht passiert:** Vorlagen anlegen, bearbeiten oder löschen. Der
 * Katalog bleibt Code (Lastenheft §6, Pflichtenheft §11) — neue Spiele kommen
 * über Deployment, nicht über ein Formular. Hier steht nur, **was diese Instanz
 * davon anbietet**: Jede Vorlage hat einen Schalter, und ausgeschaltete
 * verschwinden aus dem Anlegen-Wizard.
 *
 * Das ist der Unterschied zwischen „welche Spiele gibt es" und „welche biete
 * ich an" — und nur die zweite Frage gehört dem Betreiber einer Instanz.
 *
 * **Laufende Server bleiben laufen.** Ausschalten betrifft das Angebot, nicht
 * den Bestand; sonst hätte der Betreiber einen Server, den er nicht mehr
 * stoppen könnte. Der Hinweis steht auch auf der Seite, damit niemand es
 * ausprobieren muss.
 */
export function TemplatesView() {
  const { user, loading } = useSession();
  const toast = useToast();
  const canManage = user?.permissions.canManageGameTypes ?? false;

  const spiele = useApiResource<GameTypeDto[]>(
    (signal) => fetchGameTypes(signal),
    canManage ? [] : null,
  );
  const settings = useApiResource<InstanceSettingsDto>(
    (signal) => fetchInstanceSettings(signal),
    canManage ? [] : null,
  );

  const [busy, setBusy] = useState<string | null>(null);

  if (loading) {
    return <AdminLoading label="Templates werden geöffnet …" />;
  }

  if (!canManage) {
    return <AdminAccessNotice area={'die Spiele-Verwaltung „Templates"'} />;
  }

  if (spiele.error !== null) {
    return <AdminError message={spiele.error} onRetry={() => void spiele.reload()} />;
  }

  if (settings.error !== null) {
    return <AdminError message={settings.error} onRetry={() => void settings.reload()} />;
  }

  const liste = spiele.data ?? [];
  const stand = settings.data;
  const ausgeschaltet = new Set(stand?.disabledGameTypes ?? []);

  /*
   * Speichern schickt den vollständigen Zustand – die Instanz-Einstellungen
   * kennen keine Teiländerung. `selfRegistrationEnabled` ist deshalb der gerade
   * geladene Wert und keine Vorgabe: Sonst schaltete ein Klick hier nebenbei
   * die Registrierung um.
   */
  async function umschalten(spiel: GameTypeDto, an: boolean) {
    if (!stand) return;

    const naechste = new Set(ausgeschaltet);
    if (an) {
      naechste.delete(spiel.id);
    } else {
      naechste.add(spiel.id);
    }

    setBusy(spiel.id);
    const result = await updateInstanceSettings({
      selfRegistrationEnabled: stand.selfRegistrationEnabled,
      disabledGameTypes: [...naechste].sort(),
    });
    setBusy(null);

    if (!result.success) {
      toast.error(errorText(result));

      return;
    }

    settings.setData(result.data);
    toast.success(
      an
        ? `${spiel.name} steht wieder zur Auswahl.`
        : `${spiel.name} wird nicht mehr angeboten. Laufende Server bleiben unberührt.`,
    );
  }

  const darfAendern = stand?.permissions.canEdit ?? false;
  // Was die Instanz tatsächlich anbietet: eingeschaltet **und** von der
  // Ausbaustufe freigegeben.
  const angeboten = liste.filter((spiel) => spiel.available && !ausgeschaltet.has(spiel.id)).length;

  return (
    <>
      <PageHeader title="Templates" subtitle="Welche Spiele diese Instanz anbietet" />

      <div className="flex flex-col gap-4 p-5">
        <Panel variant="outline">
          <p className="text-sm text-ink-soft">
            <strong className="text-ink">
              {angeboten} von {liste.length} Vorlagen werden angeboten.
            </strong>{' '}
            Neue Spiele kommen über ein Deployment, nicht über diese Seite (Lastenheft §6). Hier
            entscheidest du nur, was im Anlegen-Wizard zur Auswahl steht.{' '}
            <strong className="text-ink">Laufende Server bleiben laufen</strong> – ein
            ausgeschaltetes Spiel lässt sich weiterhin stoppen, sichern und löschen.
          </p>
          {darfAendern ? null : (
            <p className="mt-2 text-sm text-warning">
              Zum Ändern fehlt dir das Recht, Konten und Instanz-Einstellungen zu verwalten.
            </p>
          )}
        </Panel>

        {liste.length === 0 ? (
          <AdminLoading label="Vorlagen werden geladen …" />
        ) : (
          /*
           * Kacheln statt einer Liste (Wunsch des Betreibers, 2026-09-11).
           *
           * Mit dreizehn Spielen wurde die Liste länger als der Bildschirm, und
           * jede Zeile trug eine Beschreibung, die man beim Umschalten nicht
           * braucht. Die Kachel zeigt nur Name und Schalter; die Beschreibung
           * steht als Titel daran, für den, der sie sucht.
           */
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {liste.map((spiel) => {
              const an = !ausgeschaltet.has(spiel.id);
              /*
               * Die Phasen-Sperre ist keine Entscheidung des Administrators:
               * Was die Instanz in ihrer Ausbaustufe noch gar nicht anbieten
               * kann, lässt sich auch nicht einschalten. Der Schalter bleibt
               * sichtbar, damit die Kachel nicht anders aussieht als die
               * übrigen – und trägt den Grund darunter.
               */
              const phasenGesperrt = !spiel.available && an;
              const hinweis = phasenGesperrt
                ? (spiel.unavailableReason ?? null)
                : an
                  ? null
                  : 'Nicht im Wizard';

              return (
                <Panel
                  key={spiel.id}
                  variant="outline"
                  padding="sm"
                  // Ausgeschaltet blasser: Was angeboten wird, soll sich beim
                  // Überfliegen vom Rest abheben.
                  className={cn('flex items-center gap-3', !an && 'opacity-60')}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink" title={spiel.description}>
                      {spiel.name}
                    </p>
                    {hinweis === null ? null : (
                      <p className="truncate text-xs text-ink-faint" title={hinweis}>
                        {hinweis}
                      </p>
                    )}
                  </div>

                  <Toggle
                    label={spiel.name}
                    checked={an}
                    disabled={busy !== null || !darfAendern || phasenGesperrt}
                    onChange={(next) => void umschalten(spiel, next)}
                  />
                </Panel>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
