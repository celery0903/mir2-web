using System.Net.WebSockets;
using System.Reflection;
using System.Text.Json;
using Mir2.WebGateway;

using var session = new GatewaySession(WebSocket.CreateFromStream(Stream.Null, false, null, Timeout.InfiniteTimeSpan));
var flags = BindingFlags.Instance | BindingFlags.NonPublic;
var generation = typeof(GatewaySession).GetField("mapGeneration", flags)!;
var requests = (Queue<int>)typeof(GatewaySession).GetField("minimapRequests", flags)!.GetValue(session)!;
var update = typeof(GatewaySession).GetMethod("UpdateMinimap", flags)!;
object? Receive(int id, ushort index) => update.Invoke(session, [new LegacyPacket(id, 0, index, 0, 0, [])]);
void Require(bool condition, string message) { if (!condition) throw new Exception(message); }

generation.SetValue(session, 1);
Require(Receive(710, 101) is null, "unsolicited native minimap must be ignored");
requests.Enqueue(1);
using (var packet = JsonDocument.Parse(JsonSerializer.Serialize(Receive(710, 101))))
{
    var message = packet.RootElement;
    Require(message.GetProperty("available").GetBoolean() && message.GetProperty("frameIndex").GetInt32() == 100
        && message.GetProperty("sourceIndex").GetInt32() == 101, "native one-based frame must be converted exactly once");
}
requests.Enqueue(1);
generation.SetValue(session, 2);
requests.Enqueue(2);
Require(Receive(710, 102) is null, "previous-map response must be discarded");
using (var packet = JsonDocument.Parse(JsonSerializer.Serialize(Receive(711, 0))))
    Require(!packet.RootElement.GetProperty("available").GetBoolean()
        && packet.RootElement.GetProperty("frameIndex").ValueKind == JsonValueKind.Null, "native failure must clear the frame");
Console.WriteLine("Native minimap success, failure, unsolicited response and stale map generation checks passed.");
