'use client';

import {
  ARCADE_GAMES,
  ARCADE_TRACK_MAX_BYTES,
  ARCADE_TRACK_TITLE_MAX_LENGTH,
  type ArcadeGameId,
  type ArcadeTrackDto,
  type ArcadeTrackListDto,
} from '@palantir/contracts';
import { useState, type ReactNode } from 'react';
import {
  Badge,
  Button,
  DangerConfirmDialog,
  FieldShell,
  FormModal,
  PageHeader,
  Panel,
  SelectField,
  TextField,
  formatBytes,
  formatDateTime,
  useToast,
} from '@/components/shared';
import { useSession } from '@/app/(dashboard)/SessionProvider';
import { errorText } from '@/lib/api/client';
import { useApiResource } from '@/lib/api/useApiResource';
import {
  activateArcadeTrack,
  deactivateArcadeTrack,
  deleteArcadeTrack,
  fetchArcadeTracks,
  uploadArcadeTrack,
} from '@/lib/arcade/api';
import { ArcadeAudioProvider, useArcadeAudio } from '@/lib/arcade/audio/ArcadeAudioProvider';
import { musicRequestKey } from '@/lib/arcade/audio/controller';
import { ARCADE_TRACKS } from '@/lib/arcade/audio/tracks';
import { AdminAccessNotice, AdminError, AdminLoading } from '../common';

/**
 * Arcade-Musik: je Spiel die mitgelieferte Melodie oder ein hochgeladenes Stück.
 *
 * Ohne aktives Stück spielt die Spielhalle die im Browser erzeugte Melodie des
 * Spiels. Ein aktiviertes Stück ersetzt sie; es läuft als Schleife. Vorgehört
 * wird über dieselbe Audio-Engine wie in der Spielhalle – so klingt es hier
 * genau wie später im Spiel.
 *
 * Berechtigung ist `canManageGameTypes`, dieselbe wie für die übrigen
 * Spiele-Einstellungen.
 */

const ACCEPT = '.mp3,.ogg,.wav,audio/mpeg,audio/ogg,audio/wav';
const ENDUNGEN = /\.(mp3|ogg|oga|wav)$/i;

export function ArcadeMusicView() {
  return (
    <ArcadeAudioProvider>
      <MusikVerwaltung />
    </ArcadeAudioProvider>
  );
}

function MusikVerwaltung() {
  const { user } = useSession();
  const toast = useToast();
  const audio = useArcadeAudio();
  const canManage = user?.permissions.canManageGameTypes ?? false;
  const tracks = useApiResource<ArcadeTrackListDto>(
    (signal) => fetchArcadeTracks(signal),
    canManage ? [] : null,
  );
  const [uploadFuer, setUploadFuer] = useState<ArcadeGameId | 'offen' | null>(null);
  const [zuLoeschen, setZuLoeschen] = useState<ArcadeTrackDto | null>(null);
  const [busy, setBusy] = useState(false);

  if (!canManage) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Arcade-Musik" className="-mx-5 -mt-5 px-5" />
        <AdminAccessNotice area="die Musik der Spielhalle" />
      </div>
    );
  }

  const liste = tracks.data?.tracks ?? [];
  const darf = tracks.data?.permissions.canManage ?? true;

  const umschalten = async (track: ArcadeTrackDto) => {
    setBusy(true);
    const result = await (track.isActive
      ? deactivateArcadeTrack(track.id)
      : activateArcadeTrack(track.id));
    setBusy(false);
    if (!result.success) {
      toast.error(errorText(result));
      return;
    }
    audio.invalidateActiveTracks();
    toast.success(
      track.isActive ? `„${track.title}" ist nicht mehr aktiv.` : `„${track.title}" spielt jetzt.`,
    );
    tracks.reload();
  };

  const loeschen = async () => {
    if (!zuLoeschen) return;
    setBusy(true);
    const result = await deleteArcadeTrack(zuLoeschen.id);
    setBusy(false);
    if (!result.success) {
      toast.error(errorText(result));
      return;
    }
    if (audio.playing === musicRequestKey({ kind: 'upload', trackId: zuLoeschen.id }))
      audio.stopMusic();
    audio.invalidateActiveTracks();
    toast.success(`„${zuLoeschen.title}" gelöscht.`);
    setZuLoeschen(null);
    tracks.reload();
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Arcade-Musik"
        subtitle="Je Spiel die mitgelieferte Melodie oder ein eigenes Stück"
        className="-mx-5 -mt-5 px-5"
        actions={
          darf ? (
            <Button variant="primary" iconLeft="upload" onClick={() => setUploadFuer('offen')}>
              Stück hochladen
            </Button>
          ) : null
        }
      />

      <Panel variant="outline" className="text-sm text-ink-muted">
        Jedes Spiel bringt eine eigene, im Browser erzeugte Melodie mit. Ein hochgeladenes Stück
        (MP3, OGG oder WAV, höchstens {formatBytes(ARCADE_TRACK_MAX_BYTES)}) ersetzt sie, sobald es
        aktiv ist – je Spiel höchstens eins. Spieler können Musik und Effekte jederzeit selbst
        leiser stellen oder abschalten.
      </Panel>

      {audio.playing ? (
        <div className="sticky top-2 z-10 flex items-center justify-between gap-3 rounded-xl border border-brand-line bg-brand-soft px-3 py-2 text-sm text-brand">
          <span>Vorschau läuft …</span>
          <Button size="sm" variant="secondary" iconLeft="stop" onClick={audio.stopMusic}>
            Anhalten
          </Button>
        </div>
      ) : null}

      {tracks.loading && tracks.data === null ? (
        <AdminLoading label="Musik wird geladen …" />
      ) : tracks.error && tracks.data === null ? (
        <AdminError message={tracks.error} onRetry={tracks.reload} />
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {ARCADE_GAMES.map((game) => {
            const eigene = liste.filter((track) => track.gameId === game.id);
            const aktiv = eigene.find((track) => track.isActive) ?? null;
            const synthKey = musicRequestKey({ kind: 'synth', gameId: game.id });
            return (
              <li key={game.id}>
                <Panel className="flex flex-col gap-2.5 p-3.5" padding="none">
                  <div className="flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element -- statische SVG-Kachel */}
                    <img
                      src={`/arcade/art/${game.id}.svg`}
                      alt=""
                      className="h-10 rounded-md border border-line object-cover"
                      style={{ aspectRatio: '16 / 10' }}
                      loading="lazy"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-base font-semibold text-ink">{game.name}</div>
                      <div className="text-xs text-ink-faint">
                        {aktiv
                          ? `Spielt: ${aktiv.title}`
                          : `Spielt: ${ARCADE_TRACKS[game.id].title} (mitgeliefert)`}
                      </div>
                    </div>
                    {darf ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        iconLeft="upload"
                        onClick={() => setUploadFuer(game.id)}
                      >
                        Hochladen
                      </Button>
                    ) : null}
                  </div>

                  <TrackZeile
                    titel={ARCADE_TRACKS[game.id].title}
                    angaben={`Mitgeliefert · ${ARCADE_TRACKS[game.id].bpm} BPM`}
                    aktiv={aktiv === null}
                    spielt={audio.playing === synthKey}
                    onAnhoeren={() =>
                      audio.playing === synthKey
                        ? audio.stopMusic()
                        : audio.preview({ kind: 'synth', gameId: game.id })
                    }
                  />
                  {eigene.map((track) => {
                    const key = musicRequestKey({ kind: 'upload', trackId: track.id });
                    return (
                      <TrackZeile
                        key={track.id}
                        titel={track.title}
                        angaben={`${formatBytes(track.sizeBytes)} · ${formatDateTime(track.uploadedAt)}${
                          track.uploadedByDisplayName ? ` · ${track.uploadedByDisplayName}` : ''
                        }`}
                        aktiv={track.isActive}
                        spielt={audio.playing === key}
                        onAnhoeren={() =>
                          audio.playing === key
                            ? audio.stopMusic()
                            : audio.preview({ kind: 'upload', trackId: track.id })
                        }
                        aktionen={
                          darf ? (
                            <>
                              <Button
                                size="sm"
                                variant={track.isActive ? 'secondary' : 'success'}
                                disabled={busy}
                                onClick={() => void umschalten(track)}
                              >
                                {track.isActive ? 'Deaktivieren' : 'Aktivieren'}
                              </Button>
                              <Button
                                size="sm"
                                variant="danger"
                                iconLeft="trash"
                                disabled={busy}
                                onClick={() => setZuLoeschen(track)}
                              >
                                Löschen
                              </Button>
                            </>
                          ) : null
                        }
                      />
                    );
                  })}
                </Panel>
              </li>
            );
          })}
        </ul>
      )}

      {uploadFuer !== null ? (
        <UploadDialog
          initialGame={uploadFuer === 'offen' ? null : uploadFuer}
          onClose={() => setUploadFuer(null)}
          onUploaded={(track) => {
            toast.success(`„${track.title}" hochgeladen. Aktiviere es, damit es im Spiel läuft.`);
            setUploadFuer(null);
            tracks.reload();
          }}
        />
      ) : null}

      {zuLoeschen ? (
        <DangerConfirmDialog
          open
          onClose={() => setZuLoeschen(null)}
          title={`„${zuLoeschen.title}" löschen?`}
          busy={busy}
          onConfirm={() => void loeschen()}
          message={
            zuLoeschen.isActive
              ? 'Das Stück ist gerade aktiv. Danach spielt wieder die mitgelieferte Melodie.'
              : 'Die Datei wird endgültig entfernt.'
          }
        />
      ) : null}
    </div>
  );
}

function TrackZeile({
  titel,
  angaben,
  aktiv,
  spielt,
  onAnhoeren,
  aktionen,
}: {
  titel: string;
  angaben: string;
  aktiv: boolean;
  spielt: boolean;
  onAnhoeren(): void;
  aktionen?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-fill px-2.5 py-2">
      <Button
        size="sm"
        variant={spielt ? 'primary' : 'secondary'}
        iconLeft={spielt ? 'stop' : 'play'}
        onClick={onAnhoeren}
      >
        {spielt ? 'Stopp' : 'Anhören'}
      </Button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-ink">{titel}</span>
          {aktiv ? <Badge tone="success">Aktiv</Badge> : null}
        </div>
        <div className="truncate text-xs text-ink-faint">{angaben}</div>
      </div>
      {aktionen ? <div className="flex gap-1.5">{aktionen}</div> : null}
    </div>
  );
}

function UploadDialog({
  initialGame,
  onClose,
  onUploaded,
}: {
  initialGame: ArcadeGameId | null;
  onClose(): void;
  onUploaded(track: ArcadeTrackDto): void;
}) {
  const [gameId, setGameId] = useState<ArcadeGameId | ''>(initialGame ?? '');
  const [titel, setTitel] = useState('');
  const [datei, setDatei] = useState<File | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pruefen = (): string | null => {
    if (!gameId) return 'Wähle ein Spiel.';
    if (!titel.trim()) return 'Gib dem Stück einen Titel.';
    if (!datei) return 'Wähle eine Datei.';
    if (!ENDUNGEN.test(datei.name)) return 'Nur MP3, OGG oder WAV.';
    if (datei.size > ARCADE_TRACK_MAX_BYTES)
      return `Die Datei ist zu groß (höchstens ${formatBytes(ARCADE_TRACK_MAX_BYTES)}).`;
    return null;
  };

  const hochladen = async () => {
    const problem = pruefen();
    if (problem || !datei || !gameId) {
      setFehler(problem);
      return;
    }
    setBusy(true);
    setFehler(null);
    const result = await uploadArcadeTrack(datei, { gameId, title: titel.trim() });
    setBusy(false);
    if (!result.success) {
      setFehler(errorText(result));
      return;
    }
    onUploaded(result.data);
  };

  return (
    <FormModal
      open
      onClose={onClose}
      title="Stück hochladen"
      description="MP3, OGG oder WAV, höchstens 8 MB. Es läuft im Spiel als Schleife."
      submitLabel="Hochladen"
      onSubmit={() => void hochladen()}
      busy={busy}
      error={fehler}
    >
      <div className="flex flex-col gap-3">
        <SelectField
          label="Spiel"
          value={gameId}
          placeholder="Spiel wählen …"
          onChange={(value) => setGameId(value as ArcadeGameId)}
          options={ARCADE_GAMES.map((game) => ({ value: game.id, label: game.name }))}
        />
        <TextField
          label="Titel"
          value={titel}
          onChange={(value) => setTitel(value.slice(0, ARCADE_TRACK_TITLE_MAX_LENGTH))}
          placeholder="z. B. Pixel-Sommer"
        />
        <FieldShell
          label="Datei"
          hint={datei ? `${datei.name} · ${formatBytes(datei.size)}` : undefined}
        >
          <input
            type="file"
            accept={ACCEPT}
            className="text-sm text-ink-muted file:mr-3 file:rounded-lg file:border file:border-line-strong file:bg-fill file:px-3 file:py-1.5 file:text-ink"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              setDatei(file);
              if (file && !titel)
                setTitel(file.name.replace(/\.[^.]+$/, '').slice(0, ARCADE_TRACK_TITLE_MAX_LENGTH));
            }}
          />
        </FieldShell>
      </div>
    </FormModal>
  );
}
