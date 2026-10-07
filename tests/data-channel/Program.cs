using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using GameSrv.Services;
using M2Server;
using OpenMir2;
using OpenMir2.DataHandlingAdapters;
using OpenMir2.Packets.ServerPackets;
using Serilog;
using SystemModule;

Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
LogService.Logger = new LoggerConfiguration().WriteTo.Console().CreateLogger();
M2Share.UserDBCriticalSection = new object();
foreach (var type in new[] { typeof(DataQueryServer), typeof(ServerRequestData) })
    Console.WriteLine($"Assembly {Path.GetFileName(type.Assembly.Location)} SHA-256: "
        + Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(type.Assembly.Location))).ToLowerInvariant());
string[] scenarios = ["single", "coalesced", "split-header", "split-body", "trailing-partial",
    "large-fragmented", "invalid-signature", "independent-adapters"];
string selected = args.FirstOrDefault() ?? "all";
var queryMap = (ConcurrentDictionary<int, ServerRequestData>)typeof(PlayerDataService)
    .GetField("QueryMap", BindingFlags.Static | BindingFlags.NonPublic)!.GetValue(null)!;
var results = new List<object>();
foreach (string scenario in scenarios.Where(name => selected == "all" || selected == name)) {
    try {
        queryMap.Clear();
        if (scenario == "independent-adapters") {
            var first = new PlayerDataFixedHeaderDataHandlingAdapter();
            var second = new PlayerDataFixedHeaderDataHandlingAdapter();
            var method = first.GetType().GetMethod("GetInstance", BindingFlags.Instance | BindingFlags.NonPublic)!;
            var a = (PlayerDataMessageFixedHeaderRequestInfo)method.Invoke(first, null)!;
            var b = (PlayerDataMessageFixedHeaderRequestInfo)method.Invoke(second, null)!;
            if (ReferenceEquals(a, b)) throw new Exception("Separate database connections share one mutable packet");
            a.OnParsingHeader(SerializerUtil.Serialize(new ServerDataPacket { PacketLen = 10 }));
            b.OnParsingHeader(SerializerUtil.Serialize(new ServerDataPacket { PacketLen = 20 }));
            if (a.BodyLength != 10 || b.BodyLength != 20) throw new Exception("Packet length leaked across connections");
        } else {
            using var listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
            SystemShare.Config.sDBAddr = "127.0.0.1";
            SystemShare.Config.nDBPort = ((IPEndPoint)listener.LocalEndpoint).Port;
            var server = new DataQueryServer();
            server.Initialize();
            try {
                var accept = listener.AcceptTcpClientAsync();
                await server.Start();
                using var socket = await accept.WaitAsync(TimeSpan.FromSeconds(5));
                socket.NoDelay = true;
                var stream = socket.GetStream();
                var message = new ServerRequestMessage(Messages.DB_LOADHUMANRCD, 0, 0, 0, 0);
                byte[] requestPayload = [7, 8, 9];
                if (!server.SendRequest(99, message, requestPayload)) throw new Exception("Native request send failed");
                byte[] header = new byte[ServerDataPacket.FixedHeaderLen];
                await stream.ReadExactlyAsync(header).AsTask().WaitAsync(TimeSpan.FromSeconds(5));
                var requestHeader = SerializerUtil.Deserialize<ServerDataPacket>(header);
                if (requestHeader.PacketCode != Grobal2.PacketCode) throw new Exception("Request header marker changed");
                byte[] requestBody = new byte[requestHeader.PacketLen];
                await stream.ReadExactlyAsync(requestBody).AsTask().WaitAsync(TimeSpan.FromSeconds(5));
                var request = SerializerUtil.Deserialize<ServerRequestData>(requestBody);
                if (request.QueryId != 99 || !SerializerUtil.Deserialize<byte[]>(EDCode.DecodeBuff(request.Packet)).SequenceEqual(requestPayload))
                    throw new Exception("Native request framing or payload changed");
                int payloadLength = scenario == "large-fragmented" ? 9000 : 8;
                var responses = Enumerable.Range(1, scenario is "coalesced" or "trailing-partial" or "large-fragmented" ? 3 : 1)
                    .Select(id => Response(id, payloadLength)).ToArray();
                var packets = responses.Select(Frame).ToArray();
                if (scenario == "invalid-signature") {
                    var invalid = Response(40, 8);
                    invalid.Sign = EDCode.EncodeBuffer(BitConverter.GetBytes(123456));
                    await stream.WriteAsync(Frame(invalid));
                }
                byte[] wire = packets.SelectMany(packet => packet).ToArray();
                int cut = scenario switch {
                    "split-header" => 1,
                    "split-body" => ServerDataPacket.FixedHeaderLen + 4,
                    "trailing-partial" => packets[0].Length + packets[1].Length + 2,
                    "large-fragmented" => 18000,
                    _ => 0
                };
                if (cut > 0) {
                    await stream.WriteAsync(wire.AsMemory(0, cut));
                    await Task.Delay(120);
                    if (scenario is "split-header" or "split-body" && queryMap.Count != 0)
                        throw new Exception("Incomplete response was consumed before its body arrived");
                    await stream.WriteAsync(wire.AsMemory(cut));
                } else await stream.WriteAsync(wire);
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(4));
                while (queryMap.Count < responses.Length) await Task.Delay(20, timeout.Token);
                await Task.Delay(100);
                if (queryMap.Count != responses.Length) throw new Exception("Invalid or duplicate response was accepted");
                foreach (var response in responses) {
                    if (!queryMap.TryRemove(response.QueryId, out var actual) || !actual.Packet.SequenceEqual(response.Packet)
                        || !actual.Message.SequenceEqual(response.Message) || !actual.Sign.SequenceEqual(response.Sign))
                        throw new Exception("A database response was lost, truncated or delivered under another query ID");
                }
            } finally { server.Stop(); }
        }
        results.Add(new { scenario, passed = true });
    } catch (Exception error) { results.Add(new { scenario, passed = false, error = error.GetBaseException().Message }); }
}
Console.WriteLine("DATA_CHANNEL_RESULTS=" + JsonSerializer.Serialize(results));
int passed = results.Count(result => JsonSerializer.SerializeToElement(result).GetProperty("passed").GetBoolean());
Console.WriteLine($"Native database channel checks: {passed}/{results.Count}");
Environment.ExitCode = passed == results.Count && results.Count > 0 ? 0 : 1;

ServerRequestData Response(int id, int payloadLength) {
    var response = new ServerRequestData {
        QueryId = id,
        Message = EDCode.EncodeBuffer(SerializerUtil.Serialize(new ServerRequestMessage(Messages.DBR_LOADHUMANRCD, 1, 0, 0, 0))),
        Packet = EDCode.EncodeBuffer(Enumerable.Range(0, payloadLength).Select(index => (byte)(index + id)).ToArray())
    };
    int signature = HUtil32.MakeLong((ushort)(id ^ 170),
        (ushort)(response.Message.Length + response.Packet.Length + ServerDataPacket.FixedHeaderLen));
    response.Sign = EDCode.EncodeBuffer(BitConverter.GetBytes(signature));
    return response;
}
byte[] Frame(ServerRequestData response) {
    byte[] body = SerializerUtil.Serialize(response);
    byte[] header = SerializerUtil.Serialize(new ServerDataPacket { PacketCode = Grobal2.PacketCode, PacketLen = checked((ushort)body.Length) });
    return header.Concat(body).ToArray();
}
