/**
 * Konfiguration des Discord-Bots (Pflichtenheft §14a.1, §14a.11).
 *
 * Der Bot ist eine Ergänzung, keine Voraussetzung: Ohne `DISCORD_BOT_ENABLED`
 * lädt das Modul gar nicht. Steht der Schalter auf `true`, müssen alle
 * Pflichtwerte da sein – das prüft bereits das Env-Schema und bricht den Start
 * ab. Diese Datei setzt die geprüften Werte nur zu einem Objekt zusammen, damit
 * das Modul nicht an `env` hängt und in Tests ohne Umgebung auskommt.
 */

export interface DiscordBotConfig {
  /** Token des Bot-Benutzers – Geheimnis, nie loggen. */
  readonly botToken: string;
  /** Öffentlicher Schlüssel der Anwendung (64 Hex-Zeichen) zur Signaturprüfung. */
  readonly publicKey: string;
  /** Id der Anwendung; dieselbe wie beim OAuth-Login (`DISCORD_CLIENT_ID`). */
  readonly applicationId: string;
  /** Id des Projekt-Discord-Servers. */
  readonly guildId: string;
  /** Öffentliche Adresse des Panels – Ziel der Verweise in Antworten. */
  readonly webUrl: string;
}

export interface DiscordBotEnv {
  readonly DISCORD_BOT_ENABLED: boolean;
  readonly DISCORD_BOT_TOKEN?: string | undefined;
  readonly DISCORD_PUBLIC_KEY?: string | undefined;
  readonly DISCORD_GUILD_ID?: string | undefined;
  readonly DISCORD_CLIENT_ID?: string | undefined;
  readonly PUBLIC_WEB_URL: string;
}

/**
 * Liefert die Konfiguration oder `null`, wenn der Bot abgeschaltet ist.
 *
 * Wirft, wenn der Schalter an ist und ein Wert fehlt. Das Env-Schema fängt das
 * schon beim Start ab; die Prüfung hier hält das Modul auch dann ehrlich, wenn
 * jemand es mit einer anders zusammengesetzten Umgebung aufruft.
 */
export function readDiscordBotConfig(werte: DiscordBotEnv): DiscordBotConfig | null {
  if (!werte.DISCORD_BOT_ENABLED) {
    return null;
  }

  const fehlend = (
    [
      ['DISCORD_BOT_TOKEN', werte.DISCORD_BOT_TOKEN],
      ['DISCORD_PUBLIC_KEY', werte.DISCORD_PUBLIC_KEY],
      ['DISCORD_GUILD_ID', werte.DISCORD_GUILD_ID],
      ['DISCORD_CLIENT_ID', werte.DISCORD_CLIENT_ID],
    ] as const
  )
    .filter(([, wert]) => !wert)
    .map(([name]) => name);

  if (fehlend.length > 0) {
    throw new Error(
      `Discord-Bot: ${fehlend.join(', ')} fehlt/fehlen, obwohl DISCORD_BOT_ENABLED=true ist ` +
        '(siehe .env.example Abschnitt 19).',
    );
  }

  return {
    botToken: werte.DISCORD_BOT_TOKEN as string,
    publicKey: werte.DISCORD_PUBLIC_KEY as string,
    applicationId: werte.DISCORD_CLIENT_ID as string,
    guildId: werte.DISCORD_GUILD_ID as string,
    webUrl: werte.PUBLIC_WEB_URL,
  };
}
