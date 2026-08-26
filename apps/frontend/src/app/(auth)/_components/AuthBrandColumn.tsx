import { LogoMark } from '@/components/shared';

/**
 * Markenspalte neben dem Anmeldeformular (Referenz-Mockup, Login-Ansicht).
 *
 * Erscheint erst ab `lg`. Auf dem Smartphone bleibt sie bewusst weg: dort zählt
 * der Weg zum Formular, nicht die Bühne (Lastenheft §4, Mobile-First).
 *
 * **Abweichung vom Mockup:** Dort stehen unten drei Kennzahlen der Instanz
 * („Spiele", „Tage im Dienst", „Arcade-Partien") und der Leitsatz wechselt bei
 * jedem Aufruf zufällig. Beides fehlt hier: für die Kennzahlen gibt es keinen
 * Endpunkt, der ohne Anmeldung antwortet, und ein zufälliger Text würde sich
 * zwischen Server- und Client-Darstellung unterscheiden. Vermerkt unter
 * „Gefundene Punkte" in WORK_STATUS.md.
 */
export function AuthBrandColumn() {
  return (
    <aside className="relative hidden overflow-hidden bg-surface-deep p-14 lg:flex lg:flex-col lg:justify-between">
      {/* Lichtschein oben rechts, wie im Mockup. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-32 -top-32 h-[460px] w-[460px] rounded-full bg-brand-soft blur-3xl"
      />

      <div className="relative z-10 flex items-center gap-2.5">
        <LogoMark />
        <span className="text-xl font-bold tracking-[0.02em]">Palantir</span>
      </div>

      <div className="relative z-10">
        <div className="mb-6 h-[3px] w-9 rounded-sm bg-brand-gradient" />
        {/* Bewusst kein <h1>: die Hauptüberschrift der Seite ist der Titel des
            Formulars (AuthHeading). Diese Spalte fehlt auf dem Smartphone ganz –
            eine Überschriftsebene, die je nach Breite verschwindet, wäre für
            Screenreader irreführend. */}
        <p className="mb-4.5 max-w-[460px] text-5xl font-bold">Steuere deine Server.</p>
        <p className="max-w-[420px] text-lg leading-relaxed text-ink-muted">
          Ein kleiner Kreis, ein paar Gameserver – und ein Panel, das dir auf einen Blick die
          Wahrheit sagt.
        </p>
      </div>

      <div className="relative z-10 font-mono text-xs text-ink-faint">
        Palantir · selbst gehostet
      </div>
    </aside>
  );
}
