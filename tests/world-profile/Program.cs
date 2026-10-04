using System.Security.Cryptography;
using System.Collections.Concurrent;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using GameSrv.Maps;
using M2Server;
using M2Server.Actor;
using M2Server.Maps;
using OpenMir2;
using OpenMir2.Data;
using OpenMir2.Enums;
using Serilog;
using SystemModule;
using SystemModule.Data;

Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
LogService.Logger = new LoggerConfiguration().CreateLogger();
Console.WriteLine("Assembly SHA-256: " + Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(typeof(BaseObject).Assembly.Location))).ToLowerInvariant());
// StringList opens text inputs read/write even when only detecting their encoding.
var envir = Path.Combine(Path.GetTempPath(), "world-profile-envir");
foreach (var source in Directory.EnumerateFiles("/profile/Envir", "*", SearchOption.AllDirectories)) {
    var destination = Path.Combine(envir, Path.GetRelativePath("/profile/Envir", source));
    Directory.CreateDirectory(Path.GetDirectoryName(destination));
    File.Copy(source, destination, true);
}
SystemShare.Config.EnvirDir = envir;
SystemShare.Config.MapDir = "/profile/Map";
M2Share.MiniMapList = new ConcurrentDictionary<string, short>(StringComparer.OrdinalIgnoreCase);
SystemShare.MapMgr = new MapManager();
SystemShare.WorldEngine = new GameSrv.Word.WorldServer();
var output = Console.Out;
int result;
try { Console.SetOut(TextWriter.Null); result = GameSrv.Maps.Map.LoadMapInfo(); }
finally { Console.SetOut(output); }
if (result != 1) throw new Exception("Native MapInfo loader failed");
using var pins = JsonDocument.Parse(File.ReadAllText("/world-lock.json"));
var expectedMaps = pins.RootElement.GetProperty("maps").EnumerateArray().ToArray();
if (SystemShare.MapMgr.Maps.Count != expectedMaps.Length) throw new Exception($"Only {SystemShare.MapMgr.Maps.Count}/{expectedMaps.Length} maps loaded");
foreach (var pin in expectedMaps) {
    var id = pin.GetProperty("id").GetString();
    var map = SystemShare.MapMgr.FindMap(id) ?? throw new Exception($"Native map absent: {id}");
    if (map.MapFileName != pin.GetProperty("graphicID").GetString()) throw new Exception($"Graphic alias lost: {id}");
    if (map.MapDesc != pin.GetProperty("name").GetString()) throw new Exception($"Map name lost: {id}");
    var data = File.ReadAllBytes(Path.Combine("/profile/Map", map.MapFileName + ".map"));
    var hash = Convert.ToHexString(SHA256.HashData(data)).ToLowerInvariant();
    if (hash != pin.GetProperty("sha256").GetString()) throw new Exception($"Loaded map bytes differ: {id}");
    var flags = pin.GetProperty("flags").GetString().Split(' ', StringSplitOptions.RemoveEmptyEntries);
    foreach (var flag in flags) {
        bool? preserved = flag.ToUpperInvariant() switch {
            "DAY" => map.Flag.DayLight,
            "DARK" => map.Flag.boDarkness,
            "FIGHT" => map.Flag.FightZone,
            "SAFE" => map.Flag.SafeArea,
            "MINE" => map.Flag.Mine,
            "NEEDHOLE" => map.Flag.boNEEDHOLE,
            "NORANDOMMOVE" => map.Flag.boNORANDOMMOVE,
            _ when flag.StartsWith("NORECONNECT", StringComparison.OrdinalIgnoreCase) => map.Flag.boNORECONNECT,
            _ => null
        };
        if (preserved == false) throw new Exception($"Native map flag lost: {id}/{flag}");
    }
}
var routes = 0;
var unavailable = new List<object>();
foreach (var line in File.ReadLines(Path.Combine(envir, "MapInfo.txt"))) {
    var match = Regex.Match(line, @"^\s*(\S+)\s+(\d+)[,\s]+(\d+)\s+->\s+(\S+)\s+(\d+)[,\s]+(\d+)");
    if (!match.Success) continue;
    routes++;
    var from = (Envirnoment)SystemShare.MapMgr.FindMap(match.Groups[1].Value);
    var to = SystemShare.MapMgr.FindMap(match.Groups[4].Value);
    var x = int.Parse(match.Groups[2].Value); var y = int.Parse(match.Groups[3].Value);
    var targetX = int.Parse(match.Groups[5].Value); var targetY = int.Parse(match.Groups[6].Value);
    ref var cell = ref from.GetCellInfo(x, y, out var found);
    if (!found || !cell.Valid) {
        unavailable.Add(new { source = line.Trim(), reason = "Native source cell cannot contain a route" });
        continue;
    }
    var routeFound = false;
    if (cell.ObjList != null) for (var i = 0; i < cell.ObjList.Count; i++) {
        var entry = cell.ObjList[i];
        if (entry.CellType != CellType.MapRoute) continue;
        var route = M2Share.CellObjectMgr.Get<MapRouteItem>(entry.CellObjId);
        if (route.Envir == to && route.X == targetX && route.Y == targetY) routeFound = true;
    }
    if (!routeFound) throw new Exception($"Native route lost: {line}");
}
using var audit = JsonDocument.Parse(File.ReadAllText("/profile/audit.json"));
if (routes != audit.RootElement.GetProperty("connections").GetInt32()) throw new Exception("Native route count differs from prepared profile");
Console.WriteLine("Unavailable source routes: " + JsonSerializer.Serialize(unavailable));
Console.WriteLine($"Native world profile checks: {expectedMaps.Length} maps, {routes} route declarations, {routes - unavailable.Count} installed source routes.");
Console.WriteLine("Version data, NPC scripts, monster visuals and actual travel workflows are not accepted by these parser checks.");
