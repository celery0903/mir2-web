using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text.Json;
using Mir2.WebGateway;

var assembly = typeof(WorldProjection).Assembly;
Console.WriteLine("Proxy assembly SHA-256: " + Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(assembly.Location))).ToLowerInvariant());
var method = typeof(WorldProjection).GetMethod("GroupModeAtLogon");
var cases = new (string Label, int Id, int Length, uint Tag1, bool? Enabled)[] {
    ("saved permission off", 50, 16, 0, false),
    ("saved permission on", 50, 16, 1, true),
    ("feature extension is not permission", 50, 16, 0x12340000, false),
    ("feature extension preserves permission", 50, 16, 0x12340001, true),
    ("only the exact enabled flag is on", 50, 16, 2, false),
    ("other actor is not logon", 10, 16, 1, null),
    ("truncated logon is unknown", 50, 15, 1, null),
    ("empty logon is unknown", 50, 0, 0, null)
};
var results = new List<object>();
foreach (var test in cases) {
    try {
        if (method is null) throw new Exception("Native login group permission is not projected");
        var body = new byte[test.Length];
        if (body.Length >= 12) BinaryPrimitives.WriteUInt32LittleEndian(body.AsSpan(8), test.Tag1);
        var result = method.Invoke(null, [new LegacyPacket(test.Id, 123, 100, 200, 3, LegacyCodec.Encode(body))]);
        if (test.Enabled is null) {
            if (result is not null) throw new Exception("Unknown packet changed the permission");
        } else {
            using var document = JsonDocument.Parse(JsonSerializer.Serialize(result));
            if (document.RootElement.GetProperty("type").GetString() != "groupMode" ||
                document.RootElement.GetProperty("enabled").GetBoolean() != test.Enabled)
                throw new Exception("Permission differs from the native login flag");
        }
        results.Add(new { label = test.Label, passed = true });
    } catch (Exception error) { results.Add(new { label = test.Label, passed = false, error = error.Message }); }
}
Console.WriteLine("GROUP_PROXY_RESULTS=" + JsonSerializer.Serialize(results));
var passed = results.Count(result => JsonSerializer.SerializeToElement(result).GetProperty("passed").GetBoolean());
Console.WriteLine($"Native group login checks: {passed}/{results.Count}");
Environment.ExitCode = passed == results.Count ? 0 : 1;
