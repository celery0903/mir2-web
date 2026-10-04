using System.Collections;
using System.Drawing;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using C = ClientPackets;
using S = ServerPackets;

if (args.Contains("--health"))
{
    using var probe = new HttpClient { Timeout = TimeSpan.FromSeconds(4) };
    try { return (await probe.GetAsync("http://127.0.0.1:8080/healthz")).IsSuccessStatusCode ? 0 : 1; }
    catch { return 1; }
}
var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls("http://0.0.0.0:8080");
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 4096);
builder.Logging.AddFilter("Microsoft.AspNetCore", LogLevel.Warning);
builder.Services.AddResponseCompression(options => options.EnableForHttps = true);
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = 429;
    options.AddPolicy("connections", context => RateLimitPartition.GetFixedWindowLimiter(context.Connection.RemoteIpAddress?.ToString() ?? "unknown", _ => new FixedWindowRateLimiterOptions { PermitLimit = 30, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    options.AddPolicy("registrations", context => RateLimitPartition.GetFixedWindowLimiter(context.Connection.RemoteIpAddress?.ToString() ?? "unknown", _ => new FixedWindowRateLimiterOptions { PermitLimit = 5, Window = TimeSpan.FromHours(1), QueueLimit = 0 }));
});
var app = builder.Build();
var gameHost = Environment.GetEnvironmentVariable("GAME_HOST") ?? "game";
using var http = new HttpClient { BaseAddress = new Uri($"http://{gameHost}:7001"), Timeout = TimeSpan.FromSeconds(5) };
var json = new JsonSerializerOptions(JsonSerializerDefaults.Web) { IncludeFields = true };
app.Use(async (context, next) =>
{
    context.Response.Headers["X-Content-Type-Options"] = "nosniff";
    context.Response.Headers["Referrer-Policy"] = "same-origin";
    context.Response.Headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; font-src 'self'; frame-ancestors 'none'; base-uri 'self'";
    await next(context);
});
app.UseRateLimiter();
app.UseResponseCompression();
app.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(20) });
app.UseDefaultFiles();
app.UseStaticFiles();
app.MapGet("/healthz", async () =>
{
    try { return (await http.GetAsync("/healthz")).IsSuccessStatusCode ? Results.Ok(new { status = "ok", engine = "Crystal" }) : Results.StatusCode(503); }
    catch (HttpRequestException) { return Results.StatusCode(503); }
    catch (TaskCanceledException) { return Results.StatusCode(503); }
});
app.MapPost("/api/register", async (HttpContext context) =>
{
    if (!SameOrigin(context)) return Results.StatusCode(403);
    if (context.Request.ContentLength is > 4096) return Results.StatusCode(413);
    try
    {
        var account = await context.Request.ReadFromJsonAsync<C.NewAccount>(json, context.RequestAborted);
        if (account == null || !ValidAccount(account)) return Results.BadRequest(new { message = "账号或密码格式不正确" });
        account = new C.NewAccount { AccountID = account.AccountID, Password = account.Password, BirthDate = new DateTime(2000, 1, 1) };
        using var response = await http.PostAsJsonAsync("/internal/register", account, json, context.RequestAborted);
        var result = await response.Content.ReadFromJsonAsync<JsonElement>(cancellationToken: context.RequestAborted);
        return Results.Json(result);
    }
    catch (JsonException) { return Results.BadRequest(); }
    catch (HttpRequestException) { return Results.StatusCode(503); }
}).RequireRateLimiting("registrations");
app.Map("/ws", async context =>
{
    if (!context.WebSockets.IsWebSocketRequest || !SameOrigin(context)) { context.Response.StatusCode = 403; return; }
    using var tcp = new TcpClient { NoDelay = true };
    try { await tcp.ConnectAsync(gameHost, 7000, context.RequestAborted); }
    catch (SocketException) { context.Response.StatusCode = 503; return; }
    using var socket = await context.WebSockets.AcceptWebSocketAsync();
    using var lifetime = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted);
    using var writes = new SemaphoreSlim(1);
    var stream = tcp.GetStream();
    async Task Write(Packet packet)
    {
        await writes.WaitAsync(lifetime.Token);
        try { await stream.WriteAsync(packet.GetPacketBytes().ToArray(), lifetime.Token); }
        finally { writes.Release(); }
    }
    async Task ReadGame()
    {
        var header = new byte[4];
        while (!lifetime.IsCancellationRequested)
        {
            await stream.ReadExactlyAsync(header, lifetime.Token);
            var length = BitConverter.ToUInt16(header, 0);
            if (length < 4) throw new InvalidDataException("Invalid Crystal frame length.");
            var frame = new byte[length];
            header.CopyTo(frame, 0);
            await stream.ReadExactlyAsync(frame.AsMemory(4), lifetime.Token);
            var packet = Packet.ReceivePacket(frame, out _) ?? throw new InvalidDataException("Unknown Crystal packet.");
            if (packet is S.Connected) { await Write(new C.ClientVersion { VersionHash = [] }); continue; }
            if (packet is S.KeepAlive) continue;
            var type = packet is S.ClientVersion { Result: 1 } ? "Ready" : packet.GetType().Name;
            var data = JsonSerializer.SerializeToUtf8Bytes(new { type, data = Project(packet) }, json);
            await socket.SendAsync(data, WebSocketMessageType.Text, true, lifetime.Token);
        }
    }
    async Task ReadBrowser()
    {
        var buffer = new byte[8192];
        var received = 0;
        var commands = 0;
        var window = DateTime.UtcNow;
        while (!lifetime.IsCancellationRequested)
        {
            var result = await socket.ReceiveAsync(buffer.AsMemory(received), lifetime.Token);
            if (result.MessageType == WebSocketMessageType.Close) return;
            if (result.MessageType != WebSocketMessageType.Text) throw new InvalidDataException("Expected JSON.");
            received += result.Count;
            if (received >= buffer.Length) throw new InvalidDataException("Message too large.");
            if (!result.EndOfMessage) continue;
            if (DateTime.UtcNow - window > TimeSpan.FromSeconds(1)) { window = DateTime.UtcNow; commands = 0; }
            if (++commands > 25) throw new InvalidDataException("Command rate exceeded.");
            using var doc = JsonDocument.Parse(buffer.AsMemory(0, received));
            var root = doc.RootElement;
            var type = root.GetProperty("type").GetString();
            var body = root.GetProperty("data");
            var packetType = type switch
            {
                "Login" => typeof(C.Login), "NewCharacter" => typeof(C.NewCharacter), "StartGame" => typeof(C.StartGame),
                "Walk" => typeof(C.Walk), "Turn" => typeof(C.Turn), "Attack" => typeof(C.Attack), "Chat" => typeof(C.Chat),
                "PickUp" => typeof(C.PickUp), "EquipItem" => typeof(C.EquipItem), "RemoveItem" => typeof(C.RemoveItem),
                "UseItem" => typeof(C.UseItem), "TownRevive" => typeof(C.TownRevive), "LogOut" => typeof(C.LogOut),
                _ => throw new InvalidDataException("Unsupported command.")
            };
            if (body.GetRawText().Length > 2048) throw new InvalidDataException("Command payload too large.");
            var packet = (Packet)body.Deserialize(packetType, json)!;
            if (packet is C.Login login && !ValidAccount(new C.NewAccount { AccountID = login.AccountID, Password = login.Password })) throw new InvalidDataException("Invalid login.");
            if (packet is C.Chat chat && (chat.Message is not { Length: > 0 and <= 150 } || chat.LinkedItems is not { Count: 0 })) throw new InvalidDataException("Invalid chat.");
            if (packet is C.NewCharacter character && ((int)character.Class > 2 || (int)character.Gender > 1 || character.Name is not { Length: >= 3 and <= 20 })) throw new InvalidDataException("Invalid character.");
            await Write(packet);
            received = 0;
        }
    }
    async Task Heartbeat()
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(3));
        while (await timer.WaitForNextTickAsync(lifetime.Token)) await Write(new C.KeepAlive { Time = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() });
    }
    var tasks = new[] { ReadGame(), ReadBrowser(), Heartbeat() };
    try { await await Task.WhenAny(tasks); }
    catch (Exception ex) when (ex is IOException or InvalidDataException or WebSocketException or OperationCanceledException or JsonException or InvalidOperationException or KeyNotFoundException) { app.Logger.LogInformation("Game session ended: {Reason}", ex.GetType().Name); }
    finally
    {
        lifetime.Cancel();
        tcp.Close();
        try { await Task.WhenAll(tasks); } catch (Exception) { /* All session tasks are observed on disconnect. */ }
        if (socket.State == WebSocketState.Open)
        {
            using var closing = new CancellationTokenSource(TimeSpan.FromSeconds(2));
            try { await socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "Session ended", closing.Token); }
            catch (Exception ex) when (ex is WebSocketException or OperationCanceledException) { }
        }
    }
}).RequireRateLimiting("connections");
await app.RunAsync();
return 0;

static bool SameOrigin(HttpContext context)
{
    var origin = context.Request.Headers.Origin.ToString();
    if (origin.Length == 0) return !context.WebSockets.IsWebSocketRequest;
    return Uri.TryCreate(origin, UriKind.Absolute, out var uri) && string.Equals(uri.Authority, context.Request.Host.Value, StringComparison.OrdinalIgnoreCase);
}
static bool ValidAccount(C.NewAccount account) =>
    account.AccountID != null && account.Password != null &&
    System.Text.RegularExpressions.Regex.IsMatch(account.AccountID, "^[A-Za-z0-9]{3,15}$") &&
    System.Text.RegularExpressions.Regex.IsMatch(account.Password, "^[A-Za-z0-9]{5,15}$");

// Project only fields: several legacy UserItem getters assume a desktop-side item database.
static object? Project(object? value, int depth = 0)
{
    if (value == null || depth > 14) return null;
    if (value is ulong id) return id.ToString();
    if (value is Enum) return Convert.ToInt32(value);
    if (value is string or bool or byte or short or ushort or int or uint or long or float or double or decimal or DateTime) return value;
    if (value is Point point) return new { x = point.X, y = point.Y };
    if (value is Color colour) return $"#{colour.R:x2}{colour.G:x2}{colour.B:x2}";
    if (value is Stats stats) return stats.Values.ToDictionary(pair => pair.Key.ToString(), pair => pair.Value);
    if (value is IEnumerable list) return list.Cast<object?>().Select(item => Project(item, depth + 1)).ToArray();
    return value.GetType().GetFields(BindingFlags.Public | BindingFlags.Instance)
        .ToDictionary(field => JsonNamingPolicy.CamelCase.ConvertName(field.Name), field => Project(field.GetValue(value), depth + 1));
}
