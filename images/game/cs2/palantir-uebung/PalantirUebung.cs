using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Core.Attributes.Registration;
using CounterStrikeSharp.API.Modules.Cvars;
using CounterStrikeSharp.API.Modules.Timers;
using CounterStrikeSharp.API.Modules.Utils;

namespace PalantirUebung;

/// <summary>
/// Übungsserver (Betreiber 26.09.2026): was per Konfiguration nicht geht, weil
/// es erst passieren darf, wenn ein Spieler da ist.
///
/// <list type="bullet">
/// <item><c>palantir_skip_warmup 1</c> – beendet die Aufwärmphase, sobald ein
/// Mensch verbunden ist. Sie beginnt erst mit dem ersten Spieler; ein
/// <c>mp_warmup_end</c> beim Kartenladen liefe ins Leere. So macht es auch die
/// Workshop-Map „Dust 2 Utility“, dort per Trigger am Spawn.</item>
/// <item><c>palantir_join_ct 1</c> – setzt Menschen beim Beitritt zu CT, ohne
/// sie dort festzuhalten (anders als <c>mp_humanteam ct</c>): Wechseln geht
/// weiter mit M.</item>
/// </list>
///
/// Beide Werte setzt das Panel (Startdatei <c>palantir.cfg</c> und Steuerung).
/// </summary>
public class PalantirUebung : BasePlugin
{
    public override string ModuleName => "Palantir Uebung";
    public override string ModuleVersion => "0.0.1";
    public override string ModuleAuthor => "Palantir";

    public FakeConVar<bool> SkipWarmup = new(
        "palantir_skip_warmup",
        "Aufwaermphase beenden, sobald ein Spieler verbunden ist (Palantir)",
        false);

    public FakeConVar<bool> JoinCt = new(
        "palantir_join_ct",
        "Spieler beim Beitritt zu CT setzen, ohne Sperre (Palantir)",
        false);

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

        // Kurz warten, bis der Spieler vollständig drin ist – vor der
        // Teamzuteilung des Spiels (`mp_force_pick_time`).
        AddTimer(0.5f, () =>
        {
            if (!JoinCt.Value || !spieler.IsValid)
            {
                return;
            }

            var team = (CsTeam)spieler.TeamNum;
            if (team == CsTeam.None || team == CsTeam.Spectator)
            {
                spieler.ChangeTeam(CsTeam.CounterTerrorist);
            }
        });

        return HookResult.Continue;
    }

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
