using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using M2Server.Actor;
using M2Server.Player;
using M2Server.Magic;
using M2Server.Maps;
using OpenMir2;
using OpenMir2.Consts;
using Serilog;
using SystemModule;

Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
LogService.Logger = new LoggerConfiguration().CreateLogger();
Console.WriteLine("Assembly SHA-256: " + Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(typeof(BaseObject).Assembly.Location))).ToLowerInvariant());
var failures = new List<string>();
var checks = 0;
void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
void Case(string name, Action action)
{
    checks++;
    try { action(); Console.WriteLine("PASS: " + name); }
    catch (Exception error) { failures.Add(name + ": " + error.GetBaseException().Message); Console.WriteLine("FAIL: " + failures[^1]); }
}
void Advance(BaseObject actor, int now)
{
    var method = typeof(BaseObject).GetMethod("ProcessStatus", BindingFlags.Instance | BindingFlags.NonPublic);
    Check(method != null, "No live per-actor status timer");
    method.Invoke(actor, [now]);
}
void Clock(BaseObject actor, int slot, int now)
{
    var property = typeof(BaseObject).GetProperty("StatusArrTick");
    Check(property != null, "Traditional status clocks are absent");
    ((int[])property.GetValue(actor))[slot] = now;
}
Case("red and green poison use their native bits regardless of insertion order", () =>
{
    var red = new PlayObject(); red.MakePosion(PoisonState.DAMAGEARMOR, 20, 0);
    var green = new PlayObject(); green.MakePosion(PoisonState.DECHEALTH, 20, 0);
    Check(unchecked((uint)red.CharStatus) == 0x40000000, $"Red poison reported {unchecked((uint)red.CharStatus):X8}");
    Check(unchecked((uint)green.CharStatus) == 0x80000000, "Green poison bit mismatch");
    red.MakePosion(PoisonState.DECHEALTH, 20, 0);
    green.MakePosion(PoisonState.DAMAGEARMOR, 20, 0);
    Check(red.CharStatus == green.CharStatus && unchecked((uint)red.CharStatus) == 0xC0000000, "Combined poison depends on insertion order");
});
Case("poison refresh preserves the longer remaining duration", () =>
{
    var actor = new PlayObject(); actor.MakePosion(PoisonState.DECHEALTH, 20, 1);
    actor.MakePosion(PoisonState.DECHEALTH, 5, 1);
    Check(actor.StatusTimeArr[PoisonState.DECHEALTH] == 20, "Short poison replaced the remaining duration");
    actor.MakePosion(PoisonState.DECHEALTH, 30, 1);
    Check(actor.StatusTimeArr[PoisonState.DECHEALTH] == 30, "Longer poison did not refresh");
    Check(!actor.MakePosion(-1, 20, 1), "Negative status type accepted");
});
Case("shield initializes native duration and rejects an active recast", () =>
{
    var actor = new PlayObject();
    Check(actor.MagBubbleDefenceUp(0, 45), "Initial shield rejected");
    Check(unchecked((uint)actor.CharStatus) == 0x00100000, $"Shield reported {unchecked((uint)actor.CharStatus):X8}");
    Check(actor.StatusTimeArr[PoisonState.BubbleDefenceUP] == 45, "Shield duration missing");
    Check(!actor.MagBubbleDefenceUp(1, 60) && actor.StatusTimeArr[PoisonState.BubbleDefenceUP] == 45, "Active recast extended the shield");
});
Case("native timers expire both color bits independently and retain permanent states", () =>
{
    var actor = new PlayObject(); actor.StatusTimeArr[0] = 2; actor.StatusTimeArr[1] = 3; actor.StatusTimeArr[8] = 60000;
    Clock(actor, 0, 1000); Clock(actor, 1, 1000);
    Advance(actor, 2000); Check(actor.StatusTimeArr[0] == 2, "Timer advanced at the strict boundary");
    Advance(actor, 2001); Check(actor.StatusTimeArr[0] == 1 && actor.StatusTimeArr[1] == 2, "One-second decrement mismatch");
    Advance(actor, 3001); Check(actor.StatusTimeArr[0] == 0 && actor.StatusTimeArr[1] == 1, "Poison durations are coupled");
    Advance(actor, 4001); Check(unchecked((uint)actor.CharStatus) == 0x00800000 && actor.StatusTimeArr[8] == 60000, "Expiry removed an unrelated permanent state");
});
Case("shield survives forty seconds, loses lifetime on impact and clears at expiry", () =>
{
    var actor = new PlayObject(); actor.MagBubbleDefenceUp(0, 45); Clock(actor, 11, 1000);
    for (int second = 1; second <= 40; second++) Advance(actor, 1000 + second * 1000 + 1);
    Check(actor.StatusTimeArr[11] == 5 && actor.AbilMagBubbleDefence, "Shield has an invented forty-second cap");
    actor.GetHitStruckDamage(new PlayObject(), 100);
    Check(actor.StatusTimeArr[11] == 2, "Impact did not consume three seconds of shield lifetime");
    Advance(actor, 42001); Advance(actor, 43001);
    Check(actor.StatusTimeArr[11] == 0 && !actor.AbilMagBubbleDefence && actor.CharStatus == 0, "Shield mitigation survived native expiry");
});
Case("green poison actually drains health while red poison does not", () =>
{
    SystemShare.Config.PosionDecHealthTime = 1000;
    var green = new PlayObject(); green.WAbil.HP = green.WAbil.MaxHP = 100;
    green.MakePosion(0, 20, 1); Clock(green, 0, 1000); green.PoisoningTick = 1000;
    Advance(green, 2001); Check(green.WAbil.HP == 98, "Green poison did not apply its native periodic damage");
    var red = new PlayObject(); red.WAbil.HP = red.WAbil.MaxHP = 100;
    red.MakePosion(1, 20, 1); Clock(red, 1, 1000); red.PoisoningTick = 1000;
    Advance(red, 2001); Check(red.WAbil.HP == 100, "Red poison invented periodic health damage");
});
Case("defense statuses raise their original upper bounds and restore on expiry", () =>
{
    var actor = new PlainActor { Race = 0 }; actor.Abil.Level = 14; actor.Abil.AC = HUtil32.MakeWord(1, 3); actor.Abil.MAC = HUtil32.MakeWord(2, 4);
    Check(actor.DefenceUp(2) && actor.MagDefenceUp(3), "Defense cast rejected");
    Check(HUtil32.HiByte(actor.WAbil.AC) == 7 && HUtil32.HiByte(actor.WAbil.MAC) == 8, "Defense uses a buff-list index as its magnitude");
    Clock(actor, 9, 1000); Clock(actor, 10, 1000);
    Advance(actor, 2001); Advance(actor, 3001);
    Check(HUtil32.HiByte(actor.WAbil.AC) == 3 && HUtil32.HiByte(actor.WAbil.MAC) == 8, "Defense expiry changed magic defense");
    Advance(actor, 4001); Check(HUtil32.HiByte(actor.WAbil.MAC) == 4, "Magic defense did not restore");
});
Case("invisibility starts its clock at cast time and clears its native state on expiry", () =>
{
    var environment = new Envirnoment();
    typeof(Envirnoment).GetMethod("Initialize", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(environment, [(short)2, (short)2]);
    var actor = new PlayObject { Envir = environment };
    var before = HUtil32.GetTickCount();
    Check(MagicManager.MagMakePrivateTransparent(actor, 2), "Invisibility cast rejected");
    var ticks = (int[])typeof(BaseObject).GetProperty("StatusArrTick")?.GetValue(actor);
    Check(ticks != null, "Traditional status clocks are absent");
    var started = ticks[PoisonState.STATETRANSPARENT];
    Check(unchecked(started - before) >= 0 && unchecked(HUtil32.GetTickCount() - started) < 1000, "Invisibility clock was not initialized at cast time");
    Check(actor.HideMode && actor.CharStatus == 0x00800000, "Invisibility bit missing");
    Advance(actor, unchecked(started + 1000)); Check(actor.StatusTimeArr[8] == 2, "Invisibility expired at its strict boundary");
    Advance(actor, unchecked(started + 1001)); Check(actor.StatusTimeArr[8] == 1 && actor.HideMode, "Invisibility did not survive its first second");
    Advance(actor, unchecked(started + 2001)); Check(actor.CharStatus == 0 && !actor.HideMode, "Expired invisibility retained its native state");
});
Console.WriteLine($"Status checks: {checks - failures.Count}/{checks} passed.");
Environment.ExitCode = failures.Count == 0 ? 0 : 1;

class PlainActor : BaseObject { }
