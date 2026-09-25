using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Core.Attributes.Registration;
using CounterStrikeSharp.API.Modules.Commands;
using CounterStrikeSharp.API.Modules.Cvars;
using CounterStrikeSharp.API.Modules.Timers;
using CounterStrikeSharp.API.Modules.Utils;

namespace PalantirUebung;

/// <summary>
/// Übungsserver (Betreiber 26.09.2026): was per Konfiguration nicht geht, weil
/// es erst passieren darf, wenn ein Spieler da ist – und Befehle zum Üben.
///
/// <list type="bullet">
/// <item><c>palantir_skip_warmup 1</c> – beendet die Aufwärmphase, sobald ein
/// Mensch verbunden ist. Sie beginnt erst mit dem ersten Spieler; ein
/// <c>mp_warmup_end</c> beim Kartenladen liefe ins Leere.</item>
/// <item><c>palantir_join_ct 1</c> – Menschen treten beim Beitritt CT bei, ohne
/// dort festgehalten zu werden.</item>
/// <item><c>palantir_practice 1</c> – Chat-Befehle zum Üben: Spawns
/// (<c>!spawn</c>, <c>!tspawn</c>, <c>!ctspawn</c>, <c>!spawns</c>) und eigene
/// Position (<c>!save</c>, <c>!back</c>). Aus, damit auf einem Match-Server
/// niemand teleportiert.</item>
/// </list>
///
/// Die Werte setzt das Panel (Startdatei <c>palantir.cfg</c>, Steuerung).
/// </summary>
public class PalantirUebung : BasePlugin
{
    public override string ModuleName => "Palantir Uebung";
    public override string ModuleVersion => "0.0.2";
    public override string ModuleAuthor => "Palantir";

    public FakeConVar<bool> SkipWarmup = new(
        "palantir_skip_warmup",
        "Aufwaermphase beenden, sobald ein Spieler verbunden ist (Palantir)",
        false);

    public FakeConVar<bool> JoinCt = new(
        "palantir_join_ct",
        "Spieler beim Beitritt CT beitreten lassen, ohne Sperre (Palantir)",
        false);

    public FakeConVar<bool> Practice = new(
        "palantir_practice",
        "Uebungsbefehle !spawn, !tspawn, !ctspawn, !spawns, !save, !back (Palantir)",
        false);

    private readonly Dictionary<ulong, int> _naechsterSpawn = new();
    private readonly Dictionary<ulong, (Vector Ort, QAngle Blick)> _gemerkt = new();

    public override void Load(bool hotReload)
    {
        // Jede Sekunde: auch nach Karten- und Moduswechseln, und wenn die
        // Aufwärmphase erst beginnt, nachdem jemand ein Team gewählt hat.
        AddTimer(1.0f, AufwaermphasePruefen, TimerFlags.REPEAT);
    }

    private void AufwaermphasePruefen()
    {
        if (!SkipWarmup.Value || !MenschVerbunden() || !Aufwaermphase())
        {
            return;
        }

        Server.ExecuteCommand("mp_warmup_end");
    }

    [GameEventHandler]
    public HookResult OnPlayerConnectFull(EventPlayerConnectFull @event, GameEventInfo info)
    {
        var spieler = @event.Userid;

        if (spieler == null || !spieler.IsValid || spieler.IsBot || spieler.IsHLTV)
        {
            return HookResult.Continue;
        }

        AddTimer(0.5f, () =>
        {
            if (!JoinCt.Value || !spieler.IsValid)
            {
                return;
            }

            var team = (CsTeam)spieler.TeamNum;
            if (team == CsTeam.None || team == CsTeam.Spectator)
            {
                // Über den Weg des Teammenüs, nicht `ChangeTeam`: das ruft in
                // CounterStrikeSharp 1.0.374 `SetPawn` mit falschen Argumenten
                // auf (PR #1443, CS2 1.41.8.4) – der Spieler stand eingefroren
                // da (v2.4.43).
                spieler.ExecuteClientCommandFromServer("jointeam 3");
            }
        });

        return HookResult.Continue;
    }

    [ConsoleCommand("css_spawns", "Spawns der Karte zaehlen")]
    public void OnSpawns(CCSPlayerController? spieler, CommandInfo befehl)
    {
        if (!Erlaubt(spieler)) return;

        befehl.ReplyToCommand(
            $" Spawns: T {Spawns(CsTeam.Terrorist).Count}, CT {Spawns(CsTeam.CounterTerrorist).Count}." +
            " !tspawn <n>, !ctspawn <n>, !spawn, !save, !back");
    }

    [ConsoleCommand("css_spawn", "Naechster Spawn der eigenen Seite, oder !spawn <n>")]
    public void OnSpawn(CCSPlayerController? spieler, CommandInfo befehl)
    {
        if (!Erlaubt(spieler)) return;

        var team = (CsTeam)spieler!.TeamNum;
        if (team != CsTeam.Terrorist && team != CsTeam.CounterTerrorist)
        {
            befehl.ReplyToCommand(" Erst ein Team waehlen - oder !tspawn / !ctspawn.");
            return;
        }

        if (befehl.ArgCount > 1)
        {
            ZumSpawn(spieler, befehl, team);
            return;
        }

        var spawns = Spawns(team);
        if (spawns.Count == 0)
        {
            befehl.ReplyToCommand(" Diese Karte hat keine Spawns fuer dein Team.");
            return;
        }

        _naechsterSpawn.TryGetValue(spieler.SteamID, out var stelle);
        stelle %= spawns.Count;
        Teleportieren(spieler, befehl, spawns[stelle].Ort, spawns[stelle].Blick,
            $"{Kurz(team)}-Spawn {stelle + 1} von {spawns.Count}");
        _naechsterSpawn[spieler.SteamID] = stelle + 1;
    }

    [ConsoleCommand("css_tspawn", "Zum T-Spawn <n>")]
    public void OnTSpawn(CCSPlayerController? spieler, CommandInfo befehl)
    {
        if (!Erlaubt(spieler)) return;
        ZumSpawn(spieler!, befehl, CsTeam.Terrorist);
    }

    [ConsoleCommand("css_ctspawn", "Zum CT-Spawn <n>")]
    public void OnCtSpawn(CCSPlayerController? spieler, CommandInfo befehl)
    {
        if (!Erlaubt(spieler)) return;
        ZumSpawn(spieler!, befehl, CsTeam.CounterTerrorist);
    }

    [ConsoleCommand("css_save", "Eigene Position merken")]
    public void OnSave(CCSPlayerController? spieler, CommandInfo befehl)
    {
        if (!Erlaubt(spieler)) return;

        var pawn = spieler!.PlayerPawn.Value;
        var ort = pawn?.AbsOrigin;
        if (pawn == null || ort == null || pawn.LifeState != (byte)LifeState_t.LIFE_ALIVE)
        {
            befehl.ReplyToCommand(" Nur lebend.");
            return;
        }

        var blick = pawn.EyeAngles;
        _gemerkt[spieler.SteamID] = (
            new Vector(ort.X, ort.Y, ort.Z),
            new QAngle(blick.X, blick.Y, blick.Z));
        befehl.ReplyToCommand(" Position gemerkt - !back bringt dich zurueck.");
    }

    [ConsoleCommand("css_back", "Zur gemerkten Position")]
    public void OnBack(CCSPlayerController? spieler, CommandInfo befehl)
    {
        if (!Erlaubt(spieler)) return;

        if (!_gemerkt.TryGetValue(spieler!.SteamID, out var ziel))
        {
            befehl.ReplyToCommand(" Noch nichts gemerkt - erst !save.");
            return;
        }

        Teleportieren(spieler, befehl, ziel.Ort, ziel.Blick, "Gemerkte Position");
    }

    private void ZumSpawn(CCSPlayerController spieler, CommandInfo befehl, CsTeam team)
    {
        var spawns = Spawns(team);
        if (spawns.Count == 0)
        {
            befehl.ReplyToCommand($" Diese Karte hat keine {Kurz(team)}-Spawns.");
            return;
        }

        if (!int.TryParse(befehl.GetArg(1), out var nummer) || nummer < 1 || nummer > spawns.Count)
        {
            befehl.ReplyToCommand($" {Kurz(team)}-Spawns 1 bis {spawns.Count}, z. B. !{Kurz(team).ToLowerInvariant()}spawn 1");
            return;
        }

        var spawn = spawns[nummer - 1];
        Teleportieren(spieler, befehl, spawn.Ort, spawn.Blick, $"{Kurz(team)}-Spawn {nummer} von {spawns.Count}");
    }

    private static void Teleportieren(
        CCSPlayerController spieler, CommandInfo befehl, Vector ort, QAngle blick, string was)
    {
        var pawn = spieler.PlayerPawn.Value;
        if (pawn == null || pawn.LifeState != (byte)LifeState_t.LIFE_ALIVE)
        {
            befehl.ReplyToCommand(" Nur lebend.");
            return;
        }

        // Wie MatchZy: nur den Pawn versetzen, Geschwindigkeit null – kein
        // Team- oder Pawn-Wechsel.
        pawn.Teleport(ort, blick, new Vector(0, 0, 0));
        befehl.ReplyToCommand($" {was}.");
    }

    /// <summary>
    /// Die Spawns, die das Spiel wirklich nutzt: aktiv und mit der höchsten
    /// Priorität (kleinster Wert) – Karten haben oft mehr Spawnpunkte, etwa für
    /// andere Modi. So wählt auch MatchZy aus.
    /// </summary>
    private static List<(Vector Ort, QAngle Blick)> Spawns(CsTeam team)
    {
        var name = team == CsTeam.Terrorist ? "info_player_terrorist" : "info_player_counterterrorist";
        var aktive = Utilities.FindAllEntitiesByDesignerName<SpawnPoint>(name)
            .Where(spawn => spawn.IsValid && spawn.Enabled)
            .ToList();

        if (aktive.Count == 0)
        {
            return new List<(Vector, QAngle)>();
        }

        var beste = aktive.Min(spawn => spawn.Priority);
        var liste = new List<(Vector Ort, QAngle Blick)>();

        foreach (var spawn in aktive.Where(spawn => spawn.Priority == beste))
        {
            var knoten = spawn.CBodyComponent?.SceneNode;
            if (knoten == null) continue;

            liste.Add((
                new Vector(knoten.AbsOrigin.X, knoten.AbsOrigin.Y, knoten.AbsOrigin.Z),
                new QAngle(knoten.AbsRotation.X, knoten.AbsRotation.Y, knoten.AbsRotation.Z)));
        }

        return liste;
    }

    private bool Erlaubt(CCSPlayerController? spieler)
    {
        if (spieler == null || !spieler.IsValid || spieler.IsBot)
        {
            return false;
        }

        if (!Practice.Value)
        {
            spieler.PrintToChat(" Uebungsbefehle sind nur mit den Uebungs-Einstellungen an.");
            return false;
        }

        return true;
    }

    private static string Kurz(CsTeam team) => team == CsTeam.Terrorist ? "T" : "CT";

    private static bool MenschVerbunden()
    {
        return Utilities.GetPlayers().Any(spieler =>
            spieler.IsValid && !spieler.IsBot && !spieler.IsHLTV &&
            spieler.Connected == PlayerConnectedState.Connected);
    }

    private static bool Aufwaermphase()
    {
        var regeln = Utilities
            .FindAllEntitiesByDesignerName<CCSGameRulesProxy>("cs_gamerules")
            .FirstOrDefault()?
            .GameRules;

        return regeln?.WarmupPeriod ?? false;
    }
}
