global using System.Collections.Concurrent;
global using System.Threading.Channels;
using System.Net.Sockets;

// Compile the actual upstream consumer with transport doubles for disconnect races.
var sessions = new SessionManager();
var delivered = new TaskCompletionSource<byte[]>(TaskCreationOptions.RunContinuationsAsynchronously);
sessions.Values["disposed"] = new ClientSession(_ => throw new ObjectDisposedException("Socket"));
sessions.Values["socket"] = new ClientSession(_ => throw new SocketException((int)SocketError.ConnectionReset));
sessions.Values["live"] = new ClientSession(bytes => delivered.TrySetResult(bytes));
var manager = new ClientManager(sessions, new ConfigManager(), new ServerManager());
using var lifetime = new CancellationTokenSource();
manager.ProcessSendMessage(lifetime.Token);
foreach (var id in new[] { "unknown", "disposed", "socket", "live" })
    manager.SendQueue(new ServerDataMessage { SocketId = id, Data = [5, 0, 3] });
var received = await delivered.Task.WaitAsync(TimeSpan.FromSeconds(3));
if (!received.SequenceEqual(new byte[] { 5, 0, 3 }) || LogService.Warnings != 2)
    throw new Exception("Disconnected clients interrupted another client's login response.");
lifetime.Cancel();
Console.WriteLine("PASS: actual LoginGate response consumer survives disposed sockets and connection resets.");

public class SessionManager
{
    public ConcurrentDictionary<string, ClientSession> Values { get; } = new();
    public ClientSession GetSession(string id) => Values.GetValueOrDefault(id);
}
public class ClientSession(Action<byte[]> send)
{
    public void ProcessSvrData(byte[] bytes) => send(bytes);
}
public class ConfigManager { public List<object> GameGates { get; } = []; }
public class ServerService { }
public class ServerManager
{
    public IList<ServerService> GetServerList() => [];
    public int ReceiveQueueCount() => 0;
}
public class ClientThread(ClientManager manager, SessionManager sessions)
{
    public bool ConnectState, CheckServerFail;
    public int KeepAliveTick, CheckServerTick, CheckServerFailCount;
    public string EndPoint => "test";
    public void Initialize(object gate) { }
    public void Start() { }
    public void Stop() { }
    public void SendClientPacket(ServerDataMessage packet) { }
    public bool SessionIsFull() => false;
}
public struct ServerDataMessage
{
    public string SocketId;
    public byte[] Data;
    public ServerDataType Type;
}
public enum ServerDataType { KeepAlive }
public static class GateShare
{
    public const int KeepAliveTickTimeOut = 30000, CheckServerTimeOutTime = 30000;
}
public static class HUtil32 { public static int GetTickCount() => Environment.TickCount; }
public class RandomNumber
{
    public static RandomNumber GetInstance() => new();
    public int Random(int count) => 0;
}
public static class LogService
{
    public static int Warnings;
    public static void Warn(string message) => Interlocked.Increment(ref Warnings);
    public static void Debug(string message) { }
}
