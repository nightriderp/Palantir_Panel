import {
  type GameConfigField,
  type GameConfigValue,
  type GameConfigValues,
  type GameTypeDto,
  type HostNodeDto,
  type SubdomainAvailabilityDto,
  type ResourceQuotaDto,
} from '@palantir/contracts';
import { serverNameSchema, subdomainSchema } from '@palantir/validation';
import { formatMegabytes } from '@/components/shared';

/**
 * Ablauflogik des „Server erstellen"-Wizards (Lastenheft §3.3).
 *
 * Reine Funktionen ohne React: Welcher Schritt ist erreichbar, was fehlt noch,
 * was steht in der Zusammenfassung. So bleibt die Schrittsteuerung prüfbar und
 * die Ansicht kümmert sich nur ums Darstellen.
 *
 * Alle Formatregeln kommen aus `@palantir/validation`; verbindlich prüft immer
 * das Backend. Die Rückmeldungen hier ersparen dem Nutzer nur den Fehlversuch.
 */

export const WIZARD_STEPS = ['game', 'basics', 'options', 'summary'] as const;

export type WizardStep = (typeof WIZARD_STEPS)[number];

export const WIZARD_STEP_LABELS: Record<WizardStep, string> = {
  game: 'Spiel',
  basics: 'Grundlagen',
  options: 'Optionen',
  summary: 'Übersicht',
};

export interface WizardState {
  gameType: string | null;
  name: string;
  subdomain: string;
  hostId: string | null;
  ramMb: number;
  cpuCores: number;
  diskMb: number;
  config: GameConfigValues;
  startupParameters: string;
  autoShutdownEnabled: boolean;
  /** Übernommene Weltdaten (Lastenheft §3.3); `null`, wenn keine gewählt sind. */
  worldImport: { uploadId: string; fileName: string } | null;
}

/** Voreinstellungen, solange kein Spiel gewählt ist. */
export const INITIAL_WIZARD_STATE: WizardState = {
  gameType: null,
  name: '',
  subdomain: '',
  hostId: null,
  ramMb: 2048,
  cpuCores: 2,
  diskMb: 10240,
  config: {},
  startupParameters: '',
  autoShutdownEnabled: true,
  worldImport: null,
};

/** Standardwerte des Config-Schemas eines Spieltyps. */
export function defaultConfigValues(gameType: GameTypeDto): GameConfigValues {
  const values: GameConfigValues = {};
  for (const field of gameType.configFields) {
    values[field.key] = field.defaultValue;
  }
  return values;
}

/**
 * Zustand auf ein gewähltes Spiel umstellen.
 *
 * Ressourcen und Konfiguration kommen aus der Empfehlung des Spieltyps; was der
 * Nutzer bereits eingetippt hat (Name, Subdomain, Node), bleibt erhalten.
 */
export function applyGameType(state: WizardState, gameType: GameTypeDto): WizardState {
  return {
    ...state,
    gameType: gameType.id,
    ramMb: gameType.resourceDefaults.ramMb,
    cpuCores: gameType.resourceDefaults.cpuCores,
    diskMb: gameType.resourceDefaults.diskMb,
    config: defaultConfigValues(gameType),
    worldImport: gameType.supportsWorldImport ? state.worldImport : null,
  };
}

/** Pflichtfelder des Config-Schemas, die noch leer sind. */
export function missingConfigFields(
  gameType: GameTypeDto | null,
  config: GameConfigValues,
): GameConfigField[] {
  if (!gameType) return [];
  return gameType.configFields.filter((field) => {
    if (!field.required) return false;
    const value = config[field.key];
    if (value === undefined || value === null) return true;
    return typeof value === 'string' && value.trim().length === 0;
  });
}

/**
 * Überschreiten die gewünschten Werte das Kontingent des Nutzers?
 *
 * Erste der beiden Prüfungen aus Pflichtenheft §10. `remaining === null` heißt
 * „für diese Ressource gilt kein Limit" (Lastenheft §3.4). Verbindlich prüft
 * das Backend erneut (`RESOURCE_LIMIT_EXCEEDED`).
 *
 * Der Rest steht fertig gerechnet im DTO (`ResourceQuotaSlot.remaining`, nie
 * negativ) – hier wird nichts aus Limit und Belegung nachgerechnet. Damit gilt
 * automatisch dieselbe Zählweise wie in der harten Kapazitätsprüfung des
 * Backends: RAM und CPU zählen laufende Server, Speicherplatz alle, die
 * Serveranzahl die gleichzeitig laufenden.
 */
export function quotaBlockReason(
  quota: ResourceQuotaDto | null,
  state: WizardState,
): string | null {
  if (!quota) return null;
  const { ram, cpu, disk, servers } = quota;

  // Der neue Server zählt als einer mehr – bleibt kein Rest, ist Schluss.
  if (servers.remaining !== null && servers.remaining < 1) {
    return `Dein Kontingent erlaubt höchstens ${servers.limit} Server gleichzeitig.`;
  }
  if (ram.remaining !== null && state.ramMb > ram.remaining) {
    return `Dein RAM-Kontingent von ${formatMegabytes(ram.limit ?? 0)} reicht dafür nicht aus.`;
  }
  if (cpu.remaining !== null && state.cpuCores > cpu.remaining) {
    return `Dein CPU-Kontingent von ${cpu.limit} Kernen reicht dafür nicht aus.`;
  }
  if (disk.remaining !== null && state.diskMb > disk.remaining) {
    return `Dein Speicher-Kontingent von ${formatMegabytes(disk.limit ?? 0)} reicht dafür nicht aus.`;
  }
  return null;
}

/**
 * Reicht der freie Platz auf der gewählten Node?
 *
 * Zweite Prüfung aus Pflichtenheft §10 – sie greift unabhängig davon, ob das
 * Nutzer-Kontingent noch Luft hätte.
 */
export function nodeBlockReason(node: HostNodeDto | null, state: WizardState): string | null {
  if (!node) return null;
  if (node.status !== 'online') {
    return node.status === 'maintenance'
      ? `„${node.name}" ist gerade in Wartung.`
      : `„${node.name}" ist gerade nicht erreichbar.`;
  }

  // Die freie Kapazität rechnet B8 bereits aus (`capacity.available`).
  const free = node.capacity.available;
  if (state.ramMb > free.ramMb) {
    return `Auf „${node.name}" sind nur noch ${formatMegabytes(free.ramMb)} Arbeitsspeicher frei.`;
  }
  if (state.diskMb > free.diskMb) {
    return `Auf „${node.name}" sind nur noch ${formatMegabytes(free.diskMb)} Speicherplatz frei.`;
  }
  if (state.cpuCores > free.cpuCores) {
    return `Auf „${node.name}" sind nur noch ${free.cpuCores} CPU-Kerne frei.`;
  }
  return null;
}

export interface WizardContext {
  gameType: GameTypeDto | null;
  node: HostNodeDto | null;
  quota: ResourceQuotaDto | null;
  /** Ergebnis der Verfügbarkeitsprüfung; `null`, solange sie noch läuft. */
  subdomainCheck: SubdomainAvailabilityDto | null;
  /** Läuft die Verfügbarkeitsprüfung gerade? */
  subdomainChecking: boolean;
}

/**
 * Was hindert daran, diesen Schritt zu verlassen?
 *
 * `null` bedeutet: alles beisammen. Der Text erscheint neben der
 * „Weiter"-Schaltfläche, damit nicht nur eine graue Schaltfläche dasteht.
 */
export function stepBlockReason(
  step: WizardStep,
  state: WizardState,
  context: WizardContext,
): string | null {
  switch (step) {
    case 'game':
      if (!state.gameType) return 'Wähle zuerst ein Spiel.';
      if (context.gameType && !context.gameType.available) {
        return context.gameType.unavailableReason ?? 'Dieses Spiel steht noch nicht bereit.';
      }
      return null;

    case 'basics': {
      const name = serverNameSchema.safeParse(state.name);
      if (!name.success) return name.error.issues[0]?.message ?? 'Der Servername passt noch nicht.';

      const subdomain = subdomainSchema.safeParse(state.subdomain);
      if (!subdomain.success) {
        return subdomain.error.issues[0]?.message ?? 'Die Subdomain passt noch nicht.';
      }
      if (context.subdomainChecking) return 'Die Subdomain wird geprüft …';
      if (!context.subdomainCheck) return 'Die Subdomain wurde noch nicht geprüft.';
      if (!context.subdomainCheck.available) return context.subdomainCheck.message;

      if (!state.hostId) return 'Wähle eine Node.';
      return nodeBlockReason(context.node, state) ?? quotaBlockReason(context.quota, state);
    }

    case 'options': {
      const missing = missingConfigFields(context.gameType, state.config);
      if (missing.length > 0) {
        return `Bitte ausfüllen: ${missing.map((field) => field.label).join(', ')}.`;
      }
      return null;
    }

    case 'summary':
      // Vor dem Anlegen noch einmal alles prüfen: zwischen Schritt 2 und dem
      // Klick kann die Node vollgelaufen sein.
      return (
        stepBlockReason('game', state, context) ??
        stepBlockReason('basics', state, context) ??
        stepBlockReason('options', state, context)
      );
  }
}

/** Eine Zeile der Zusammenfassung im letzten Schritt. */
export interface WizardSummaryRow {
  label: string;
  value: string;
}

function formatConfigValue(field: GameConfigField, value: GameConfigValue | undefined): string {
  if (value === undefined) return '—';
  if (field.type === 'password') return '••••••';
  if (typeof value === 'boolean') return value ? 'An' : 'Aus';
  return String(value);
}

/** Zusammenfassung für den letzten Schritt (Lastenheft §4: Deutsch). */
export function buildSummaryRows(
  state: WizardState,
  context: WizardContext,
  baseDomain: string,
): WizardSummaryRow[] {
  const rows: WizardSummaryRow[] = [
    { label: 'Spiel', value: context.gameType?.name ?? '—' },
    { label: 'Name', value: state.name || '—' },
    {
      label: 'Adresse',
      value: state.subdomain ? `${state.subdomain}.${baseDomain}` : '—',
    },
    { label: 'Node', value: context.node?.name ?? '—' },
    { label: 'Arbeitsspeicher', value: formatMegabytes(state.ramMb) },
    { label: 'CPU', value: `${state.cpuCores} Kerne` },
    { label: 'Speicherplatz', value: formatMegabytes(state.diskMb) },
    {
      label: 'Automatisch abschalten',
      value: state.autoShutdownEnabled ? 'An' : 'Aus',
    },
  ];

  if (state.startupParameters.trim().length > 0) {
    rows.push({ label: 'Startparameter', value: state.startupParameters.trim() });
  }

  if (state.worldImport) {
    rows.push({ label: 'Weltdaten', value: `Übernahme aus ${state.worldImport.fileName}` });
  }

  for (const field of context.gameType?.configFields ?? []) {
    rows.push({
      label: field.label,
      value: formatConfigValue(field, state.config[field.key]),
    });
  }

  return rows;
}
