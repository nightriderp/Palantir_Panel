import { describe, expect, it } from 'vitest';
import { COMMANDS, ROOT_COMMAND, SUBCOMMAND_ACCOUNT } from './commands.js';
import {
  type DiscordIdentityResolver,
  escapeMarkdown,
  handleInteraction,
  type LinkedAccount,
} from './interactions.js';
import {
  type Interaction,
  InteractionResponseType,
  InteractionType,
  MESSAGE_FLAG_EPHEMERAL,
} from './types.js';

const WEB_URL = 'https://panel.example';

function resolver(konten: Record<string, LinkedAccount>): DiscordIdentityResolver {
  return { resolve: async (id) => konten[id] ?? null };
}

function kontoBefehl(discordUserId: string, inGuild = true): Interaction {
  return {
    id: 'i1',
    type: InteractionType.ApplicationCommand,
    ...(inGuild
      ? { guild_id: 'g', member: { user: { id: discordUserId } } }
      : { user: { id: discordUserId } }),
    data: { name: ROOT_COMMAND, options: [{ name: SUBCOMMAND_ACCOUNT, type: 1 }] },
  };
}

const KONTO: LinkedAccount = {
  userId: 'u1',
  displayName: 'Keyrim',
  banned: false,
  approved: true,
};

describe('handleInteraction', () => {
  it('beantwortet PING mit PONG', async () => {
    // Damit prüft Discord beim Speichern die Interactions-URL.
    await expect(
      handleInteraction(
        { id: 'p', type: InteractionType.Ping },
        { identity: resolver({}), webUrl: WEB_URL },
      ),
    ).resolves.toEqual({ type: InteractionResponseType.Pong });
  });

  describe('/palantir konto (F1)', () => {
    it('nennt das verknüpfte Konto, nur für den Aufrufer sichtbar', async () => {
      const antwort = await handleInteraction(kontoBefehl('d1'), {
        identity: resolver({ d1: KONTO }),
        webUrl: WEB_URL,
      });

      expect(antwort.type).toBe(InteractionResponseType.ChannelMessageWithSource);
      expect(antwort.data?.flags).toBe(MESSAGE_FLAG_EPHEMERAL);
      expect(antwort.data?.content).toContain('**Keyrim**');
      expect(antwort.data?.allowed_mentions).toEqual({ parse: [] });
    });

    it('verweist ohne Verknüpfung auf das Profil im Panel', async () => {
      const antwort = await handleInteraction(kontoBefehl('fremd'), {
        identity: resolver({ d1: KONTO }),
        webUrl: WEB_URL,
      });

      expect(antwort.data?.content).toContain('mit keinem Palantir-Konto verknüpft');
      expect(antwort.data?.content).toContain(`${WEB_URL}/profil`);
    });

    it('sagt einem gesperrten Konto nur, dass es gesperrt ist', async () => {
      const antwort = await handleInteraction(kontoBefehl('d1'), {
        identity: resolver({ d1: { ...KONTO, banned: true, approved: false } }),
        webUrl: WEB_URL,
      });

      expect(antwort.data?.content).toContain('gesperrt');
      expect(antwort.data?.content).not.toContain('Keyrim');
    });

    it('unterscheidet ein wartendes Konto von einem freigeschalteten', async () => {
      const antwort = await handleInteraction(kontoBefehl('d1'), {
        identity: resolver({ d1: { ...KONTO, approved: false } }),
        webUrl: WEB_URL,
      });

      expect(antwort.data?.content).toContain('noch nicht freigeschaltet');
    });

    it('findet den Aufrufer auch außerhalb einer Guild', async () => {
      const antwort = await handleInteraction(kontoBefehl('d1', false), {
        identity: resolver({ d1: KONTO }),
        webUrl: WEB_URL,
      });

      expect(antwort.data?.content).toContain('Keyrim');
    });

    it('lässt einen Anzeigenamen keine eigene Formatierung setzen', async () => {
      const antwort = await handleInteraction(kontoBefehl('d1'), {
        identity: resolver({ d1: { ...KONTO, displayName: '**fett** `code`' } }),
        webUrl: WEB_URL,
      });

      expect(antwort.data?.content).toContain('\\*\\*fett\\*\\* \\`code\\`');
    });
  });

  it('antwortet auf Unbekanntes flüchtig statt gar nicht', async () => {
    const antwort = await handleInteraction(
      { id: 'x', type: InteractionType.ApplicationCommand, data: { name: 'anderes' } },
      { identity: resolver({}), webUrl: WEB_URL },
    );

    expect(antwort.data?.flags).toBe(MESSAGE_FLAG_EPHEMERAL);
  });
});

describe('COMMANDS', () => {
  it('gilt nur in Guilds, nicht in Direktnachrichten', () => {
    for (const befehl of COMMANDS) {
      expect(befehl.contexts).toEqual([0]);
    }
  });
});

describe('escapeMarkdown', () => {
  it('maskiert die Formatierungszeichen von Discord', () => {
    expect(escapeMarkdown('a_b*c~d|e')).toBe('a\\_b\\*c\\~d\\|e');
  });
});
