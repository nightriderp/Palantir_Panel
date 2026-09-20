import {
  type GameConfigField,
  type GameConfigValue,
  type GameConfigValues,
  type GameTypeDto,
  type HostNodeDto,
  type SubdomainAvailabilityDto,
  type ResourceQuotaDto,
  type ResourceQuotaSlot,
} from '@palantir/contracts';
import { serverNameSchema, subdomainSchema } from '@palantir/validation';
import { QUOTA_COUNTING_LABELS, formatMegabytes } from '@/components/shared';

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
  /**
   * Gewaehlte Spielversion, z. B. `26.3`; `null` heisst „die des Images".
   *
   * Nur Spiele mit `supportsVersionChoice` bieten die Wahl an; bei allen
   * anderen bleibt das Feld leer und wird nicht mitgeschickt.
   */
  gameVersion: string | null;
  name: string;
  subdomain: string;
  hostId: string | null;
  ramMb: number;
  /**
   * Geschätzter Platzbedarf des gewählten Spiels in MiB – **keine Zuweisung**.
   *
   * Der Wert kommt aus `resourceDefaults` und wandert nicht in die Anlage-
   * Anfrage: Ein Server nimmt sich den Platz, den er braucht. Er dient der
   * Übersicht und der Frage, ob das voraussichtlich noch auf die Node passt.
   */
  diskMb: number;
  config: GameConfigValues;
  startupParameters: string;
  autoShutdownEnabled: boolean;
  /** Übernommene Weltdaten (Lastenheft §3.3); `null`, wenn keine gewählt sind. */
  worldImport: { uploadId: string; fileName: string } | null;
  /**
   * Hat der Nutzer RAM oder Platzbedarf selbst eingestellt?
   *
   * Solange nicht, sind die Werte der Vorschlag des Spiels und dürfen von einem
   * Wechsel der Variante nachgezogen werden – NeoForge schlägt 6144 MiB vor,
   * Paper 2048. Hat er sie angefasst, sind es **seine** Werte, und ein Wechsel
   * fasst sie nicht mehr an (Betreiber-Wunsch 20.09.2026, Variantenwahl im
   * Schritt „Optionen").
   */
  ressourcenAngefasst: boolean;
}

/** Voreinstellungen, solange kein Spiel gewählt ist. */
export const INITIAL_WIZARD_STATE: WizardState = {
  gameType: null,
  /** Gewählte Spielversion; `null` heißt „die des Images". */
  gameVersion: null,
  name: '',
  subdomain: '',
  hostId: null,
  ramMb: 2048,
  diskMb: 10240,
  config: {},
  startupParameters: '',
  autoShutdownEnabled: true,
  worldImport: null,
  ressourcenAngefasst: false,
};

/**
 * Eine Kachel der Spielauswahl (Betreiber-Wunsch 20.09.2026).
 *
 * Entweder ein Spiel für sich – dann steht genau ein Eintrag in `variants` –
 * oder eine Gruppe wie „Minecraft", hinter der Paper, Vanilla, Fabric und
 * NeoForge stecken. Vier Kacheln für ein Spiel nahmen ein Viertel der Auswahl
 * ein; ein Spiel ist eine Kachel, die Ausgabe wählt man darunter.
 *
 * **Die Gruppe ist Darstellung, kein Zustand.** Gewählt wird immer eine
 * Variante, und `WizardState.gameType` trägt deren Kennung – alles Nachgelagerte
 * (Ressourcen-Vorschlag, Startfrist, Schnellbefehle) bleibt unberührt.
 */
export interface GameChoice {
  /** Schlüssel für die Liste; bei einer Gruppe deren Name, sonst die Kennung. */
  key: string;
  /** Beschriftung der Kachel: der Gruppenname oder der Name des Spiels. */
  label: string;
  /** Die Varianten dahinter, in der Reihenfolge der Registry. */
  variants: GameTypeDto[];
}

/**
 * Spieleliste zu Kacheln zusammenfassen.
 *
 * Gruppiert wird nach `variantGroup`; die Stelle der Gruppe ist die ihres
 * ersten Mitglieds, damit sich die Reihenfolge der Registry nicht verschiebt.
 *
 * **Eine Gruppe mit einem Mitglied ist keine Gruppe.** Der Administrator kann
 * einzelne Spieltypen abschalten, und bei „Minecraft" mit nur noch Paper darin
 * trüge die Kachel den Gruppennamen, während die Auswahl darunter nichts zu
 * wählen hätte. Dann steht das Spiel unter seinem eigenen Namen da, wie vor
 * dieser Änderung.
 */
export function buildGameChoices(games: GameTypeDto[]): GameChoice[] {
  const choices: GameChoice[] = [];
  const groups = new Map<string, GameChoice>();

  for (const game of games) {
    const group = game.variantGroup ?? null;

    if (group === null || group === '') {
      choices.push({ key: game.id, label: game.name, variants: [game] });
      continue;
    }

    const vorhanden = groups.get(group);

    if (vorhanden === undefined) {
      const neu: GameChoice = { key: group, label: group, variants: [game] };
      groups.set(group, neu);
      choices.push(neu);
      continue;
    }

    vorhanden.variants.push(game);
  }

  return choices.map((choice) =>
    choice.variants.length === 1 && choice.variants[0] !== undefined
      ? { key: choice.variants[0].id, label: choice.variants[0].name, variants: choice.variants }
      : choice,
  );
}

/** Die Kachel, unter der ein gewählter Spieltyp steckt; `null`, wenn keiner gewählt ist. */
export function findGameChoice(
  choices: GameChoice[],
  gameTypeId: string | null,
): GameChoice | null {
  if (gameTypeId === null) return null;

  return (
    choices.find((choice) => choice.variants.some((variant) => variant.id === gameTypeId)) ?? null
  );
}

/**
 * Beschriftung einer Variante in der Auswahl unter der Kachel.
 *
 * `variantLabel` ist der kurze Name („Paper"). Fehlt er – ein Spieltyp mit
 * Gruppe, aber ohne eigenen Namen –, bleibt der vollständige Anzeigename: eine
 * Zeile, die zu lang ist, ist besser als eine leere.
 */
export function variantChoiceLabel(game: GameTypeDto): string {
  const label = game.variantLabel ?? null;
  return label === null || label === '' ? game.name : label;
}

/**
 * Hinweistext unter der Variantenwahl: Beschreibung der Ausgabe – und, wo es
 * darauf ankommt, ein Satz zur Adressform (Betreiber-Wunsch 20.09.2026).
 *
 * **Warum das überhaupt nötig ist.** Unter der Minecraft-Kachel stehen fünf
 * Ausgaben, und vier davon sind über eine Adresse ohne Portnummer erreichbar
 * (`supportsVirtualHostRouting`, Pflichtenheft §13). Bedrock ist es nicht – es
 * spricht UDP auf 19132, und der Hostname-Router vor den Java-Servern greift
 * dort nicht. Ein Wechsel im Aufklappmenü änderte damit stillschweigend, was
 * der Spieler später eintippen muss.
 *
 * **Nur wenn die Gruppe sich uneinig ist.** Sind alle Ausgaben gleich – wie bei
 * jedem Spiel ausser Minecraft –, wäre der Satz eine Selbstverständlichkeit,
 * die man nach dem zweiten Lesen überspringt. Dann steht dort nur die
 * Beschreibung, wie bisher.
 *
 * Der Hinweis nennt **beide** Fälle beim Namen: Wer Bedrock wählt, soll wissen,
 * dass es hier anders ist als nebenan; wer von Bedrock zurück auf Paper geht,
 * soll sehen, dass der Port wieder wegfällt.
 */
export function variantHint(
  gewaehlt: GameTypeDto | null,
  varianten: readonly GameTypeDto[],
): string | undefined {
  if (gewaehlt === null) {
    return undefined;
  }

  const beschreibung = gewaehlt.description;
  const formen = new Set(varianten.map((variante) => variante.supportsVirtualHostRouting));

  if (formen.size < 2) {
    return beschreibung;
  }

  const adresse = gewaehlt.supportsVirtualHostRouting
    ? 'Diese Ausgabe ist ohne Portnummer erreichbar – anders als andere Ausgaben dieses Spiels.'
    : 'Diese Ausgabe braucht eine Portnummer in der Adresse – anders als die übrigen Ausgaben dieses Spiels.';

  return beschreibung === '' ? adresse : `${beschreibung} ${adresse}`;
}

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
 *
 * Ein anderes Spiel ist ein Neuanfang: Auch selbst eingestellte Ressourcen
 * werden ersetzt, und `ressourcenAngefasst` fängt wieder bei `false` an. Wer
 * von Minecraft zu Valheim wechselt, will nicht den RAM-Wert von Minecraft
 * behalten.
 */
export function applyGameType(state: WizardState, gameType: GameTypeDto): WizardState {
  return {
    ...state,
    gameType: gameType.id,
    ramMb: gameType.resourceDefaults.ramMb,
    diskMb: gameType.resourceDefaults.diskMb,
    config: defaultConfigValues(gameType),
    worldImport: gameType.supportsWorldImport ? state.worldImport : null,
    ressourcenAngefasst: false,
    gameVersion: null,
  };
}

/**
 * Zustand auf eine andere **Variante desselben Spiels** umstellen.
 *
 * Der Unterschied zu {@link applyGameType} ist kein Feinschliff, sondern der
 * Grund, warum die Variantenwahl überhaupt in den Schritt „Optionen" darf: Dort
 * steht sie **neben** den Feldern, die sie sonst überschriebe.
 *
 * - **Ressourcen** werden nur nachgezogen, solange der Nutzer sie nicht selbst
 *   eingestellt hat. Sonst hätte ein Wechsel von Paper auf NeoForge
 *   stillschweigend seine 8 GiB auf die 6 GiB der Vorgabe gesetzt.
 * - **Konfigurationswerte bleiben**, soweit die neue Variante dieselben Felder
 *   kennt – und das tun die vier Minecraft-Ausgaben, sie teilen sich das
 *   Schema. Wer Spielmodus und Spielerzahl eingestellt hat und dann die Ausgabe
 *   wechselt, findet sie wieder. Felder, die es nur bei der neuen gibt,
 *   bekommen ihre Vorgabe; Felder, die es nicht mehr gibt, fallen weg.
 * - **Die gewählte Spielversion fällt weg.** Jede Ausgabe hat ihren eigenen
 *   Katalog; `26.2` bei Paper ist nicht dieselbe Zeile wie `26.2` bei Vanilla,
 *   und eine Version stehenzulassen, die der neue Katalog vielleicht nicht
 *   führt, endete beim Anlegen in „nicht (mehr) zu finden".
 */
export function applyGameVariant(state: WizardState, gameType: GameTypeDto): WizardState {
  const vorgaben = defaultConfigValues(gameType);
  const uebernommen: GameConfigValues = {};

  for (const [schluessel, vorgabe] of Object.entries(vorgaben)) {
    const bisher = state.config[schluessel];
    uebernommen[schluessel] = bisher === undefined ? vorgabe : bisher;
  }

  return {
    ...state,
    gameType: gameType.id,
    ramMb: state.ressourcenAngefasst ? state.ramMb : gameType.resourceDefaults.ramMb,
    diskMb: state.ressourcenAngefasst ? state.diskMb : gameType.resourceDefaults.diskMb,
    config: uebernommen,
    worldImport: gameType.supportsWorldImport ? state.worldImport : null,
    gameVersion: null,
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
 * Halbsatz „belegt zählen …" für eine Kachel (Fundpunkt 210).
 *
 * Ohne ihn liest sich „RAM-Kontingent: 0 B frei von 10 GiB" wie ein Fehler,
 * solange die Belegung aus Servern stammt, die gerade laufen. Fehlt `counting`
 * – der Vertrag führt es als optional –, bleibt die Regel ungenannt.
 */
function zaehlung(slot: ResourceQuotaSlot): string {
  return slot.counting === undefined
    ? 'belegt'
    : `belegt zählen ${QUOTA_COUNTING_LABELS[slot.counting]}`;
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
 * Backends: Die Serveranzahl zählt die laufenden Server. RAM, Platz und Kerne
 * stehen hier nicht mehr – nichts davon wird noch fest zugewiesen.
 */
export function quotaBlockReason(
  quota: ResourceQuotaDto | null,
  state: WizardState,
): string | null {
  if (!quota) return null;
  const { servers } = quota;
  // Bleibt in der Signatur, damit Aufrufer und Platzprüfung dieselbe Form
  // behalten; seit dem Wegfall des RAM-Kontingents liest die Prüfung nichts
  // mehr aus dem Wunsch.
  void state;

  // Der neue Server zählt als einer mehr – bleibt kein Rest, ist Schluss.
  if (servers.remaining !== null && servers.remaining < 1) {
    return `Dein Kontingent erlaubt höchstens ${servers.limit} Server gleichzeitig (${zaehlung(
      servers,
    )}).`;
  }
  // RAM ist keine Kontingentgroesse mehr (Betreiber-Entscheidung 2026-09-18);
  // `quota.ram` bleibt im DTO fuer aeltere Backends und wird hier nicht gelesen.
  return null;
}

/**
 * Reicht der freie Platz auf der gewählten Node?
 *
 * Zweite Prüfung aus Pflichtenheft §10 – sie greift unabhängig davon, ob das
 * Nutzer-Kontingent noch Luft hätte.
 */
export function nodeBlockReason(
  node: HostNodeDto | null,
  state: WizardState,
  /** Geschätzter Platzbedarf des gewählten Spiels; ohne Angabe bleibt die Platte außen vor. */
  geschaetzterPlatzMb = 0,
): string | null {
  if (!node) return null;
  if (node.status !== 'online') {
    return node.status === 'maintenance'
      ? `„${node.name}" ist gerade in Wartung.`
      : `„${node.name}" ist gerade nicht erreichbar.`;
  }

  // Gemessen, nicht gebucht: Seit der weichen Zuweisung sagt nur die Messung,
  // was auf der Node frei ist (2026-09-18). Ohne Messung keine Sperre.
  const gemessenBelegt = node.usage?.ramUsedMb;
  if (gemessenBelegt != null) {
    const frei = Math.max(0, node.capacity.total.ramMb - gemessenBelegt);
    if (state.ramMb > frei) {
      return `Auf „${node.name}" sind gemessen nur noch ${formatMegabytes(frei)} Arbeitsspeicher frei.`;
    }
  }

  /*
   * Der Platz kommt aus der Messung der Node, nicht aus der freien Zuweisung –
   * zugewiesen wird keiner mehr. Ohne Messung bleibt die Prüfung aus: Fehlt die
   * Auskunft, soll der Wizard nicht behaupten, es passe nichts mehr.
   */
  const belegt = node.usage?.diskUsedMb;
  const geschaetzt = geschaetzterPlatzMb;

  if (belegt != null && node.capacity.total.diskMb - belegt < geschaetzt) {
    return `Auf „${node.name}" sind nur noch ${formatMegabytes(
      node.capacity.total.diskMb - belegt,
    )} Speicherplatz frei; dieses Spiel braucht voraussichtlich ${formatMegabytes(geschaetzt)}.`;
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
      return (
        nodeBlockReason(context.node, state, context.gameType?.resourceDefaults.diskMb ?? 0) ??
        quotaBlockReason(context.quota, state)
      );
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
    { label: 'Speicherplatz', value: `rund ${formatMegabytes(state.diskMb)}` },
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
