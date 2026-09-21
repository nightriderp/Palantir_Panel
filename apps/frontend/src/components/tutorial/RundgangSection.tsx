'use client';

import { Button, ButtonLink, Panel, ToggleRow } from '@/components/shared';
import { useRundgang } from './RundgangProvider';

/**
 * Abschnitt „Rundgang" auf dem Profil (`/profil#rundgang`).
 *
 * Das Gegenstück zum Start von selbst: Hier schaltet man den Rundgang wieder
 * ein, startet ihn sofort oder geht zum ausführlichen Tutorial. Profil und
 * Einstellungen sind seit dem Abgleich 11.1 dieselbe Seite, deshalb steht er
 * hier und nicht unter `/einstellungen` – diese Adresse leitet ohnehin hierher
 * weiter.
 *
 * Der Schalter sagt ehrlich, was er tut: Er stellt den Stand in **diesem
 * Browser** um. Wo der Stand liegt und warum, steht in `rundgangStand.ts`.
 */
export function RundgangSection() {
  const { erledigt, starten, wiederZeigen } = useRundgang();

  return (
    <Panel>
      <h2 className="text-xl font-semibold text-ink">Rundgang</h2>
      <p className="mt-0.5 text-sm text-ink-soft">
        Die Einweisung, die beim ersten Besuch von selbst aufgeht: ein Scheinwerfer auf die
        wichtigsten Knöpfe, ein Zettel daneben. Du kannst sie hier jederzeit wieder anwerfen – auch
        wenn wir beide wissen, dass du sie beim ersten Mal weggeklickt hast.
      </p>

      <div className="mt-4">
        <ToggleRow
          title="Beim nächsten Besuch wieder zeigen"
          description={
            erledigt
              ? 'Gerade aus. Der Rundgang hält still, bis du ihn holst.'
              : 'Gerade an. Beim nächsten Laden des Panels geht er von selbst auf.'
          }
          checked={!erledigt}
          onChange={wiederZeigen}
        />
      </div>

      <div className="mt-4 flex flex-wrap gap-2.5">
        <Button variant="primary" iconLeft="play" onClick={starten}>
          Rundgang jetzt starten
        </Button>
        <ButtonLink href="/tutorial" variant="secondary" iconLeft="cap">
          Zum ausführlichen Tutorial
        </ButtonLink>
      </div>

      <p className="mt-3 text-xs text-ink-faint">
        Gemerkt wird das in diesem Browser, nicht am Konto: An einem anderen Gerät begrüßt dich der
        Rundgang noch einmal.
      </p>
    </Panel>
  );
}
