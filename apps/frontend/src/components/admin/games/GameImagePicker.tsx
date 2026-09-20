'use client';

import { type GameTypeDto } from '@palantir/contracts';
import { useRef, useState } from 'react';
import { Button, ImageCropper, useToast } from '@/components/shared';
import { errorText } from '@/lib/api/client';
import { removeGameTypeImage, uploadGameTypeImage } from '@/lib/api/admin';

/**
 * Symbol und Kachelbild einer Vorlage austauschen (Betreiber-Wunsch
 * vom 19.09.2026, Vorbild hafenmeister).
 *
 * **Zugeschnitten wird im Browser** (`ImageCropper`), wie beim Profilbild: Das
 * Backend bekommt ein fertiges Bild in der richtigen Form und muss keine
 * fremden Dateien dekodieren. Das Symbol ist quadratisch, das Kachelbild
 * sechzehn zu neun – so, wie beide später erscheinen.
 *
 * Ohne Bild bleibt es bei den Anfangsbuchstaben; „Entfernen" stellt genau das
 * wieder her.
 */

interface Stelle {
  readonly kind: 'icon' | 'cover';
  readonly titel: string;
  readonly hinweis: string;
  readonly aspect: number;
  readonly maxLongEdge: number;
  readonly maxBytes: number;
}

const STELLEN: readonly Stelle[] = [
  {
    kind: 'icon',
    titel: 'Symbol',
    hinweis: 'Quadratisch, steht in der Kachel und auf den Server-Karten.',
    aspect: 1,
    maxLongEdge: 512,
    maxBytes: 512 * 1024,
  },
  {
    kind: 'cover',
    titel: 'Kachelbild',
    hinweis: 'Breit (16:9), liegt hinter der Kachel in der Spielauswahl.',
    aspect: 16 / 9,
    maxLongEdge: 1280,
    maxBytes: 2 * 1024 * 1024,
  },
];

export function GameImagePicker({
  game,
  weitere = [],
  disabled,
  onChanged,
}: {
  game: GameTypeDto;
  /**
   * Weitere Vorlagen, die dasselbe Bild bekommen sollen (Betreiber-Wunsch
   * 20.09.2026).
   *
   * Die Templates-Seite fasst Varianten desselben Spiels zu einer Karte
   * zusammen – Minecraft belegte sonst fünf davon, und jede wollte dasselbe
   * Bild einzeln hochgeladen bekommen.
   *
   * **Gespeichert wird weiterhin je Vorlage.** Das Bild geht nacheinander an
   * jede Kennung; es gibt keinen Gruppen-Eintrag in der Datenbank. Der Preis
   * ist sichtbar: Fünf Varianten sind fünf Abrufe. Der Gewinn ist, dass eine
   * einzelne Variante später ein eigenes Bild bekommen kann, ohne dass dafür
   * ein Sonderweg nötig wäre.
   */
  weitere?: readonly GameTypeDto[];
  disabled: boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<Stelle['kind'] | null>(null);
  const [auswahl, setAuswahl] = useState<{ stelle: Stelle; file: File } | null>(null);
  const eingaben = useRef<Record<string, HTMLInputElement | null>>({});

  function bildVon(stelle: Stelle): string | null {
    return stelle.kind === 'icon' ? game.iconUrl : game.coverImageUrl;
  }

  async function hochladen(stelle: Stelle, datei: File): Promise<void> {
    setAuswahl(null);
    setBusy(stelle.kind);
    let ergebnis = await uploadGameTypeImage(game.id, stelle.kind, datei);

    /*
     * Die übrigen Varianten der Gruppe bekommen dieselbe Datei. Nacheinander
     * und nicht nebeneinander: Der Abruf trägt ein Bild im Körper, und fünf
     * davon gleichzeitig auf einer Heimleitung sind kein Gewinn.
     *
     * Scheitert einer, steht es sofort da – das Bild liegt dann bei einigen
     * Varianten und bei anderen nicht. Das ist der ehrliche Zustand, und er
     * lässt sich durch ein zweites Hochladen beheben; eine Umkehr, die bereits
     * geschriebene Bilder wieder entfernt, wäre bei einem Netzfehler mitten
     * drin genauso lückenhaft.
     */
    for (const andere of weitere) {
      if (!ergebnis.success) {
        break;
      }

      ergebnis = await uploadGameTypeImage(andere.id, stelle.kind, datei);
    }
    setBusy(null);

    if (!ergebnis.success) {
      toast.error(errorText(ergebnis));

      return;
    }

    toast.success(
      weitere.length === 0
        ? `${stelle.titel} für „${game.name}" gespeichert.`
        : `${stelle.titel} für ${String(weitere.length + 1)} Varianten gespeichert.`,
    );
    onChanged();
  }

  async function entfernen(stelle: Stelle): Promise<void> {
    setBusy(stelle.kind);
    let ergebnis = await removeGameTypeImage(game.id, stelle.kind);

    // Wie beim Hochladen: Was gemeinsam gesetzt wurde, wird gemeinsam entfernt.
    for (const andere of weitere) {
      if (!ergebnis.success) {
        break;
      }

      ergebnis = await removeGameTypeImage(andere.id, stelle.kind);
    }
    setBusy(null);

    if (!ergebnis.success) {
      toast.error(errorText(ergebnis));

      return;
    }

    toast.success(`${stelle.titel} entfernt.`);
    onChanged();
  }

  return (
    <div className="flex flex-col gap-2 border-t border-line pt-2">
      {STELLEN.map((stelle) => {
        const bild = bildVon(stelle);

        return (
          <div key={stelle.kind} className="flex items-center gap-2">
            {/*
              Vorschau in der Form, in der das Bild später steht – ein
              quadratisches Symbol neben einem breiten Kachelbild sagt mehr als
              zwei gleich große Kästen.
            */}
            <span
              aria-hidden
              className="flex h-8 shrink-0 items-center justify-center overflow-hidden rounded border border-line bg-fill text-2xs text-ink-faint"
              style={{ width: stelle.kind === 'icon' ? 32 : 56 }}
            >
              {bild === null ? (
                'leer'
              ) : (
                /* Die Adresse kommt vom Backend und ist zur Bauzeit unbekannt;
                   `next/image` bräuchte dafür eine konfigurierte Domain. */
                // eslint-disable-next-line @next/next/no-img-element
                <img src={bild} alt="" className="h-full w-full object-cover" />
              )}
            </span>

            <span className="min-w-0 flex-1 truncate text-xs text-ink-faint" title={stelle.hinweis}>
              {stelle.titel}
            </span>

            <input
              ref={(element) => {
                eingaben.current[stelle.kind] = element;
              }}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(event) => {
                const datei = event.target.files?.[0];
                event.target.value = '';

                if (datei !== undefined) {
                  setAuswahl({ stelle, file: datei });
                }
              }}
            />

            <Button
              variant="secondary"
              size="sm"
              disabled={disabled || busy !== null}
              onClick={() => eingaben.current[stelle.kind]?.click()}
            >
              {bild === null ? 'Hochladen' : 'Ersetzen'}
            </Button>

            {bild === null ? null : (
              <Button
                variant="ghost"
                size="sm"
                disabled={disabled || busy !== null}
                onClick={() => void entfernen(stelle)}
              >
                Entfernen
              </Button>
            )}
          </div>
        );
      })}

      {auswahl === null ? null : (
        <ImageCropper
          file={auswahl.file}
          aspect={auswahl.stelle.aspect}
          maxLongEdge={auswahl.stelle.maxLongEdge}
          maxBytes={auswahl.stelle.maxBytes}
          title={`${auswahl.stelle.titel} zuschneiden`}
          hint="Ziehen zum Verschieben, Regler zum Vergrößern."
          onCancel={() => setAuswahl(null)}
          onDone={(datei) => void hochladen(auswahl.stelle, datei)}
        />
      )}
    </div>
  );
}
