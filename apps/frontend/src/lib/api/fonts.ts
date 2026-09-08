import { type FontDto } from '@palantir/contracts';
import { apiUrl } from '@/lib/auth/api';
import { type ApiResult, apiRequest } from './client';

/**
 * Schriften der Oberfläche (Arbeitspaket S-3, Lastenheft §3.10).
 *
 * Bis hierher lud die Oberfläche ihre beiden Schriften bei jedem Seitenaufruf
 * von Google – und gab damit die IP-Adresse jedes Betrachters an einen Dritten
 * weiter (Fundpunkt 151). Ab jetzt kommt alles aus der eigenen Instanz.
 */

/**
 * Adresse des erzeugten Stylesheets – **ohne Sitzung** erreichbar.
 *
 * Das Root-Layout bindet sie als `<link rel="stylesheet">` ein. Damit gelten
 * die Schriften auf jeder Seite, auch auf der Anmeldeseite: Dort gibt es keine
 * Sitzung, und die Auswahl steckt in den Instanz-Einstellungen, die nur hinter
 * `user.manage` zu haben sind. Ein Stylesheet braucht dagegen weder Sitzung
 * noch JavaScript und ist obendrein zwischenspeicherbar.
 */
export const FONT_STYLESHEET_PATH = '/public/fonts.css';

/** Merkmal am `<link>` des Stylesheets – siehe {@link reloadFontStylesheet}. */
export const FONT_STYLESHEET_LINK_ATTRIBUTE = 'data-palantir-fonts';

/** Vollständige Adresse des erzeugten Stylesheets. */
export function fontStylesheetUrl(): string {
  return apiUrl(FONT_STYLESHEET_PATH);
}

/**
 * Das Stylesheet neu holen, nachdem sich der Bestand geändert hat.
 *
 * Nötig, weil die Antwort eine Minute lang zwischengespeichert werden darf
 * (siehe `cache-control` der Route): Ohne diesen Anstoß zeigte die
 * Schriftverwaltung eine gerade hochgeladene Schrift in der Vorschau bis zu
 * eine Minute lang in der Ersatzschrift – und der Betreiber hielte den Upload
 * für kaputt. Der Zeitstempel im Parameter macht daraus eine andere Adresse,
 * ohne den Zwischenspeicher für alle anderen Seiten zu entwerten.
 */
export function reloadFontStylesheet(): void {
  if (typeof document === 'undefined') return;

  const link = document.querySelector<HTMLLinkElement>(`link[${FONT_STYLESHEET_LINK_ATTRIBUTE}]`);
  if (!link) return;

  const [basis] = link.getAttribute('href')?.split('?') ?? [];
  if (!basis) return;

  link.setAttribute('href', `${basis}?v=${Date.now()}`);
}

/**
 * Alle Schriften der Instanz – mitgelieferte und hochgeladene.
 *
 * Verlangt eine Sitzung, aber keine besondere Berechtigung: Die Liste ist keine
 * Verwaltungsansicht, sie beschreibt nur, was die Oberfläche anbietet. Was ein
 * Konto damit **tun** darf, steht im `permissions`-Objekt jedes Eintrags.
 */
export function fetchFonts(signal?: AbortSignal): Promise<ApiResult<FontDto[]>> {
  return apiRequest<FontDto[]>('/api/fonts', { signal });
}

/** Angaben, die beim Hochladen neben der Datei mitgehen. */
export interface UploadFontFields {
  label: string;
  family: string;
  variable: boolean;
  monospace: boolean;
  /** Nur bei einer variablen Schrift ausgewertet. */
  weightMin: number;
  weightMax: number;
}

/**
 * Eine Schriftdatei hochladen (`user.manage`).
 *
 * `multipart/form-data`, und **alle Textfelder vor der Datei**: Das Backend
 * liest den Rumpf als Strom und wertet aus, was bis zum Dateiteil angekommen
 * ist – ein Feld dahinter käme dort nie an (dieselbe Regel wie beim
 * Datei-Manager in `servers.ts`). `multipart/form-data` kennt nur
 * Zeichenketten; Schalter gehen deshalb als `"true"`/`"false"`, der
 * Gewichtsbereich als zwei Felder.
 */
export function uploadFont(file: File, fields: UploadFontFields): Promise<ApiResult<FontDto>> {
  const form = new FormData();

  form.set('label', fields.label);
  form.set('family', fields.family);
  form.set('variable', String(fields.variable));
  form.set('monospace', String(fields.monospace));

  if (fields.variable) {
    form.set('weightMin', String(fields.weightMin));
    form.set('weightMax', String(fields.weightMax));
  }

  form.set('file', file);

  return apiRequest<FontDto>('/api/admin/fonts', { method: 'POST', body: form });
}

/** Eine hochgeladene Schrift löschen (`user.manage`). */
export function deleteFont(id: string): Promise<ApiResult<null>> {
  return apiRequest<null>(`/api/admin/fonts/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
