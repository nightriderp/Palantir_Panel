'use client';

import {
  OVERVIEW_TILE_ADDRESS_MAX_LENGTH,
  OVERVIEW_TILE_GAME_LABEL_MAX_LENGTH,
  OVERVIEW_TILE_LINK_LABEL_MAX_LENGTH,
  OVERVIEW_TILE_LINK_URL_MAX_LENGTH,
  OVERVIEW_TILE_SORT_ORDER_MAX,
  OVERVIEW_TILE_SUBTITLE_MAX_LENGTH,
  OVERVIEW_TILE_TITLE_MAX_LENGTH,
  type GameTypeDto,
  type OverviewTileDto,
} from '@palantir/contracts';
import { createOverviewTileInputSchema } from '@palantir/validation';
import { useMemo, useState } from 'react';
import {
  Button,
  DangerConfirmDialog,
  FormModal,
  NumberField,
  OverviewTile,
  PageHeader,
  Panel,
  SelectField,
  TextField,
  useToast,
} from '@/components/shared';
import { useSession } from '@/app/(dashboard)/SessionProvider';
import { type ApiResult, errorText } from '@/lib/api/client';
import {
  createOverviewTile,
  deleteOverviewTile,
  fetchOverviewTiles,
  updateOverviewTile,
} from '@/lib/api/overview-tiles';
import { fetchGameTypes } from '@/lib/api/servers';
import { useApiResource } from '@/lib/api/useApiResource';
import { AdminAccessNotice, AdminError, AdminLoading } from '../common';

/**
 * Übersichts-Kacheln ohne Server (Betreiber-Wunsch 26.09.2026).
 *
 * Eine Kachel wirbt in der Übersicht für etwas, das kein Server dieses Panels
 * ist – ein befreundeter Server auf einer fremden Instanz, ein Discord. Sie
 * sieht hier genauso aus wie dort: Die Liste zeigt jede Kachel mit derselben
 * Komponente, damit der Administrator beim Bearbeiten sieht, was alle sehen.
 */

type Editor = { mode: 'create' } | { mode: 'edit'; tile: OverviewTileDto } | null;

export function KachelnView() {
  const { user } = useSession();
  const toast = useToast();
  const canManage = user?.permissions.canManageInstance ?? false;

  const resource = useApiResource<OverviewTileDto[]>(
    (signal) => fetchOverviewTiles(signal),
    canManage ? [] : null,
  );
  const spieltypen = useApiResource<GameTypeDto[]>(
    (signal) => fetchGameTypes(signal),
    canManage ? [] : null,
  );
  const spieleKarte = useMemo(() => {
    const karte = new Map<string, GameTypeDto>();

    for (const spiel of spieltypen.data ?? []) karte.set(spiel.id, spiel);

    return karte;
  }, [spieltypen.data]);

  const [editor, setEditor] = useState<Editor>(null);
  const [toDelete, setToDelete] = useState<OverviewTileDto | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirmDelete() {
    if (!toDelete) return;
    setBusy(true);
    const result = await deleteOverviewTile(toDelete.id);
    setBusy(false);
    if (result.success) {
      toast.success(`Kachel „${toDelete.title}" entfernt.`);
      setToDelete(null);
      resource.reload();
    } else {
      toast.error(errorText(result));
    }
  }

  if (!canManage) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Kacheln" className="-mx-5 -mt-5 px-5" />
        <AdminAccessNotice area="Übersichts-Kacheln" />
      </div>
    );
  }

  const tiles = resource.data ?? [];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Kacheln"
        subtitle={
          'Kacheln in der Übersicht für Server, die nicht in diesem Panel laufen – für alle sichtbar, unter „Angepinnt".'
        }
        className="-mx-5 -mt-5 px-5"
        actions={
          <Button variant="primary" iconLeft="plus" onClick={() => setEditor({ mode: 'create' })}>
            Neue Kachel
          </Button>
        }
      />

      {resource.loading ? (
        <AdminLoading label="Kacheln werden geladen …" />
      ) : resource.error ? (
        <AdminError message={resource.error} onRetry={resource.reload} />
      ) : tiles.length === 0 ? (
        <Panel className="text-center text-base text-ink-faint">
          Noch keine Kachel angelegt. Eine Kachel zeigt Name, Spiel, Adresse und einen Link – mehr
          nicht, denn dahinter steht kein Server dieses Panels.
        </Panel>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(20rem,1fr))] gap-4">
          {tiles.map((tile) => {
            const spiel = tile.gameTypeId === null ? null : spieleKarte.get(tile.gameTypeId);

            return (
              <li key={tile.id} className="flex flex-col gap-2">
                <OverviewTile
                  tile={tile}
                  gameIconUrl={spiel?.iconUrl ?? null}
                  gameCoverUrl={spiel?.coverImageUrl ?? null}
                  gameTypeName={spiel?.name ?? null}
                />
                <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-ink-faint">
                  <span>Reihenfolge {tile.sortOrder}</span>
                  <span className="flex gap-2">
                    {tile.permissions.canEdit ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        iconLeft="gear"
                        onClick={() => setEditor({ mode: 'edit', tile })}
                      >
                        Bearbeiten
                      </Button>
                    ) : null}
                    {tile.permissions.canDelete ? (
                      <Button
                        variant="danger"
                        size="sm"
                        iconLeft="trash"
                        onClick={() => setToDelete(tile)}
                      >
                        Entfernen
                      </Button>
                    ) : null}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editor ? (
        <KachelEditor
          editor={editor}
          spiele={spieltypen.data ?? []}
          busy={busy}
          setBusy={setBusy}
          onClose={() => setEditor(null)}
          onSaved={(title) => {
            toast.success(
              editor.mode === 'create'
                ? `Kachel „${title}" angelegt.`
                : `Kachel „${title}" gespeichert.`,
            );
            setEditor(null);
            resource.reload();
          }}
        />
      ) : null}

      {toDelete ? (
        <DangerConfirmDialog
          open
          onClose={() => setToDelete(null)}
          title={`„${toDelete.title}" entfernen?`}
          confirmLabel="Entfernen"
          busy={busy}
          onConfirm={() => void confirmDelete()}
          message="Die Kachel verschwindet aus der Übersicht aller Konten. Der Server dahinter ist davon nicht betroffen – er läuft nicht in diesem Panel."
        />
      ) : null}
    </div>
  );
}

function KachelEditor({
  editor,
  spiele,
  busy,
  setBusy,
  onClose,
  onSaved,
}: {
  editor: Exclude<Editor, null>;
  spiele: GameTypeDto[];
  busy: boolean;
  setBusy: (value: boolean) => void;
  onClose: () => void;
  onSaved: (title: string) => void;
}) {
  const initial = editor.mode === 'edit' ? editor.tile : null;
  const [title, setTitle] = useState(initial?.title ?? '');
  const [subtitle, setSubtitle] = useState(initial?.subtitle ?? '');
  const [gameTypeId, setGameTypeId] = useState(initial?.gameTypeId ?? '');
  const [gameLabel, setGameLabel] = useState(initial?.gameLabel ?? '');
  const [address, setAddress] = useState(initial?.address ?? '');
  const [linkUrl, setLinkUrl] = useState(initial?.linkUrl ?? '');
  const [linkLabel, setLinkLabel] = useState(initial?.linkLabel ?? '');
  const [sortOrder, setSortOrder] = useState<number | null>(initial?.sortOrder ?? 0);
  const [error, setError] = useState<string | null>(null);

  /*
   * Dieselbe Prüfung wie im Backend, vor dem Absenden: Der Knopf bleibt aus,
   * solange die Eingabe dort scheitern würde – und die Meldung nennt das Feld.
   */
  const eingabe = {
    title,
    subtitle: subtitle || null,
    gameTypeId: gameTypeId || null,
    gameLabel: gameLabel || null,
    address: address || null,
    linkUrl: linkUrl || null,
    linkLabel: linkLabel || null,
    sortOrder: sortOrder ?? 0,
  };
  const pruefung = createOverviewTileInputSchema.safeParse(eingabe);
  const feldfehler = new Map<string, string>();

  if (!pruefung.success) {
    for (const issue of pruefung.error.issues) {
      const feld = String(issue.path[0] ?? '');
      if (!feldfehler.has(feld)) feldfehler.set(feld, issue.message);
    }
  }

  async function submit() {
    if (!pruefung.success) return;
    setBusy(true);
    setError(null);

    const result: ApiResult<OverviewTileDto> =
      editor.mode === 'create'
        ? await createOverviewTile(pruefung.data)
        : await updateOverviewTile(editor.tile.id, pruefung.data);

    setBusy(false);
    if (result.success) {
      onSaved(result.data.title);
    } else {
      setError(errorText(result));
    }
  }

  return (
    <FormModal
      open
      onClose={onClose}
      title={editor.mode === 'create' ? 'Neue Kachel' : 'Kachel bearbeiten'}
      submitLabel={editor.mode === 'create' ? 'Anlegen' : 'Speichern'}
      submitDisabled={!pruefung.success}
      busy={busy}
      error={error}
      onSubmit={() => void submit()}
    >
      <TextField
        label="Titel"
        value={title}
        onChange={setTitle}
        placeholder="z. B. AirStrafingAddicts.com Surf"
        error={title.length > 0 ? feldfehler.get('title') : undefined}
        inputProps={{ maxLength: OVERVIEW_TILE_TITLE_MAX_LENGTH }}
      />
      <TextField
        label="Untertitel (optional)"
        value={subtitle}
        onChange={setSubtitle}
        placeholder="z. B. Öffentlicher Movement-Server – by ReY"
        error={feldfehler.get('subtitle')}
        inputProps={{ maxLength: OVERVIEW_TILE_SUBTITLE_MAX_LENGTH }}
      />
      <SelectField
        label="Spiel (für Symbol und Kachelbild)"
        value={gameTypeId}
        onChange={setGameTypeId}
        placeholder="Kein Spiel aus dem Katalog"
        options={spiele.map((spiel) => ({ value: spiel.id, label: spiel.name }))}
        hint="Symbol und Kachelbild kommen von der Vorlage unter Administration › Bilder."
      />
      <TextField
        label="Spielbezeichnung (optional)"
        value={gameLabel}
        onChange={setGameLabel}
        placeholder="z. B. CS2 · Surf"
        hint="Steht als Chip auf der Kachel – wenn das Spiel allein nicht sagt, was dort gespielt wird."
        error={feldfehler.get('gameLabel')}
        inputProps={{ maxLength: OVERVIEW_TILE_GAME_LABEL_MAX_LENGTH }}
      />
      <TextField
        label="Verbindungsadresse (optional)"
        value={address}
        onChange={setAddress}
        placeholder="host:port"
        hint="Ohne Adresse zeigt die Kachel den Chip ausgegraut."
        error={feldfehler.get('address')}
        inputProps={{ maxLength: OVERVIEW_TILE_ADDRESS_MAX_LENGTH, spellCheck: false }}
      />
      <TextField
        label="Link (optional)"
        value={linkUrl}
        onChange={setLinkUrl}
        placeholder="https://discord.gg/…"
        error={linkUrl.length > 0 ? feldfehler.get('linkUrl') : undefined}
        inputProps={{ maxLength: OVERVIEW_TILE_LINK_URL_MAX_LENGTH, spellCheck: false }}
      />
      <TextField
        label="Beschriftung des Links (optional)"
        value={linkLabel}
        onChange={setLinkLabel}
        placeholder="z. B. ASA Discord"
        error={feldfehler.get('linkLabel')}
        inputProps={{ maxLength: OVERVIEW_TILE_LINK_LABEL_MAX_LENGTH }}
      />
      <NumberField
        label="Reihenfolge"
        value={sortOrder}
        onChange={setSortOrder}
        min={0}
        max={OVERVIEW_TILE_SORT_ORDER_MAX}
        hint="Kleine Zahl zuerst; gleiche Zahl sortiert nach Titel."
        error={feldfehler.get('sortOrder')}
      />
    </FormModal>
  );
}
