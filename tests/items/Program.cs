using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using GameSrv.DB;
using M2Server;
using M2Server.Items;
using MySqlConnector;
using OpenMir2;
using OpenMir2.Data;
using OpenMir2.Packets.ClientPackets;
using Serilog;
using SystemModule;

Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
LogService.Logger = new LoggerConfiguration().CreateLogger();
M2Share.ProcessHumanCriticalSection = new object();
M2Share.GameLogItemNameList = new List<string>();
SystemShare.ItemSystem = new GameItemSystem();
SystemShare.Config.ConnctionString = Environment.GetEnvironmentVariable("MIR_ITEM_CHECK_CONNECTION")
    ?? throw new Exception("An isolated fixture database connection is required");
foreach (var type in new[] { typeof(MySqlDB), typeof(GameItemSystem), typeof(StdItem), typeof(SystemShare) })
    Console.WriteLine($"Assembly {Path.GetFileName(type.Assembly.Location)} SHA-256: "
        + Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(type.Assembly.Location))).ToLowerInvariant());
using var connection = new MySqlConnection(SystemShare.Config.ConnctionString);
connection.Open();
void Sql(string text) { using var command = new MySqlCommand(text, connection); command.ExecuteNonQuery(); }
string Scalar(string text) { using var command = new MySqlCommand(text, connection); return Convert.ToString(command.ExecuteScalar()); }
void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
int Load() => new MySqlDB().LoadItemsDB();
void Reset(string where = "1=1", string order = "Id ASC") {
    Sql($"TRUNCATE stditems; INSERT INTO stditems SELECT * FROM stditems_seed WHERE {where} ORDER BY {order}");
}
string Serialize(StdItem item) => JsonSerializer.Serialize(item, new JsonSerializerOptions { IncludeFields = true });
var results = new List<object>();
int failures = 0;
void Case(string label, Action action) {
    try { action(); results.Add(new { label, passed = true }); Console.WriteLine("PASS " + label); }
    catch (Exception error) {
        failures++; results.Add(new { label, passed = false, error = error.Message });
        Console.WriteLine("FAIL " + label + ": " + error.Message);
    }
}
Sql("DROP TABLE IF EXISTS stditems_seed; RENAME TABLE stditems TO stditems_seed; "
    + "CREATE TABLE stditems ENGINE=MyISAM AS SELECT * FROM stditems_seed WHERE 1=0");
var baseline = new Dictionary<ushort, string>();
Case("dense seed preserves every native ID and item field", () => {
    Reset(); Check(Load() == 1, "Dense item load failed");
    Check(SystemShare.ItemSystem.ItemCount == 1000, "Dense seed must have 1000 positions");
    using var command = new MySqlCommand("SELECT Id,Name FROM stditems_seed ORDER BY Id", connection);
    using var reader = command.ExecuteReader();
    while (reader.Read()) {
        var id = checked((ushort)reader.GetInt32(0));
        var item = SystemShare.ItemSystem.GetStdItem(id);
        Check(item != null && item.Name == reader.GetString(1), $"Wrong native identity at {id}");
        baseline.Add(id, Serialize(item));
    }
    Check(SystemShare.ItemSystem.GetStdItemIdx("木剑") == 207, "Wooden sword ID must be 207");
    Check(SystemShare.ItemSystem.GetStdItemIdx("布衣(男)") == 97, "Male cloth ID must be 97");
});
Case("sparse rows preserve IDs and all retained item fields", () => {
    Reset("Id NOT IN (1,2,121,196,241,999)"); Check(Load() == 1, "Sparse item load failed");
    foreach (var (id, expected) in baseline) {
        if (new[] { 1, 2, 121, 196, 241, 999 }.Contains((int)id)) {
            Check(SystemShare.ItemSystem.GetStdItem(id) == null, $"Deleted ID {id} resolved to another item");
            Check(SystemShare.ItemSystem.GetStdItemName(id) == string.Empty, $"Deleted ID {id} retained a name");
            Check(SystemShare.ItemSystem.GetStdItemWeight(id) == 0, $"Deleted ID {id} retained weight");
        } else {
            Check(Serialize(SystemShare.ItemSystem.GetStdItem(id)) == expected, $"Retained item {id} shifted or changed");
        }
    }
    Check(SystemShare.ItemSystem.ItemCount == 1000, "Vacancies must preserve the last native ID");
    Check(SystemShare.ItemSystem.GetStdItemIdx("木剑") == 207, "Wooden sword name lookup shifted");
    UserItem created = null;
    Check(SystemShare.ItemSystem.CopyToUserItemFromName("木剑", ref created) && created.Index == 207,
        "Name-based native creation shifted or threw at a vacancy");
    Check(SystemShare.ItemSystem.GetStdItem("木剑").Name == "木剑", "Name lookup failed at a vacancy");
    UserItem removed = null;
    Check(!SystemShare.ItemSystem.CopyToUserItemFromName("天之黑铁头盔", ref removed), "Removed item can still be created");
});
Case("equipped, bag and warehouse instances keep identity, durability and make index", () => {
    Sql("INSERT INTO mir2_db.characters_item (PlayerId,Position,MakeIndex,StdIndex,Dura,DuraMax) VALUES (101,1,314159,207,3978,4000);"
        + "INSERT INTO mir2_db.characters_bagitem (PlayerId,Position,MakeIndex,StdIndex,Dura,DuraMax) VALUES (101,2,271828,97,100,5000);"
        + "INSERT INTO mir2_db.characters_storageitem (PlayerId,MakeIndex,StdIndex,Dura,DuraMax) VALUES (101,161803,98,200,5000);");
    foreach (var (table, name, makeIndex, dura, max) in new[] {
        ("characters_item", "木剑", 314159, 3978, 4000),
        ("characters_bagitem", "布衣(男)", 271828, 100, 5000),
        ("characters_storageitem", "布衣(女)", 161803, 200, 5000)
    }) {
        using var command = new MySqlCommand($"SELECT MakeIndex,StdIndex,Dura,DuraMax FROM mir2_db.{table} WHERE PlayerId=101", connection);
        using var reader = command.ExecuteReader(); Check(reader.Read(), "Missing saved fixture");
        var saved = new UserItem { MakeIndex = reader.GetInt32(0), Index = reader.GetUInt16(1),
            Dura = reader.GetUInt16(2), DuraMax = reader.GetUInt16(3) };
        Check(SystemShare.ItemSystem.GetStdItem(saved.Index)?.Name == name, $"Saved {table} instance changed identity");
        Check(saved.MakeIndex == makeIndex && saved.Dura == dura && saved.DuraMax == max, "Saved instance was rewritten");
    }
});
Case("SQL physical order cannot change native item identities", () => {
    Reset(order: "Id DESC");
    Check(Scalar("SELECT Id FROM stditems LIMIT 1") == "1000", "Fixture failed to reverse physical order");
    Check(Load() == 1, "Reverse-ordered table failed to load");
    foreach (var (id, expected) in baseline) Check(Serialize(SystemShare.ItemSystem.GetStdItem(id)) == expected,
        $"Physical row order changed item {id}");
});
Case("reloading a sparse list does not accumulate placeholders", () => {
    Reset("Id IN (97,98,207)"); Check(Load() == 1 && Load() == 1, "Reload failed");
    Check(SystemShare.ItemSystem.ItemCount == 207, "Reload accumulated or collapsed vacant positions");
    foreach (ushort id in new ushort[] { 97, 98, 207 })
        Check(Serialize(SystemShare.ItemSystem.GetStdItem(id)) == baseline[id], $"Reload changed {id}");
});
Case("highest representable native item ID is preserved", () => {
    Reset("Id=207"); Sql("UPDATE stditems SET Id=65535"); Check(Load() == 1, "ushort maximum ID rejected");
    Check(SystemShare.ItemSystem.ItemCount == 65535 && SystemShare.ItemSystem.GetStdItem(65535)?.Name == "木剑",
        "ushort maximum ID shifted");
    Check(SystemShare.ItemSystem.GetStdItemIdx("木剑") == 65535, "Maximum name lookup overflowed");
    Check(SystemShare.ItemSystem.GetStdItem(0) == null, "Zero native ID must stay invalid");
});
foreach (var id in new long[] { 0, -1, 65536, 2147483648 }) Case($"invalid SQL ID {id} rejects the whole list", () => {
    Reset("Id IN (97,207)"); Sql($"UPDATE stditems SET Id={id} WHERE Id=207");
    Check(Load() < 0, "Invalid ID reported success");
    Check(SystemShare.ItemSystem.ItemCount == 0, "Rejected load retained partial or old definitions");
});
Case("duplicate SQL IDs reject the whole list", () => {
    Reset("Id IN (97,207)"); Sql("INSERT INTO stditems SELECT * FROM stditems WHERE Id=207");
    Check(Load() < 0 && SystemShare.ItemSystem.ItemCount == 0, "Duplicate IDs accepted or left partial definitions");
});
Case("conversion failure after a valid row cannot report partial success", () => {
    Reset("Id IN (97,207)"); Sql("UPDATE stditems SET Source=128 WHERE Id=207");
    Check(Load() < 0 && SystemShare.ItemSystem.ItemCount == 0, "Conversion exception reported success or kept partial rows");
});
Case("empty table rejects and removes the previous list", () => {
    Reset(); Check(Load() == 1, "Precondition load failed"); Sql("TRUNCATE stditems");
    Check(Load() < 0 && SystemShare.ItemSystem.ItemCount == 0, "Empty table retained previous definitions");
});
Case("a valid load recovers after rejection", () => {
    Reset("Id=207"); Check(Load() == 1, "Valid recovery failed");
    Check(SystemShare.ItemSystem.GetStdItemIdx("木剑") == 207, "Recovery changed native identity");
});
Console.WriteLine("ITEM_CHECK_RESULTS=" + JsonSerializer.Serialize(results));
Console.WriteLine($"Native item checks: {results.Count - failures}/{results.Count} passed.");
Environment.ExitCode = failures == 0 ? 0 : 1;
