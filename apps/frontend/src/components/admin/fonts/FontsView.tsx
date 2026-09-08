'use client';

import { type FontDto, type InstanceSettingsDto } from '@palantir/contracts';
import { fontFamilyNameSchema, fontLabelSchema } from '@palantir/validation';
import { useId, useState } from 'react';
import { type ZodTypeAny } from 'zod';
import {
  Badge,
  Button,
  DangerConfirmDialog,
  FieldShell,
  FormModal,
  NumberField,
  PageHeader,
  Panel,
  SelectField,
  TextField,
  ToggleRow,
  formatBytes,
  formatDateTime,
  useToast,
} from '@/components/shared';
import { useSession } from '@/app/(dashboard)/SessionProvider';
import { fetchInstanceSettings, updateInstanceSettings } from '@/lib/api/admin';
import { deleteFont, fetchFonts, reloadFontStylesheet, uploadFont } from '@/lib/api/fonts';
import { useApiResource } from '@/lib/api/useApiResource';
import { AdminAccessNotice, AdminError, AdminLoading, KeyValue } from '../common';
import {
  FONT_ACCEPT_EXTENSIONS,
  FONT_FORMAT_LABELS,
  FONT_SOURCE_LABELS,
  deleteBlockedReason,
  fontErrorMessage,
  weightRangeLabel,
} from './fontLabels';

/**
 * Schriften der Oberfläche (Arbeitspaket S-3, Lastenheft §3.10).
 *
 * Bis hierher lud die Oberfläche Space Grotesk und JetBrains Mono bei jedem
 * Seitenaufruf von Google und gab damit die IP-Adresse jedes Betrachters an
 * einen Dritten weiter (Fundpunkt 151). Jetzt kommen beide aus der Instanz –
 * und der Betreiber kann eigene Schriften hochladen und auswählen.
 *
 * **Zwei Rollen, getrennt besetzt.** Die Oberfläche verträgt jede lesbare
 * Proportionalschrift; Konsole, Logs und Serveradressen brauchen eine
 * dicktengleiche, sonst verrutschen Spalten. Die Auswahl warnt deshalb, wenn
 * für die zweite Rolle eine Proportionalschrift gewählt wird – sie verbietet
 * es aber nicht. Es ist die Instanz des Betreibers.
 *
 * Berechtigung ist `user.manage` (`canManageUsers`) – dieselbe wie für die
 * Instanz-Einstellungen, in denen die Auswahl gespeichert wird.
 */

/** Was die Auswahl anzeigt, solange nichts gewählt ist. */
const VORGABE_WERT = '';

/** Pangramm für die Vorschau einer Proportionalschrift. */
const PROBETEXT = 'Franz jagt im komplett verwahrlosten Taxi quer durch Bayern.';

/**
 * Probe für eine dicktengleiche Schrift.
 *
 * Ziffern und die leicht verwechselbaren Buchstaben untereinander: Bei einer
 * dicktengleichen Schrift stehen sie in einer Spalte, bei einer proportionalen
 * franst der rechte Rand aus – das sieht man in einem Fließtext nicht.
 */
const PROBE_DICKTENGLEICH = ['0123456789', 'ILil1 O0o Ss5', '10.0.0.14:25565'];

export function FontsView() {
  const { user } = useSession();
  const toast = useToast();
  const canManage = user?.permissions.canManageUsers ?? false;

  const fonts = useApiResource<FontDto[]>((signal) => fetchFonts(signal), canManage ? [] : null);
  const settings = useApiResource<InstanceSettingsDto>(
    (signal) => fetchInstanceSettings(signal),
    canManage ? [] : null,
  );

  const [uploadOffen, setUploadOffen] = useState(false);
  const [zuLoeschen, setZuLoeschen] = useState<FontDto | null>(null);
  const [busy, setBusy] = useState(false);

  const liste = fonts.data ?? [];
  const auswahl = settings.data;
  const uiFontId = auswahl?.uiFontId ?? null;
  const monospaceFontId = auswahl?.monospaceFontId ?? null;

  /**
   * Eine Rolle neu besetzen.
   *
   * `PUT` mit dem vollständigen Zustand – die Instanz-Einstellungen kennen keine
   * Teiländerung. Das mitgesendete `selfRegistrationEnabled` ist deshalb der
   * gerade geladene Wert und keine Vorgabe: Sonst schaltete ein Schriftwechsel
   * nebenbei die Registrierung um.
   */
  async function rolleSetzen(rolle: 'ui' | 'mono', fontId: string | null) {
    if (!auswahl) return;

    setBusy(true);
    const result = await updateInstanceSettings({
      selfRegistrationEnabled: auswahl.selfRegistrationEnabled,
      ...(rolle === 'ui' ? { uiFontId: fontId } : { monospaceFontId: fontId }),
    });
    setBusy(false);

    if (!result.success) {
      toast.error(fontErrorMessage(result));
      return;
    }

    settings.setData(result.data);
    // Der Löschschutz hängt an der Auswahl – `canDelete` kann sich gerade
    // geändert haben, in beide Richtungen.
    fonts.reload();
    reloadFontStylesheet();
    toast.success(
      fontId === null
        ? 'Zurück auf die Vorgabe der Instanz.'
        : `Schrift gewechselt: ${liste.find((font) => font.id === fontId)?.label ?? fontId}.`,
    );
  }

  async function loeschenBestaetigen() {
    if (!zuLoeschen) return;

    setBusy(true);
    const result = await deleteFont(zuLoeschen.id);
    setBusy(false);

    if (!result.success) {
      toast.error(fontErrorMessage(result));
      return;
    }

    toast.success(`Schrift „${zuLoeschen.label}" gelöscht.`);
    setZuLoeschen(null);
    fonts.reload();
    reloadFontStylesheet();
  }

  if (!canManage) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Schriften" className="-mx-5 -mt-5 px-5" />
        <AdminAccessNotice area="die Schriften der Oberfläche" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Schriften"
        subtitle="Schriften der Oberfläche – mitgeliefert oder selbst hochgeladen"
        className="-mx-5 -mt-5 px-5"
        actions={
          <Button variant="primary" iconLeft="upload" onClick={() => setUploadOffen(true)}>
            Schrift hochladen
          </Button>
        }
      />

      <Panel variant="outline" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-base font-semibold text-ink">Wo welche Schrift gilt</span>
          <span className="text-sm text-ink-muted">
            Die Auswahl gilt für alle – auch für die Anmeldeseite. Ohne Auswahl bleibt es bei den
            mitgelieferten Vorgaben Space Grotesk und JetBrains Mono.
          </span>
        </div>

        {settings.loading ? (
          <AdminLoading label="Auswahl wird geladen …" />
        ) : settings.error ? (
          <AdminError message={settings.error} onRetry={settings.reload} />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <SelectField
              label="Oberfläche"
              hint="Fließtext, Überschriften, Schaltflächen."
              value={uiFontId ?? VORGABE_WERT}
              disabled={busy || !(auswahl?.permissions.canEdit ?? false)}
              onChange={(value) => void rolleSetzen('ui', value === VORGABE_WERT ? null : value)}
              options={auswahlOptionen(liste, false)}
            />
            <SelectField
              label="Konsole, Logs und Adressen"
              hint={
                monospaceFontId !== null &&
                liste.find((font) => font.id === monospaceFontId)?.monospace === false
                  ? 'Achtung: Diese Schrift ist nicht dicktengleich – Konsolenspalten verrutschen damit.'
                  : 'Nur dicktengleiche Schriften halten Spalten und Adressen in Reihe.'
              }
              value={monospaceFontId ?? VORGABE_WERT}
              disabled={busy || !(auswahl?.permissions.canEdit ?? false)}
              onChange={(value) => void rolleSetzen('mono', value === VORGABE_WERT ? null : value)}
              options={auswahlOptionen(liste, true)}
            />
          </div>
        )}
      </Panel>

      {fonts.loading ? (
        <AdminLoading label="Schriften werden geladen …" />
      ) : fonts.error ? (
        <AdminError message={fonts.error} onRetry={fonts.reload} />
      ) : liste.length === 0 ? (
        <Panel className="text-center text-base text-ink-faint">
          Diese Instanz bringt keine Schriften mit.
        </Panel>
      ) : (
        <ul className="flex flex-col gap-3">
          {liste.map((font) => (
            <li key={font.id}>
              <FontCard
                font={font}
                rollen={rollenVon(font.id, uiFontId, monospaceFontId)}
                onDelete={() => setZuLoeschen(font)}
              />
            </li>
          ))}
        </ul>
      )}

      {uploadOffen ? (
        <FontUploadDialog
          busy={busy}
          setBusy={setBusy}
          onClose={() => setUploadOffen(false)}
          onUploaded={(label) => {
            toast.success(`Schrift „${label}" hochgeladen.`);
            setUploadOffen(false);
            fonts.reload();
            reloadFontStylesheet();
          }}
        />
      ) : null}

      {zuLoeschen ? (
        <DangerConfirmDialog
          open
          onClose={() => setZuLoeschen(null)}
          title={`„${zuLoeschen.label}" löschen?`}
          busy={busy}
          onConfirm={() => void loeschenBestaetigen()}
          message="Die Schriftdatei wird endgültig entfernt. Wer die Oberfläche gerade offen hat, sieht die Schrift bis zum nächsten Laden noch."
        />
      ) : null}
    </div>
  );
}

/**
 * Optionen einer Rollen-Auswahl.
 *
 * Für die dicktengleiche Rolle stehen die dicktengleichen Schriften oben, die
 * übrigen darunter und ausdrücklich als ungeeignet beschriftet. Bewusst
 * sortiert statt gesperrt: `FontDto.monospace` ist eine Angabe des
 * Hochladenden, keine Messung – eine Sperre würde bei einem versehentlich
 * falsch gesetzten Schalter die richtige Schrift aussperren.
 */
function auswahlOptionen(
  fonts: readonly FontDto[],
  fuerDicktengleich: boolean,
): { value: string; label: string }[] {
  const sortiert = fuerDicktengleich
    ? [...fonts].sort((a, b) => Number(b.monospace) - Number(a.monospace))
    : fonts;

  return [
    { value: VORGABE_WERT, label: 'Vorgabe der Instanz' },
    ...sortiert.map((font) => ({
      value: font.id,
      label:
        fuerDicktengleich && !font.monospace ? `${font.label} (nicht dicktengleich)` : font.label,
    })),
  ];
}

/** Welche Rollen besetzt diese Schrift gerade? */
function rollenVon(id: string, uiFontId: string | null, monospaceFontId: string | null): string[] {
  return [
    ...(id === uiFontId ? ['Oberfläche'] : []),
    ...(id === monospaceFontId ? ['Konsole'] : []),
  ];
}

/**
 * Eine Schrift mit Angaben und Vorschau.
 *
 * **Ohne Vorschau wählt man blind.** Der Name einer Schrift sagt nichts
 * darüber, ob sie zur Instanz passt; drei Größen desselben Satzes sagen alles.
 * Die Regeln dafür stehen bereits im erzeugten Stylesheet der Instanz, das im
 * Root-Layout eingebunden ist – die Vorschau braucht deshalb keinen eigenen
 * Ladeweg, sie benennt nur die Familie.
 */
function FontCard({
  font,
  rollen,
  onDelete,
}: {
  font: FontDto;
  rollen: readonly string[];
  onDelete: () => void;
}) {
  const grund = deleteBlockedReason(font, rollen.length > 0);

  /*
   * Der Familienname geht als Wert einer CSS-Eigenschaft an das DOM, nicht als
   * Textbaustein in eine Formatvorlage: React setzt ihn über die CSSOM, ein
   * unerwarteter Wert kann daher nur dazu führen, dass die Angabe verworfen
   * wird. Der Fallback dahinter passt zur Rolle, damit eine noch nicht geladene
   * Datei nicht plötzlich als Serifenschrift erscheint.
   */
  const stapel = `"${font.family}", ${
    font.monospace ? 'ui-monospace, monospace' : 'system-ui, sans-serif'
  }`;

  return (
    <Panel className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-semibold text-ink">{font.label}</span>
            <Badge tone={font.source === 'bundled' ? 'neutral' : 'brand'}>
              {FONT_SOURCE_LABELS[font.source]}
            </Badge>
            {font.monospace ? <Badge tone="brand">Dicktengleich</Badge> : null}
            {rollen.map((rolle) => (
              <Badge key={rolle} tone="success">
                {rolle}
              </Badge>
            ))}
          </div>
          <span className="font-mono text-xs text-ink-faint">{font.family}</span>
        </div>

        {font.permissions.canDelete ? (
          <Button variant="danger" iconLeft="trash" onClick={onDelete}>
            Löschen
          </Button>
        ) : grund ? (
          <span className="text-xs text-ink-faint">{grund}</span>
        ) : null}
      </div>

      <div
        className="rounded-xl border border-line bg-fill px-3.5 py-3"
        style={{ fontFamily: stapel }}
      >
        {font.monospace ? (
          <div className="flex flex-col gap-0.5 text-base leading-relaxed">
            {PROBE_DICKTENGLEICH.map((zeile) => (
              <span key={zeile}>{zeile}</span>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <span className="text-3xl leading-tight">{PROBETEXT}</span>
            <span className="text-base">{PROBETEXT}</span>
            <span className="text-xs">{PROBETEXT}</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KeyValue label="Format">{FONT_FORMAT_LABELS[font.format]}</KeyValue>
        <KeyValue label="Größe">{formatBytes(font.sizeBytes)}</KeyValue>
        <KeyValue label="Gewichte">{weightRangeLabel(font)}</KeyValue>
        <KeyValue label="Herkunft">
          {font.uploadedAt
            ? `${formatDateTime(font.uploadedAt)}${
                font.uploadedByDisplayName ? ` von ${font.uploadedByDisplayName}` : ''
              }`
            : 'Mit der Instanz ausgeliefert'}
        </KeyValue>
      </div>
    </Panel>
  );
}

/**
 * Dialog zum Hochladen.
 *
 * Die Eingaben werden mit **denselben** Schemas geprüft wie im Backend
 * (`@palantir/validation`) – kein zweiter, abweichender Regelsatz (CLAUDE.md
 * §3). Die Regel für den Familiennamen steht ausdrücklich im Formular und nicht
 * erst in der Ablehnung: Dass ein „ß" durchfällt, ist eine überraschende Regel,
 * und sie hat einen Grund, der sich in einem Halbsatz sagen lässt.
 */
function FontUploadDialog({
  busy,
  setBusy,
  onClose,
  onUploaded,
}: {
  busy: boolean;
  setBusy: (value: boolean) => void;
  onClose: () => void;
  onUploaded: (label: string) => void;
}) {
  const dateiFeldId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState('');
  const [family, setFamily] = useState('');
  const [monospace, setMonospace] = useState(false);
  const [variable, setVariable] = useState(false);
  const [weightMin, setWeightMin] = useState<number | null>(400);
  const [weightMax, setWeightMax] = useState<number | null>(700);
  const [error, setError] = useState<string | null>(null);

  const labelFehler = label.length > 0 ? zodFehler(fontLabelSchema, label) : null;
  const familyFehler = family.length > 0 ? zodFehler(fontFamilyNameSchema, family) : null;
  const gewichteOk =
    !variable || (weightMin !== null && weightMax !== null && weightMin < weightMax);

  const absendbar =
    file !== null &&
    label.trim().length > 0 &&
    family.trim().length > 0 &&
    labelFehler === null &&
    familyFehler === null &&
    gewichteOk;

  async function absenden() {
    if (!file) return;

    setBusy(true);
    setError(null);

    const result = await uploadFont(file, {
      label: label.trim(),
      family: family.trim(),
      variable,
      monospace,
      weightMin: weightMin ?? 400,
      weightMax: weightMax ?? 400,
    });

    setBusy(false);

    if (result.success) {
      onUploaded(result.data.label);
    } else {
      setError(fontErrorMessage(result));
    }
  }

  return (
    <FormModal
      open
      onClose={onClose}
      title="Schrift hochladen"
      description="WOFF2, WOFF, TTF oder OTF. WOFF2 ist am kleinsten und wird von jedem aktuellen Browser gelesen."
      submitLabel="Hochladen"
      submitDisabled={!absendbar}
      busy={busy}
      error={error}
      onSubmit={() => void absenden()}
    >
      <FieldShell
        label="Schriftdatei"
        htmlFor={dateiFeldId}
        hint={file ? `${file.name} · ${formatBytes(file.size)}` : 'Noch keine Datei gewählt.'}
      >
        <input
          id={dateiFeldId}
          type="file"
          accept={FONT_ACCEPT_EXTENSIONS}
          disabled={busy}
          className="w-full rounded-md border border-line-strong bg-fill px-3 py-2 text-sm text-ink-muted file:mr-3 file:rounded file:border-0 file:bg-fill-strong file:px-3 file:py-1 file:text-sm file:text-ink"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </FieldShell>

      <TextField
        label="Anzeigename"
        value={label}
        onChange={setLabel}
        error={labelFehler}
        placeholder="Atkinson Hyperlegible"
        hint="Nur zur Anzeige in dieser Liste – Umlaute und Klammern sind erlaubt."
      />

      <TextField
        label="Familienname"
        value={family}
        onChange={setFamily}
        error={familyFehler}
        placeholder="Atkinson Hyperlegible"
        hint="Nur ASCII-Buchstaben, Ziffern, einzelne Leerzeichen und Bindestriche – „ß“ und Umlaute fallen durch. Der Name landet unverändert in einer erzeugten CSS-Regel, die jeder Besucher ausgeliefert bekommt."
      />

      <ToggleRow
        title="Dicktengleich"
        description="Jedes Zeichen gleich breit. Nur solche Schriften taugen für Konsole, Logs und Serveradressen."
        checked={monospace}
        disabled={busy}
        onChange={setMonospace}
      />

      <ToggleRow
        title="Variable Schrift"
        description="Eine Datei deckt einen ganzen Gewichtsbereich ab. Steht der Schalter falsch, rechnet der Browser fette Texte künstlich breit."
        checked={variable}
        disabled={busy}
        onChange={setVariable}
      />

      {variable ? (
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="Kleinstes Gewicht"
            value={weightMin}
            onChange={setWeightMin}
            min={1}
            max={1000}
            step={50}
            disabled={busy}
          />
          <NumberField
            label="Größtes Gewicht"
            value={weightMax}
            onChange={setWeightMax}
            min={1}
            max={1000}
            step={50}
            disabled={busy}
            error={gewichteOk ? null : 'Das größte Gewicht muss über dem kleinsten liegen.'}
          />
        </div>
      ) : null}
    </FormModal>
  );
}

/** Erste Meldung eines Schemas – oder `null`, wenn der Wert passt. */
function zodFehler(schema: ZodTypeAny, value: string): string | null {
  const ergebnis = schema.safeParse(value);

  return ergebnis.success ? null : (ergebnis.error.issues[0]?.message ?? null);
}
