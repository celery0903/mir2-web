using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using GameSrv.DB;
using GameSrv.Npc;
using M2Server;
using OpenMir2;
using OpenMir2.Common;
using OpenMir2.Data;
using ScriptSystem;
using ScriptSystem.Consts;
using Serilog;
using Serilog.Core;
using Serilog.Events;
using SystemModule;
using SystemModule.Data;

Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
var root = Path.GetFullPath(args[0]);
SystemShare.Config.EnvirDir = root;
var sink = new AuditLog();
LogService.Logger = new LoggerConfiguration().WriteTo.Sink(sink).CreateLogger();
var files = new Dictionary<string, object>();
var findings = new List<object>();
var references = new List<object>();
var statements = new List<object>();
var scripts = new Dictionary<string, bool>(StringComparer.Ordinal);
var monsters = new HashSet<string>(StringComparer.Ordinal);
var queue = new Queue<(string File, bool Merchant)>();
var parser = new ScriptParsers();
var mapLines = Lines("MapInfo.txt");
var maps = mapLines.Select(line => Regex.Match(line.Text, @"^\s*\[([^\s|\]]+)(?:\|[^\s\]]+)?\s"))
    .Where(match => match.Success).Select(match => match.Groups[1].Value).ToHashSet(StringComparer.OrdinalIgnoreCase);
var declarations = new List<object>();

foreach (var line in Lines("Merchant.txt")) {
    var fields = Tokens(line.Text.Trim(), 7);
    if (fields[0] == "" || fields[1] == "" || fields[6] == "") continue;
    if (!maps.Contains(fields[1])) { findings.Add(new { kind = "merchant-outside-loaded-maps", line.Number, line.Text }); continue; }
    declarations.Add(new { kind = "merchant", map = fields[1], name = fields[4], source = "Merchant.txt", line = line.Number });
    Enqueue($"Market_Def/{fields[0]}-{fields[1]}.txt", true);
}
foreach (var line in Lines("Npcs.txt")) {
    string tail = line.Text.Trim(), name = "";
    tail = HUtil32.GetValidStrCap(tail, ref name, [' ', '\t']);
    var fields = Tokens(tail, 6);
    if (name == "" || fields[1] == "" || fields[5] == "") continue;
    if (!maps.Contains(fields[1])) { findings.Add(new { kind = "npc-outside-loaded-maps", line.Number, line.Text }); continue; }
    if (!int.TryParse(fields[0], out var type) || type < 0 || type > 2) continue;
    declarations.Add(new { kind = "npc", map = fields[1], name, source = "Npcs.txt", line = line.Number });
    Enqueue($"Npc_def/{Unquote(name)}-{fields[1]}.txt", false);
}
foreach (var file in new[] { "Market_Def/QFunction-0.txt", "MapQuest_def/QManage.txt", "Robot_def/RobotManage.txt" })
    if (File.Exists(Path.Combine(root, file))) Enqueue(file, file.StartsWith("Market_Def/"));
foreach (var line in mapLines) foreach (Match match in Regex.Matches(line.Text, @"CHECKQUEST\(([^)]+)\)", RegexOptions.IgnoreCase))
    Enqueue($"MapQuest_def/{match.Groups[1].Value}.txt", false);
foreach (var line in Lines("MapQuest.txt")) {
    var fields = Tokens(line.Text, 7);
    if (!maps.Contains(fields[0]) || fields[3] == "" || fields[5] == "") continue;
    if (fields[4] != "" && fields[4] != "*") Reference("MapQuest.txt", line.Number.ToString(), "map-quest-item", Unquote(fields[4]));
    Enqueue($"MapQuest_def/{fields[5]}.txt", false);
}
ReadSpawns("MonGen.txt");
while (queue.Count > 0) {
    var (file, merchant) = queue.Dequeue();
    if (!File.Exists(Path.Combine(root, file))) { findings.Add(new { kind = "missing-declared-script", file }); continue; }
    var lines = Lines(file);
    // Includes are compiled by the native parser; record their source closure separately.
    foreach (var line in lines) {
        if (line.Text.TrimStart().StartsWith("#CALL", StringComparison.OrdinalIgnoreCase))
            findings.Add(new { kind = "native-call-expanded-label-review", file, line = line.Number, text = line.Text });
        if (line.Text.TrimStart().StartsWith("#INCLUDE", StringComparison.OrdinalIgnoreCase))
            findings.Add(new { kind = "native-define-include-review", file, line = line.Number, text = line.Text });
    }
    var npc = new Merchant { MapName = "0", ScriptName = "audit", ChrName = "audit" };
    try {
        parser.LoadScriptFile(npc, Path.GetDirectoryName(file), Path.GetFileNameWithoutExtension(file), merchant);
        foreach (var goods in npc.RefillGoodsList) Reference(file, "goods", "shop-goods", goods.ItemName,
            new { count = goods.Count, refillTime = goods.RefillTime, priceRate = npc.PriceRate });
        foreach (var script in npc.ScriptList) foreach (var record in script.RecordList.Values)
            for (int i = 0; i < record.ProcedureList.Count; i++) {
                var procedure = record.ProcedureList[i];
                var location = $"{record.sLabel}/procedure:{i}";
                foreach (var condition in procedure.ConditionList) {
                    var command = ((ConditionCode)condition.CmdCode).ToString();
                    statements.Add(new { file, location, branch = "condition", command,
                        parameters = new[] { condition.sParam1, condition.sParam2, condition.sParam3, condition.sParam4, condition.sParam5, condition.sParam6, condition.sParam7 } });
                    if (command is "CHECKITEM" or "CHECKITEMW" or "ISTAKEITEM") Reference(file, location, command, condition.sParam1);
                }
                Actions(procedure.ActionList, file, location, "action");
                Actions(procedure.ElseActionList, file, location, "else-action");
            }
    } catch (Exception error) { findings.Add(new { kind = "native-script-parse-failed", file, error = error.ToString() }); }
}
foreach (var monster in monsters.Order(StringComparer.Ordinal)) {
    var file = $"MonItems/{monster}.txt";
    if (!File.Exists(Path.Combine(root, file))) { findings.Add(new { kind = "missing-monster-drop-file", monster, file }); continue; }
    Lines(file);
    IList<MonsterDropItem> drops = new List<MonsterDropItem>();
    try {
        new LocalDb().LoadMonitems(monster, ref drops);
        for (int i = 0; i < drops.Count; i++) Reference(file, $"native-drop:{i}", "monster-drop", drops[i].ItemName,
            new { numerator = drops[i].SelPoint + 1, denominator = drops[i].MaxPoint, count = drops[i].Count });
    } catch (Exception error) { findings.Add(new { kind = "native-drop-parse-failed", file, error = error.ToString() }); }
}
var assemblies = new[] { typeof(LocalDb).Assembly, typeof(Merchant).Assembly, typeof(M2Server.Npc.NormNpc).Assembly,
    typeof(HUtil32).Assembly, typeof(ScriptParsers).Assembly, typeof(SystemShare).Assembly }
    .Distinct().ToDictionary(assembly => Path.GetFileName(assembly.Location), assembly => Hash(File.ReadAllBytes(assembly.Location)));
var report = new { assemblies, loadedMaps = maps.Order(StringComparer.Ordinal).ToArray(), declarations,
    scriptRoots = scripts.Select(entry => new { file = entry.Key, merchant = entry.Value }),
    spawnMonsters = monsters.Order(StringComparer.Ordinal).ToArray(), files, references, statements, findings, nativeLog = sink.Entries,
    scope = "Native parsed references in declared scripts, every compiled branch and configured spawns; branch execution and missing/dynamic dependencies remain unverified.",
    full176Acceptance = false, readOnly = true };
File.WriteAllText(args[1], JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true }) + "\n");
Console.WriteLine($"Native item references: {references.Count}; {scripts.Count} script roots; {monsters.Count} configured monsters.");

void Actions(IList<QuestActionInfo> actions, string file, string location, string branch) {
    foreach (var action in actions) {
        var command = ((ExecutionCode)action.nCmdCode).ToString();
        statements.Add(new { file, location, branch, command,
            parameters = new[] { action.sParam1, action.sParam2, action.sParam3, action.sParam4, action.sParam5, action.sParam6 } });
        if (command is "Give" or "Take" or "Takew" or "TakecheckItem") Reference(file, location, command, action.sParam1);
        if (command == "MonGen" && !string.IsNullOrEmpty(action.sParam1)) monsters.Add(action.sParam1);
        if (command == "MonGenex") findings.Add(new { kind = "dynamic-monster-spawn-review", file, location, command });
        if (command.Contains("item", StringComparison.OrdinalIgnoreCase) && command is not "TakecheckItem")
            findings.Add(new { kind = "additional-item-command-review", file, location, command });
    }
}
void Reference(string file, string location, string kind, string name, object details = null) {
    if (string.IsNullOrEmpty(name)) { findings.Add(new { kind = "empty-item-parameter", file, location, command = kind }); return; }
    references.Add(new { file, location, kind, name, details, currency = name.Equals(Grobal2.StringGoldName, StringComparison.OrdinalIgnoreCase),
        dynamic = name.Contains("<$") || Regex.IsMatch(name, @"^(?:[A-Z]\d+|[A-Z]+\([^)]+\))$", RegexOptions.IgnoreCase) });
}
void ReadSpawns(string file) {
    foreach (var line in Lines(file)) {
        if (line.Text.StartsWith("loadgen", StringComparison.OrdinalIgnoreCase)) {
            findings.Add(new { kind = "spawn-include-review", file, line = line.Number, text = line.Text });
            continue;
        }
        var fields = Tokens(line.Text, 3);
        if (!maps.Contains(fields[0])) continue;
        string tail = line.Text, token = "";
        for (int i = 0; i < 3; i++) tail = HUtil32.GetValidStr3(tail, ref token, [' ', '\t']);
        tail = HUtil32.GetValidStrCap(tail, ref token, [' ', '\t']);
        var rest = Tokens(tail, 3);
        if (int.TryParse(rest[2], out var interval) && interval > 0 && token != "") monsters.Add(Unquote(token));
    }
}
void Enqueue(string file, bool merchant) {
    file = file.Replace('\\', '/');
    if (scripts.TryAdd(file, merchant)) queue.Enqueue((file, merchant));
}
List<(int Number, string Text)> Lines(string file) {
    var path = Path.Combine(root, file);
    if (!File.Exists(path)) { findings.Add(new { kind = "missing-source-file", file }); return []; }
    var raw = File.ReadAllBytes(path);
    files[file] = new { bytes = raw.Length, sha256 = Hash(raw) };
    var native = new StringList();
    native.LoadFromFile(path);
    var result = new List<(int Number, string Text)>();
    for (int i = 0; i < native.Count; i++) if (!string.IsNullOrWhiteSpace(native[i]) && !native[i].TrimStart().StartsWith(';')) result.Add((i + 1, native[i]));
    native.Dispose();
    return result;
}
string[] Tokens(string text, int count) {
    var fields = new string[count];
    for (int i = 0; i < count; i++) { string token = ""; text = HUtil32.GetValidStr3(text, ref token, [' ', '\t']); fields[i] = token; }
    return fields;
}
string Unquote(string text) {
    if (text.StartsWith('"')) HUtil32.ArrestStringEx(text, "\"", "\"", ref text);
    return text;
}
string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();

class AuditLog : ILogEventSink {
    public List<object> Entries { get; } = new();
    public void Emit(LogEvent entry) {
        if (entry.Level >= LogEventLevel.Warning) Entries.Add(new { level = entry.Level.ToString(), message = entry.RenderMessage() });
    }
}
