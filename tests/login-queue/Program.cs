using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;
using GameSrv.Word;
using M2Server;
using M2Server.Net;
using OpenMir2;
using OpenMir2.Data;
using Serilog;
using SystemModule.SubSystem;

LogService.Logger = new LoggerConfiguration().CreateLogger();
M2Share.FrontEngine = DispatchProxy.Create<IFrontEngine, EmptyBackend>();
M2Share.NetChannel = DispatchProxy.Create<INetChannel, EmptyBackend>();
foreach (var type in new[] { typeof(WorldServer), typeof(M2Share) })
    Console.WriteLine($"Assembly {Path.GetFileName(type.Assembly.Location)} SHA-256: "
        + Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(type.Assembly.Location))).ToLowerInvariant());
const BindingFlags flags = BindingFlags.Instance | BindingFlags.NonPublic;
var results = new List<object>();
foreach (var expired in new int[][] { [], [0], [1], [2], [3], [0, 1], [1, 2], [0, 2, 3], [0, 1, 2, 3] }) {
    string label = "finished indices " + string.Join(',', expired);
    try {
        var world = new WorldServer();
        var requests = (IList<UserOpenInfo>)typeof(WorldServer).GetField("LoadPlayList", flags)!.GetValue(world)!;
        var original = Enumerable.Range(0, 4).Select(index => new UserOpenInfo {
            ChrName = "waiting" + index, QueryId = 1000 + index, FailCount = expired.Contains(index) ? 50 : 0,
            LoadUser = new LoadDBInfo { SessionID = 1, SocketId = index + 1 }
        }).ToArray();
        foreach (var request in original) requests.Add(request);
        typeof(WorldServer).GetProperty("ProcessLoadPlayTick", flags)!.SetValue(world, HUtil32.GetTickCount() - 1000);
        world.ProcessHumans();
        var expected = original.Where((_, index) => !expired.Contains(index)).ToArray();
        if (!requests.SequenceEqual(expected)) throw new Exception("An unfinished character request was removed or a finished one remained");
        var queue = (IList<int>)typeof(WorldServer).GetField("LoadPlayerQueue", flags)!.GetValue(world)!;
        if (queue.Count != 0) throw new Exception("Finished queue was not cleared");
        results.Add(new { label, passed = true });
    } catch (Exception error) { results.Add(new { label, passed = false, error = error.GetBaseException().Message }); }
}
Console.WriteLine("LOGIN_QUEUE_RESULTS=" + JsonSerializer.Serialize(results));
int passed = results.Count(result => JsonSerializer.SerializeToElement(result).GetProperty("passed").GetBoolean());
Console.WriteLine($"Native login queue checks: {passed}/{results.Count}");
Environment.ExitCode = passed == results.Count ? 0 : 1;

public class EmptyBackend : DispatchProxy {
    protected override object? Invoke(MethodInfo? method, object?[]? args) =>
        method!.ReturnType == typeof(void) ? null : method.ReturnType.IsValueType ? Activator.CreateInstance(method.ReturnType) : null;
}
