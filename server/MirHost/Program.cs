using System.Drawing;
using System.Net.Sockets;
using System.Text.Json;
using Server;
using Server.MirDatabase;
using Server.MirEnvir;

if (args.Contains("--health"))
{
    using var probe = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };
    try { return (await probe.GetAsync("http://127.0.0.1:7001/healthz")).IsSuccessStatusCode ? 0 : 1; }
    catch { return 1; }
}

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls("http://0.0.0.0:7001");
builder.Logging.AddFilter("Microsoft.AspNetCore", LogLevel.Warning);
builder.Services.ConfigureHttpJsonOptions(options => options.SerializerOptions.IncludeFields = true);
var app = builder.Build();
Settings.Load();
Settings.IPAddress = "0.0.0.0";
Settings.Port = 7000;
Settings.MaxUser = 64;
Settings.MaxIP = 64;
Settings.MaxPacket = 200;
// Crystal compares ban expiry strictly; zero can reject simultaneous gateway connections.
Settings.IPBlockSeconds = -1;
Settings.RelogDelay = 0;
Settings.AllowStartGame = true;
Settings.AllowCreateAssassin = false;
Settings.AllowCreateArcher = false;
Settings.Multithreaded = false;
Settings.EnforceDBChecks = false;
Settings.StartHTTPService = false;
Settings.CheckVersion = false;
Settings.GMPassword = Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32));
Settings.SaveDelay = 1;
Packet.IsServer = true;
var world = JsonSerializer.Deserialize<World>(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "world.json")), new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
Bootstrap.Seed(world);
var engine = Envir.Main;
engine.Start();
var ready = false;
for (var i = 0; i < 100; i++)
{
    DrainLogs();
    if (!engine.Running) throw new InvalidOperationException("Crystal stopped during startup.");
    try
    {
        using var tcp = new TcpClient();
        await tcp.ConnectAsync("127.0.0.1", 7000);
        ready = true;
        break;
    }
    catch (SocketException) { await Task.Delay(100); }
}
if (!ready) throw new InvalidOperationException("Crystal did not start its TCP listener.");

app.MapGet("/healthz", () => engine.Running && ready && engine.Stopwatch.ElapsedMilliseconds - engine.Time < 5000 ? Results.Ok(new { status = "ok", engine = "Crystal", world = world.Name }) : Results.StatusCode(503));
// This endpoint is reachable only on the internal Compose network. It uses Crystal's account API,
// avoiding the legacy registration quota which otherwise counts every gateway user as one IP.
app.MapPost("/internal/register", (ClientPackets.NewAccount account) => Results.Ok(new { result = engine.HTTPNewAccount(account, "web-gateway") }));
var stopping = app.Lifetime.ApplicationStopping;
stopping.Register(() => { ready = false; engine.Stop(); });
var logTask = Task.Run(async () =>
{
    while (!stopping.IsCancellationRequested)
    {
        DrainLogs();
        await Task.Delay(500);
    }
    DrainLogs();
});
await app.RunAsync();
await logTask;
return 0;

static void DrainLogs()
{
    while (MessageQueue.Instance.MessageLog.TryDequeue(out var message)) Console.Write(message);
}

record World(string Name, string FileName, int Width, int Height, Spawn Spawn, int[][] Blocked);
record Spawn(int X, int Y);

static class Bootstrap
{
    public static void Seed(World world)
    {
        if (File.Exists(Envir.DatabasePath)) return;
        var engine = Envir.Main;
        var walls = world.Blocked.Select(p => (p[0], p[1])).ToHashSet();
        using (var file = File.Create(Path.Combine(Settings.MapPath, world.FileName + ".map")))
        using (var writer = new BinaryWriter(file))
        {
            writer.Write((short)world.Width);
            writer.Write((short)world.Height);
            writer.Write(new byte[48]);
            for (var x = 0; x < world.Width; x++)
                for (var y = 0; y < world.Height; y++)
                {
                    writer.Write(walls.Contains((x, y)) ? (ushort)0x8000 : (ushort)0);
                    writer.Write(new byte[10]);
                }
        }
        var map = new MapInfo { Index = 1, FileName = world.FileName, Title = world.Name, Light = LightSetting.Day, NoDropPlayer = true };
        map.SafeZones.Add(new SafeZoneInfo { Info = map, Location = new Point(world.Spawn.X, world.Spawn.Y), Size = 2, StartPoint = true });
        engine.MapInfoList.Add(map);
        engine.MapIndex = 1;

        AddItem(engine, "木剑", ItemType.Weapon, 104, 0, 4, 7);
        AddItem(engine, "布衣", ItemType.Armour, 98, 0, 0, 0);
        var potion = AddItem(engine, "金创药", ItemType.Potion, 115, 0, 0, 0);
        potion.Stats[Stat.HP] = 40;
        potion.StackSize = 20;
        var mana = AddItem(engine, "魔法药", ItemType.Potion, 116, 1, 0, 0);
        mana.Stats[Stat.MP] = 40;
        mana.StackSize = 20;
        AddItem(engine, "青铜剑", ItemType.Weapon, 106, 1, 6, 10).StartItem = false;
        var ring = AddItem(engine, "古铜戒指", ItemType.Ring, 103, 0, 1, 2);
        ring.StartItem = false;
        var specs = new[] {
            ("稻草人", Monster.Scarecrow, (byte)3, 5, 35u, 32, 24, 3),
            ("多钩猫", Monster.HookingCat, (byte)0, 18, 50u, 37, 19, 3),
            ("半兽人", Monster.Oma, (byte)0, 28, 80u, 34, 34, 7),
            ("骷髅", Monster.Skeleton, (byte)0, 38, 120u, 16, 12, 6)
        };
        foreach (var (name, image, ai, hp, exp, x, y, count) in specs)
        {
            var mob = new MonsterInfo { Index = ++engine.MonsterIndex, Name = name, Image = image, AI = ai, Level = 1, Experience = exp, ViewRange = 3, MoveSpeed = 1400, AttackSpeed = 2400 };
            mob.Stats[Stat.HP] = hp;
            mob.Stats[Stat.MinDC] = 1;
            mob.Stats[Stat.MaxDC] = 2;
            mob.Stats[Stat.Accuracy] = 10;
            engine.MonsterInfoList.Add(mob);
            map.Respawns.Add(new RespawnInfo { MonsterIndex = mob.Index, RespawnIndex = ++engine.RespawnIndex, Location = new Point(x, y), Count = (ushort)count, Spread = 2, Delay = 1 });
            File.WriteAllText(Path.Combine(Settings.DropPath, name + ".txt"), "1/1 Gold 30\n1/1 金创药\n1/4 青铜剑\n1/5 古铜戒指\n");
        }
        engine.SaveDB();
        Console.WriteLine("Seeded Qingshi world using Crystal's database and map formats.");
    }

    static ItemInfo AddItem(Envir engine, string name, ItemType type, ushort image, short shape, int min, int max)
    {
        var item = new ItemInfo { Index = ++engine.ItemIndex, Name = name, Type = type, Image = image, Shape = shape, StartItem = true, Durability = 5000, Weight = 1, Price = 100 };
        item.Stats[Stat.MinDC] = min;
        item.Stats[Stat.MaxDC] = max;
        if (type == ItemType.Armour) item.Stats[Stat.MaxAC] = 2;
        engine.ItemInfoList.Add(item);
        return item;
    }
}
