using System.Security.Cryptography;
using System.Text;
using M2Server;
using M2Server.Actor;
using M2Server.Maps;
using M2Server.Player;
using OpenMir2;
using OpenMir2.Data;
using OpenMir2.Enums;
using Serilog;
using SystemModule;

Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
LogService.Logger = new LoggerConfiguration().CreateLogger();
Console.WriteLine("Assembly SHA-256: " + Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(typeof(BaseObject).Assembly.Location))).ToLowerInvariant());
SystemShare.Config.SafeZoneSize = 10;
SystemShare.Config.RedHomeMap = "3";
SystemShare.Config.RedHomeX = 845;
SystemShare.Config.RedHomeY = 674;
M2Share.StartPointList = new List<StartPoint> {
    new() { MapName = "0", CurrX = 289, CurrY = 618 },
    new() { MapName = "D001", CurrX = 20, CurrY = 25 }
};
var failures = new List<string>();
var checks = 0;
void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
void Case(string name, Action action)
{
    checks++;
    try { action(); Console.WriteLine("PASS: " + name); }
    catch (Exception error) { failures.Add(name + ": " + error.GetBaseException().Message); Console.WriteLine("FAIL: " + failures[^1]); }
}
var bichon = new Envirnoment { MapName = "0" };
var actor = new PlayObject { Envir = bichon, CurrX = 289, CurrY = 618 };
Case("a three-column native start point protects its ordinary-map square", () => {
    Check(actor.InSafeZone(), "The birth point is not recognized on an ordinary map");
    foreach (var dx in new[] { -10, 0, 10 }) foreach (var dy in new[] { -10, 0, 10 }) {
        actor.CurrX = (short)(289 + dx); actor.CurrY = (short)(618 + dy);
        Check(actor.InSafeZone(), $"Inclusive safe-zone boundary lost at {dx},{dy}");
        Check(actor.InSafeZone(bichon, actor.CurrX, actor.CurrY), "Coordinate and current-position queries disagree");
    }
});
Case("one cell past the configured square is unsafe on all four sides", () => {
    foreach (var (dx, dy) in new[] { (11, 0), (-11, 0), (0, 11), (0, -11) }) {
        actor.CurrX = (short)(289 + dx); actor.CurrY = (short)(618 + dy);
        Check(!actor.InSafeZone() && !actor.InSafeZone(bichon, actor.CurrX, actor.CurrY), "Safe zone expanded beyond its source configuration");
    }
});
Case("red-name home uses its own configured map and inclusive square", () => {
    actor.Envir = new Envirnoment { MapName = "3" }; actor.CurrX = 835; actor.CurrY = 684;
    Check(actor.InSafeZone(), "Configured red-home boundary is unsafe");
    actor.CurrX = 834; Check(!actor.InSafeZone(), "Red-home area exceeds its configured boundary");
});
Case("SAFE maps protect all coordinates", () => {
    var safe = new Envirnoment { MapName = "safe" }; safe.Flag.SafeArea = true;
    actor.Envir = safe; actor.CurrX = 900; actor.CurrY = 900;
    Check(actor.InSafeZone() && actor.InSafeZone(safe, 0, 0), "SAFE map was limited to a start-point radius");
});
Case("coordinate query uses the supplied environment instead of the actor environment", () => {
    actor.Envir = new Envirnoment { MapName = "safe" }; actor.Envir.Flag.SafeArea = true;
    var other = new Envirnoment { MapName = "other" };
    Check(!actor.InSafeZone(other, 289, 618), "Actor's SAFE flag leaked into another map");
    actor.Envir = null;
    Check(!actor.InSafeZone(other, 289, 618), "Absent actor environment bypassed the supplied map");
    Check(actor.InSafeZone(bichon, 289, 618), "Coordinate query lost the supplied start point");
});
Case("map lookup is case insensitive without protecting a different map", () => {
    actor.Envir = new Envirnoment { MapName = "d001" }; actor.CurrX = 20; actor.CurrY = 25;
    Check(actor.InSafeZone() && actor.InSafeZone(actor.Envir, 20, 25), "Native case-insensitive map identity was lost");
    actor.Envir = new Envirnoment { MapName = "D002" };
    Check(!actor.InSafeZone(), "Start point from a different dungeon leaked into this map");
});
Case("native player targeting rejects either player inside the birth area", () => {
    var attacker = new PlayObject { Envir = bichon, CurrX = 301, CurrY = 618, AttatckMode = AttackMode.HAM_ALL };
    var target = new PlayObject { Envir = bichon, CurrX = 289, CurrY = 618 };
    Check(!attacker.IsProperTarget(target), "Outside player can target a player at the birth point");
    attacker.CurrX = 289; target.CurrX = 301;
    Check(!attacker.IsProperTarget(target), "Inside player can attack an outside player");
    attacker.CurrX = 302;
    Check(attacker.IsProperTarget(target), "Ordinary all-mode PvP was disabled outside the area");
});
Case("an absent queried environment keeps the native conservative behavior", () => {
    actor.Envir = null; Check(actor.InSafeZone() && actor.InSafeZone(null, 0, 0), "Null-map behavior changed");
});
Console.WriteLine($"Safe-zone checks: {checks - failures.Count}/{checks} passed.");
Environment.ExitCode = failures.Count == 0 ? 0 : 1;
