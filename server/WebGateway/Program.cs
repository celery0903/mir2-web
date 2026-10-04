using System.Net.WebSockets;
using System.Text;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using OpenMir2;
using OpenMir2.Packets.ClientPackets;

Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
if (args.Contains("--health"))
{
    using var probe = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };
    try { return (await probe.GetAsync("http://127.0.0.1:8080/healthz")).IsSuccessStatusCode ? 0 : 1; } catch { return 1; }
}
var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls("http://0.0.0.0:8080");
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 4096);
builder.Logging.AddFilter("Microsoft.AspNetCore", LogLevel.Warning);
builder.Services.AddResponseCompression();
builder.Services.AddRateLimiter(options => {
    options.RejectionStatusCode = 429;
    options.AddPolicy("connections", context => RateLimitPartition.GetFixedWindowLimiter(context.Connection.RemoteIpAddress?.ToString() ?? "unknown", _ => new FixedWindowRateLimiterOptions { PermitLimit = 30, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    options.AddPolicy("registrations", context => RateLimitPartition.GetFixedWindowLimiter(context.Connection.RemoteIpAddress?.ToString() ?? "unknown", _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromHours(1), QueueLimit = 0 }));
});
var app = builder.Build();
var engineHost = Environment.GetEnvironmentVariable("GAME_HOST") ?? "engine";
using var engine = new HttpClient { BaseAddress = new Uri($"http://{engineHost}:8081"), Timeout = TimeSpan.FromSeconds(3) };
app.Use(async (context, next) => {
    context.Response.Headers["X-Content-Type-Options"] = "nosniff";
    context.Response.Headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; font-src 'self'; frame-ancestors 'none'; base-uri 'self'";
    await next(context);
});
app.UseRateLimiter(); app.UseResponseCompression();
app.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(20) });
app.UseDefaultFiles(); app.UseStaticFiles();
app.MapGet("/healthz", async () => { try { return (await engine.GetAsync("/health")).IsSuccessStatusCode ? Results.Ok(new { status = "ok", engine = "OpenMir2" }) : Results.StatusCode(503); } catch { return Results.StatusCode(503); } });
app.MapPost("/api/register", async (HttpContext context) => {
    if (!SameOrigin(context)) return Results.StatusCode(403);
    try {
        var account = await context.Request.ReadFromJsonAsync<Registration>(context.RequestAborted);
        if (account == null || !Credentials.Valid(account.AccountID, account.Password)) return Results.BadRequest(new { message = "账号和密码格式不正确" });
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted); timeout.CancelAfter(TimeSpan.FromSeconds(8));
        using var connection = new LegacyConnection(); await connection.Connect(engineHost, 7000, timeout.Token);
        // LoginSrv ignores account creation during the first second of a connection.
        await Task.Delay(1100, timeout.Token);
        var entry = new UserEntry { Account = account.AccountID, Password = account.Password, UserName = account.AccountID, SSNo = "", Phone = "", Quiz = "", Answer = "", EMail = "" };
        var addition = new UserEntryAdd { Quiz2 = Guid.NewGuid().ToString("N"), Answer2 = Guid.NewGuid().ToString("N"), BirthDay = "2000-01-01", MobilePhone = "", Memo = "", Memo2 = "" };
        await connection.Send(Messages.CM_ADDNEWUSER, body: EDCode.EncodeBuffer(entry) + EDCode.EncodeBuffer(addition), token: timeout.Token);
        while (true) {
            var packet = await connection.Read(timeout.Token);
            if (packet.Header.Ident == Messages.SM_NEWID_SUCCESS) return Results.Ok(new { result = 8 });
            if (packet.Header.Ident == Messages.SM_NEWID_FAIL) return Results.Ok(new { result = packet.Header.Recog == 0 ? 7 : 0 });
        }
    } catch (System.Text.Json.JsonException) { return Results.BadRequest(); } catch (Exception exception) when (exception is IOException or OperationCanceledException or System.Net.Sockets.SocketException) { return Results.StatusCode(503); }
}).RequireRateLimiting("registrations");
app.Map("/ws", async context => {
    if (!context.WebSockets.IsWebSocketRequest || !SameOrigin(context)) { context.Response.StatusCode = 403; return; }
    using var socket = await context.WebSockets.AcceptWebSocketAsync();
    using var session = new GatewaySession(socket, engineHost, context.RequestAborted);
    try { await session.Run(); }
    catch (Exception exception) when (exception is IOException or InvalidDataException or WebSocketException or OperationCanceledException or System.Net.Sockets.SocketException) { }
    catch (Exception exception) { app.Logger.LogError(exception, "OpenMir2 browser session failed"); }
}).RequireRateLimiting("connections");
await app.RunAsync(); return 0;

static bool SameOrigin(HttpContext context) => !context.Request.Headers.TryGetValue("Origin", out var origin) || Uri.TryCreate(origin.ToString(), UriKind.Absolute, out var uri) && uri.Authority.Equals(context.Request.Host.Value, StringComparison.OrdinalIgnoreCase) && uri.Scheme == context.Request.Scheme;
record Registration(string AccountID, string Password);
