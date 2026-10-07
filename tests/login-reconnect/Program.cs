using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using GameSrv.Services;
using LoginSrv.Services;
using M2Server;
using OpenMir2;
using Serilog;
using SystemModule;
using SystemModule.SubSystem;

Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
LogService.Logger = new LoggerConfiguration().WriteTo.Console().CreateLogger();
SystemShare.WorldEngine = DispatchProxy.Create<IWorldEngine, EmptyBackend>();
M2Share.NetChannel = DispatchProxy.Create<M2Server.Net.INetChannel, EmptyBackend>();
SystemShare.Config.ServerName = "reconnect-test";
foreach (var type in new[] { typeof(AuthenticationService), typeof(SessionServer) })
    Console.WriteLine($"Assembly {Path.GetFileName(type.Assembly.Location)} SHA-256: "
        + Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(type.Assembly.Location))).ToLowerInvariant());
const BindingFlags flags = BindingFlags.Instance | BindingFlags.NonPublic;
string[] scenarios = ["initial-session", "remote-close", "split-reset", "explicit-close", "interleaved-fragments"];
string selected = args.FirstOrDefault() ?? "all";
var results = new List<object>();
foreach (string scenario in scenarios.Where(name => selected == "all" || name == selected)) {
    AuthenticationService? authentication = null;
    try {
        if (scenario == "interleaved-fragments") {
            // Exercise the actual parser without invoking account storage or external sockets.
            var server = (SessionServer)RuntimeHelpers.GetUninitializedObject(typeof(SessionServer));
            var alpha = new ServerSessionInfo { SocketId = "alpha", ReceiveMsg = "" };
            var beta = new ServerSessionInfo { SocketId = "beta", ReceiveMsg = "" };
            typeof(SessionServer).GetField("_serverList", flags)!.SetValue(server,
                new List<ServerSessionInfo> { alpha, beta });
            var read = typeof(SessionServer).GetMethod("SocketClientRead", flags)!;
            void Feed(string id, string text) {
                byte[] bytes = Encoding.ASCII.GetBytes(text);
                read.Invoke(server, [id, bytes, bytes.Length]);
            }
            Feed("alpha", "(987/alpha");
            if (alpha.ReceiveMsg != "(987/alpha" || beta.ReceiveMsg != "")
                throw new Exception("A partial login-server frame leaked into the other connection");
            Feed("beta", "(988/beta");
            if (alpha.ReceiveMsg != "(987/alpha" || beta.ReceiveMsg != "(988/beta")
                throw new Exception("The other connection erased a pending frame");
            Feed("alpha", ")");
            Feed("beta", ")");
            if (alpha.ReceiveMsg != "" || beta.ReceiveMsg != "")
                throw new Exception("Interleaved partial frames were not completely consumed");
        } else {
            using var listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
            SystemShare.Config.sIDSAddr = "127.0.0.1";
            SystemShare.Config.nIDSPort = ((IPEndPoint)listener.LocalEndpoint).Port;
            authentication = new AuthenticationService();
            authentication.Initialize();
            var accepting = listener.AcceptTcpClientAsync();
            await authentication.Start();
            using var first = await accepting.WaitAsync(TimeSpan.FromSeconds(5));
            await Greeting(first);
            await Authorize(first, authentication, 11);
            if (scenario == "explicit-close") {
                authentication.Close();
                await Until(() => authentication.GetSessionCount() == 0);
                using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(2));
                try {
                    using var unexpected = await listener.AcceptTcpClientAsync(deadline.Token);
                    throw new Exception("Intentional shutdown reopened the authentication socket");
                } catch (OperationCanceledException) when (deadline.IsCancellationRequested) { }
            } else if (scenario is "remote-close" or "split-reset") {
                if (scenario == "split-reset") {
                    await first.GetStream().WriteAsync(Encoding.ASCII.GetBytes($"({Messages.SS_OPENSESSION}/stale/99/"));
                    var pending = typeof(AuthenticationService).GetField("_socketRecvText", flags)!;
                    await Until(() => ((string)pending.GetValue(authentication)!).Contains("stale"));
                }
                first.Dispose();
                await Until(() => authentication.GetSessionCount() == 0);
                using var second = await listener.AcceptTcpClientAsync().WaitAsync(TimeSpan.FromSeconds(6));
                await Greeting(second);
                await Authorize(second, authentication, 22);
                if (authentication.GetSessionCount() != 1 || Admission(authentication, 11))
                    throw new Exception("Disconnected authorization remained usable after reconnect");
                if (scenario == "remote-close") {
                    second.Dispose();
                    await Until(() => authentication.GetSessionCount() == 0);
                    using var third = await listener.AcceptTcpClientAsync().WaitAsync(TimeSpan.FromSeconds(6));
                    await Greeting(third);
                    await Authorize(third, authentication, 33);
                }
            }
        }
        results.Add(new { scenario, passed = true });
    } catch (Exception error) {
        results.Add(new { scenario, passed = false, error = error.GetBaseException().Message });
    } finally { authentication?.Close(); }
}
Console.WriteLine("LOGIN_RECONNECT_RESULTS=" + JsonSerializer.Serialize(results));
int passed = results.Count(result => JsonSerializer.SerializeToElement(result).GetProperty("passed").GetBoolean());
Console.WriteLine($"Native login connection checks: {passed}/{results.Count}");
Environment.ExitCode = passed == results.Count && results.Count > 0 ? 0 : 1;

async Task Until(Func<bool> ready) {
    using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(4));
    while (!ready()) await Task.Delay(20, deadline.Token);
}
async Task Greeting(TcpClient peer) {
    using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(4));
    string received = "";
    byte[] buffer = new byte[256];
    while (!received.Contains(')')) {
        int count = await peer.GetStream().ReadAsync(buffer, deadline.Token);
        if (count == 0) throw new Exception("Authentication socket closed before its native greeting");
        received += Encoding.ASCII.GetString(buffer, 0, count);
    }
    if (!received.Contains($"({Messages.SS_SERVERINFO}/reconnect-test/"))
        throw new Exception("Reconnected engine did not identify itself to the login server");
}
bool Admission(AuthenticationService service, int session) {
    int mode = 0, payment = 0; long playTime = 0;
    return service.GetAdmission("ordinary", "127.0.0.1", session, ref mode, ref payment, ref playTime) != null;
}
async Task Authorize(TcpClient peer, AuthenticationService service, int session) {
    string message = $"({Messages.SS_OPENSESSION}/ordinary/{session}/0/0/127.0.0.1/0)";
    await peer.GetStream().WriteAsync(Encoding.ASCII.GetBytes(message));
    await Until(() => { service.Run(); return Admission(service, session); });
}
public class EmptyBackend : DispatchProxy {
    protected override object? Invoke(MethodInfo? method, object?[]? args) =>
        method!.ReturnType == typeof(void) ? null : method.ReturnType.IsValueType ? Activator.CreateInstance(method.ReturnType) : null;
}
