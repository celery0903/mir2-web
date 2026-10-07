using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;
using DBSrv.Storage;
using DBSrv.Storage.MySQL;
using MySqlConnector;
using OpenMir2;
using OpenMir2.Packets.ServerPackets;
using Serilog;

LogService.Logger = new LoggerConfiguration().CreateLogger();
var option = new StorageOption { ConnectionString = Environment.GetEnvironmentVariable("MIR_GROUP_STORAGE_CONNECTION")
    ?? throw new Exception("An isolated fixture database connection is required") };
foreach (var type in new[] { typeof(PlayDataStorage), typeof(CharacterData) })
    Console.WriteLine($"Assembly {Path.GetFileName(type.Assembly.Location)} SHA-256: "
        + Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(type.Assembly.Location))).ToLowerInvariant());
var storage = new PlayDataStorage(option);
const BindingFlags flags = BindingFlags.Instance | BindingFlags.NonPublic;
var create = typeof(PlayDataStorage).GetMethod("CreateCharacters", flags)!;
var save = typeof(PlayDataStorage).GetMethod("SaveRecord", flags, null,
    [typeof(StorageContext), typeof(int), typeof(CharacterData)], null)!;
var load = typeof(PlayDataStorage).GetMethod("GetChrRecord", flags)!;
using var context = new StorageContext(option);
bool connected = false;
context.Open(ref connected);
if (!connected) throw new Exception("Isolated MySQL connection failed");
var results = new List<object>();
void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
void Case(string label, Action action) {
    try { action(); results.Add(new { label, passed = true }); }
    catch (Exception error) { results.Add(new { label, passed = false, error = error.GetBaseException().Message }); }
}
foreach (byte allow in new byte[] { 0, 1 }) foreach (bool recall in new[] { false, true }) {
    var record = new CharacterDataInfo();
    var data = record.Data;
    data.Account = data.ChrName = $"group{allow}{(recall ? 1 : 0)}";
    data.CurMap = data.HomeMap = "0132";
    data.CurX = data.HomeX = 11;
    data.CurY = data.HomeY = 15;
    data.Gold = 17;
    data.Job = 2;
    data.Abil.Level = 1;
    data.AllowGroup = allow;
    data.AllowGroupReCall = recall;
    int id = (int)create.Invoke(storage, [context, record])!;
    Check(id > 0, "Native character creation failed");
    void AssertLoaded() {
        var loaded = (CharacterData)load.Invoke(storage, [id, context])!;
        Check(loaded != null, "Native reload returned no record");
        Check(loaded.AllowGroup == allow, $"AllowGroup became {loaded.AllowGroup}, expected {allow}");
        Check(loaded.AllowGroupReCall == recall, "Group permission overwrote the independent recall permission");
        Check(loaded.Account == data.Account && loaded.ChrName == data.ChrName && loaded.CurMap == data.CurMap
            && loaded.CurX == 11 && loaded.CurY == 15 && loaded.Gold == 17 && loaded.Job == 2,
            "Character identity, location, gold or job changed");
    }
    Case($"create group={allow}, recall={recall}", AssertLoaded);
    using (var command = context.CreateCommand()) {
        command.CommandText = "UPDATE characters SET AllowGroup=@group,AllowGroupReCall=@recall WHERE Id=@id";
        command.Parameters.AddWithValue("@group", 1 - allow);
        command.Parameters.AddWithValue("@recall", !recall);
        command.Parameters.AddWithValue("@id", id);
        Check(command.ExecuteNonQuery() == 1, "Save precondition did not change its fixture");
    }
    Case($"save group={allow}, recall={recall}", () => {
        save.Invoke(storage, [context, id, data]);
        AssertLoaded();
    });
}
Console.WriteLine("GROUP_STORAGE_RESULTS=" + JsonSerializer.Serialize(results));
int passed = results.Count(result => JsonSerializer.SerializeToElement(result).GetProperty("passed").GetBoolean());
Console.WriteLine($"Native group storage checks: {passed}/{results.Count}");
Environment.ExitCode = passed == results.Count ? 0 : 1;
