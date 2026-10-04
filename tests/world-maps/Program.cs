using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using M2Server.Actor;
using M2Server.Maps;
using OpenMir2;
using Serilog;
using SystemModule;

Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
LogService.Logger = new LoggerConfiguration().CreateLogger();
SystemShare.Config.EnvirDir = Path.GetTempPath();
Console.WriteLine("Assembly SHA-256: " + Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(typeof(BaseObject).Assembly.Location))).ToLowerInvariant());
using var pins = JsonDocument.Parse(File.ReadAllText("/world-lock.json"));
var cells = 0;
var count = 0;
foreach (var pin in pins.RootElement.GetProperty("maps").EnumerateArray()) {
    var id = pin.GetProperty("id").GetString();
    var path = Path.Combine("/maps", pin.GetProperty("sourceFile").GetString());
    var data = File.ReadAllBytes(path);
    var hash = Convert.ToHexString(SHA256.HashData(data)).ToLowerInvariant();
    if (hash != pin.GetProperty("sha256").GetString() || data.Length != pin.GetProperty("bytes").GetInt32()) throw new Exception($"Unpinned native map: {id}");
    var width = BinaryPrimitives.ReadInt16LittleEndian(data);
    var height = BinaryPrimitives.ReadInt16LittleEndian(data.AsSpan(2));
    var tail = pin.TryGetProperty("trailingBytes", out var value) ? value.GetInt32() : 0;
    if (data.Length != 52 + width * height * 12 + tail) throw new Exception($"Unexpected native map layout: {id}");
    using var map = new Envirnoment { MapName = id };
    if (!map.LoadMapData(path) || map.Width != width || map.Height != height) throw new Exception($"Native map load failed: {id}");
    for (short x = 0; x < width; x++) for (short y = 0; y < height; y++) {
        var at = 52 + (x * height + y) * 12;
        var blocked = ((BinaryPrimitives.ReadUInt16LittleEndian(data.AsSpan(at)) | BinaryPrimitives.ReadUInt16LittleEndian(data.AsSpan(at + 4))) & 0x8000) != 0;
        if (map.CellValid(x, y) == blocked) throw new Exception($"Native map collision mismatch: {id}/{x},{y}");
        cells++;
    }
    count++;
    Console.WriteLine($"PASS: {id}, {width}x{height}, {width * height} cells, {tail} pinned auxiliary bytes.");
}
Console.WriteLine($"Native world map checks: {count} maps, {cells} cells matched.");
