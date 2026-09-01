'use client';

import {
  type GameConfigValue,
  type GameTypeDto,
  type HostNodeDto,
  type ResourceQuotaDto,
} from '@palantir/contracts';
import { type CreateServerInput } from '@palantir/validation';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Icon,
  PageHeader,
  SelectField,
  TextField,
  ToggleRow,
  cn,
  formatMegabytes,
  useToast,
} from '@/components/shared';
import {
  createServer,
  fetchGameTypes,
  fetchHostNodes,
  fetchResourceQuota,
  uploadWorldArchive,
} from '@/lib/api/servers';
import { errorText } from '@/lib/api/client';
import { BASE_DOMAIN } from '@/lib/api/session';
import { useApiResource } from '@/lib/api/useApiResource';
import {
  INITIAL_WIZARD_STATE,
  WIZARD_STEPS,
  WIZARD_STEP_LABELS,
  type WizardContext,
  type WizardState,
  type WizardStep,
  applyGameType,
  buildSummaryRows,
  missingConfigFields,
  quotaBlockReason,
  stepBlockReason,
} from './wizardSteps';
import { QuotaRequestDialog } from './QuotaRequestDialog';
import { ConfigFields } from './form/ConfigFields';
import { ResourceFields } from './form/ResourceFields';
import { useSubdomainCheck } from './useSubdomainCheck';

/**
 * „Server erstellen"-Wizard (Lastenheft §3.3, Mockup „Neuer Server").
 *
 * Vier Schritte: Spiel, Grundlagen, Optionen, Übersicht. Welcher Schritt
 * weitergeht, entscheidet `stepBlockReason()` – die Regeln liegen daneben in
 * einer eigenen, getesteten Datei.
 */

/**
 * Schrittanzeige über dem Wizard (Mockup „Server erstellen").
 *
 * Über die volle Breite: jeder Schritt nimmt denselben Anteil ein, die
 * Beschriftung steht unter dem Kreis, dazwischen läuft eine Linie, die den
 * bereits zurückgelegten Weg in der Markenfarbe zeigt.
 */
function StepIndicator({ current }: { current: WizardStep }) {
  const currentIndex = WIZARD_STEPS.indexOf(current);

  return (
    <ol className="flex items-center">
      {WIZARD_STEPS.map((step, index) => {
        const done = index < currentIndex;
        const active = index === currentIndex;

        return (
          <li key={step} className="flex flex-1 items-center">
            <div className="flex flex-col items-center gap-1.5">
              <span
                className={cn(
                  'flex h-[38px] w-[38px] items-center justify-center rounded-full text-base font-bold',
                  done && 'bg-brand text-white',
                  active && 'border-2 border-brand bg-brand-soft text-brand',
                  !done && !active && 'bg-fill-strong text-ink-faint',
                )}
              >
                {done ? <Icon name="check" size={16} /> : index + 1}
              </span>
              <span
                className={cn('whitespace-nowrap text-xs', active ? 'text-ink' : 'text-ink-muted')}
              >
                {WIZARD_STEP_LABELS[step]}
              </span>
            </div>

            {index < WIZARD_STEPS.length - 1 ? (
              <span
                aria-hidden
                className={cn('mx-2 h-0.5 flex-1', done ? 'bg-brand' : 'bg-line-strong')}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function GameTile({
  game,
  selected,
  onSelect,
}: {
  game: GameTypeDto;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!game.available}
      aria-pressed={selected}
      className={cn(
        'flex flex-col gap-2 rounded-2xl border p-4 text-left',
        selected ? 'border-brand bg-brand-soft' : 'border-line bg-card-gradient',
        !game.available && 'cursor-not-allowed opacity-60',
      )}
    >
      <span
        aria-hidden
        className="flex h-20 items-center justify-center rounded-tile bg-fill text-2xs uppercase tracking-[0.1em] text-ink-faint"
      >
        {game.coverImageUrl ? (
          /* Die Adresse kommt aus der Spiele-Registry und ist zur Bauzeit unbekannt;
             `next/image` bräuchte dafür eine konfigurierte Domain. */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={game.coverImageUrl}
            alt=""
            className="h-full w-full rounded-tile object-cover"
          />
        ) : (
          'Titelbild'
        )}
      </span>

      <span className="flex items-center gap-2">
        <span className="text-lg font-bold">{game.name}</span>
        {!game.available ? <Badge tone="warning">Kommt später</Badge> : null}
      </span>

      <span className="text-sm text-ink-soft">
        {game.available ? game.description : (game.unavailableReason ?? game.description)}
      </span>

      <span className="text-xs text-ink-faint">
        Empfohlen: {formatMegabytes(game.resourceDefaults.ramMb)} RAM ·{' '}
        {game.resourceDefaults.cpuCores} Kerne
      </span>
    </button>
  );
}

export function CreateServerWizard() {
  const router = useRouter();
  const toast = useToast();

  const [step, setStep] = useState<WizardStep>('game');
  const [state, setState] = useState<WizardState>(INITIAL_WIZARD_STATE);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const gameTypes = useApiResource<GameTypeDto[]>((signal) => fetchGameTypes(signal), []);
  const nodes = useApiResource<HostNodeDto[]>((signal) => fetchHostNodes(signal), []);
  const quota = useApiResource<ResourceQuotaDto>((signal) => fetchResourceQuota(signal), []);

  const subdomain = useSubdomainCheck(state.subdomain);

  const selectedGame = useMemo(
    () => gameTypes.data?.find((game) => game.id === state.gameType) ?? null,
    [gameTypes.data, state.gameType],
  );
  const selectedNode = useMemo(
    () => nodes.data?.find((node) => node.id === state.hostId) ?? null,
    [nodes.data, state.hostId],
  );

  const context: WizardContext = {
    gameType: selectedGame,
    node: selectedNode,
    quota: quota.data,
    subdomainCheck: subdomain.result,
    subdomainChecking: subdomain.checking,
  };

  const blockReason = stepBlockReason(step, state, context);
  const [quotaDialog, setQuotaDialog] = useState(false);
  const stepIndex = WIZARD_STEPS.indexOf(step);
  const isLastStep = stepIndex === WIZARD_STEPS.length - 1;
  const missingKeys = missingConfigFields(selectedGame, state.config).map((field) => field.key);

  function patch(changes: Partial<WizardState>) {
    setState((current) => ({ ...current, ...changes }));
  }

  function setConfigValue(key: string, value: GameConfigValue) {
    setState((current) => ({ ...current, config: { ...current.config, [key]: value } }));
  }

  async function handleWorldArchive(file: File) {
    setUploading(true);
    const result = await uploadWorldArchive(file);
    setUploading(false);

    if (!result.success) {
      toast.error(errorText(result));
      return;
    }
    patch({ worldImport: { uploadId: result.data.uploadId, fileName: file.name } });
    toast.success('Weltdaten hochgeladen – sie werden beim Anlegen übernommen.');
  }

  async function submit() {
    if (!state.gameType || !state.hostId) return;

    const input: CreateServerInput = {
      gameType: state.gameType,
      name: state.name.trim(),
      subdomain: state.subdomain.trim().toLowerCase(),
      hostId: state.hostId,
      resourceLimits: { ramMb: state.ramMb, cpuCores: state.cpuCores, diskMb: state.diskMb },
      config: state.config,
      startupParameters: state.startupParameters.trim(),
      autoShutdownEnabled: state.autoShutdownEnabled,
      worldImport: state.worldImport,
    };

    setSubmitting(true);
    setSubmitError(null);
    const result = await createServer(input);
    setSubmitting(false);

    if (!result.success) {
      setSubmitError(errorText(result));
      return;
    }

    toast.success(`„${result.data.name}" wird angelegt.`);
    router.push(`/servers/${result.data.id}`);
  }

  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-5">
      <PageHeader
        title="Neuen Server erstellen"
        subtitle="In wenigen Schritten zum eigenen Gameserver"
        className="-mx-5 -mt-5 px-5"
        actions={
          <Button iconLeft="arrowLeft" onClick={() => router.push('/servers')}>
            Zurück zur Übersicht
          </Button>
        }
      />

      <StepIndicator current={step} />

      {/* Ohne umschließende Karte, wie im Mockup: der Wizard ist die Seite. */}
      <div className="flex flex-col gap-5">
        {step === 'game' ? (
          <>
            <h2 className="text-xl font-bold">Wähle dein Spiel</h2>

            {gameTypes.loading ? <p className="text-base text-ink-muted">Wird geladen …</p> : null}
            {gameTypes.error ? <p className="text-base text-danger">{gameTypes.error}</p> : null}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(gameTypes.data ?? []).map((game) => (
                <GameTile
                  key={game.id}
                  game={game}
                  selected={game.id === state.gameType}
                  onSelect={() => setState((current) => applyGameType(current, game))}
                />
              ))}
            </div>
          </>
        ) : null}

        {step === 'basics' ? (
          <>
            <h2 className="text-xl font-bold">Grundlagen</h2>

            <TextField
              label="Servername"
              placeholder="z. B. Survival Runde"
              value={state.name}
              onChange={(value) => patch({ name: value })}
            />

            <TextField
              label="Adresse"
              placeholder="subdomain"
              suffix={`.${BASE_DOMAIN}`}
              value={state.subdomain}
              onChange={(value) => patch({ subdomain: value.toLowerCase() })}
              error={subdomain.formatError}
              hint={
                subdomain.checking
                  ? 'Verfügbarkeit wird geprüft …'
                  : subdomain.result
                    ? subdomain.result.message
                    : 'Kleinbuchstaben, Ziffern und Bindestriche.'
              }
            />

            <SelectField
              label="Node"
              placeholder="Node wählen …"
              value={state.hostId ?? ''}
              onChange={(value) => patch({ hostId: value || null })}
              options={(nodes.data ?? []).map((node) => ({
                value: node.id,
                label:
                  node.status === 'online'
                    ? `${node.name} · ${formatMegabytes(node.capacity.available.ramMb)} frei`
                    : `${node.name} · ${node.status === 'maintenance' ? 'in Wartung' : 'nicht erreichbar'}`,
                disabled: node.status !== 'online',
              }))}
              hint={
                nodes.data && nodes.data.length === 0
                  ? 'Zurzeit ist keine Node verfügbar.'
                  : undefined
              }
              error={nodes.error}
            />

            <ResourceFields
              ramMb={state.ramMb}
              cpuCores={state.cpuCores}
              diskMb={state.diskMb}
              onChange={(values) => patch(values)}
            />
          </>
        ) : null}

        {step === 'options' ? (
          <>
            <h2 className="text-xl font-bold">Optionen</h2>

            {selectedGame ? (
              <ConfigFields
                fields={selectedGame.configFields}
                values={state.config}
                onChange={setConfigValue}
                lockAfterCreate={false}
                missingKeys={missingKeys}
              />
            ) : null}

            <TextField
              label="Startparameter"
              placeholder="z. B. -Xmx4G"
              hint="Werden dem Server beim Start als PALANTIR_STARTUP_PARAMETERS übergeben. Leer lassen, wenn unsicher."
              value={state.startupParameters}
              onChange={(value) => patch({ startupParameters: value })}
            />

            <ToggleRow
              title="Automatisch herunterfahren, wenn niemand spielt"
              description="Spart Speicher und Platte, wenn ein Server aus Versehen weiterläuft."
              checked={state.autoShutdownEnabled}
              onChange={(checked) => patch({ autoShutdownEnabled: checked })}
            />

            {selectedGame?.supportsWorldImport ? (
              <div className="flex flex-col gap-2 rounded-md border border-line bg-fill p-3.5">
                <div className="text-base font-semibold">Bestehende Weltdaten übernehmen</div>
                <p className="text-xs text-ink-faint">
                  Optional: Archiv eines bisherigen Anbieters hochladen. Es wird beim Anlegen in den
                  Datenordner entpackt.
                </p>

                {state.worldImport ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="success" withDot>
                      {state.worldImport.fileName}
                    </Badge>
                    <Button variant="ghost" size="sm" onClick={() => patch({ worldImport: null })}>
                      Entfernen
                    </Button>
                  </div>
                ) : (
                  <label className="flex w-fit cursor-pointer items-center gap-2 rounded-md border border-line-strong bg-fill px-4 py-2.5 text-base font-semibold text-ink">
                    <Icon name="upload" size={14} />
                    {uploading ? 'Wird hochgeladen …' : 'Archiv wählen'}
                    <input
                      type="file"
                      accept=".zip,.tar,.tar.gz,.tgz"
                      className="hidden"
                      disabled={uploading}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void handleWorldArchive(file);
                        event.target.value = '';
                      }}
                    />
                  </label>
                )}
              </div>
            ) : null}
          </>
        ) : null}

        {step === 'summary' ? (
          <>
            <h2 className="text-xl font-bold">Übersicht</h2>
            <p className="text-base text-ink-muted">
              Prüfe die Konfiguration und erstelle den Server.
            </p>

            <dl className="divide-y divide-line rounded-md border border-line">
              {buildSummaryRows(state, context, BASE_DOMAIN).map((row) => (
                <div key={row.label} className="flex justify-between gap-4 px-3.5 py-2.5">
                  <dt className="text-sm text-ink-soft">{row.label}</dt>
                  <dd className="text-right font-mono text-sm text-ink">{row.value}</dd>
                </div>
              ))}
            </dl>

            {submitError ? (
              <p
                role="alert"
                className="rounded border border-danger-line bg-danger-soft px-3 py-2 text-sm text-danger"
              >
                {submitError}
              </p>
            ) : null}
          </>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <Button
            disabled={stepIndex === 0 || submitting}
            onClick={() => setStep(WIZARD_STEPS[stepIndex - 1] ?? 'game')}
          >
            Zurück
          </Button>

          <span className="min-w-0 flex-1 text-xs text-warning">
            {blockReason}
            {/*
             * Der Weg zum Antrag steht dort, wo die Grenze auffaellt
             * (Mockup-Abgleich 12.3.1). Nur bei einer Kontingent-Sperre: Eine
             * volle Node laesst sich nicht beantragen.
             */}
            {blockReason !== null && quota.data !== null && quotaBlockReason(quota.data, state) ? (
              <>
                {' '}
                <button
                  type="button"
                  onClick={() => setQuotaDialog(true)}
                  className="font-semibold text-brand underline-offset-2 hover:underline"
                >
                  Mehr beantragen
                </button>
              </>
            ) : null}
          </span>

          {isLastStep ? (
            <Button
              variant="success"
              disabled={blockReason !== null || submitting}
              onClick={() => void submit()}
            >
              {submitting ? 'Wird angelegt …' : 'Server erstellen'}
            </Button>
          ) : (
            <Button
              variant="primary"
              iconRight="arrowRight"
              disabled={blockReason !== null}
              onClick={() => setStep(WIZARD_STEPS[stepIndex + 1] ?? 'summary')}
            >
              Weiter
            </Button>
          )}
        </div>
      </div>

      {quotaDialog && quota.data !== null ? (
        <QuotaRequestDialog quota={quota.data} onClose={() => setQuotaDialog(false)} />
      ) : null}
    </div>
  );
}
