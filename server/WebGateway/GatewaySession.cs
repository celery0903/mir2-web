using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using OpenMir2;
using OpenMir2.Extensions;
using OpenMir2.Packets.ClientPackets;

public sealed class GatewaySession(WebSocket browser, string host, CancellationToken requestToken) : IDisposable
{
    private static readonly Dictionary<string, int> monsterArt = new() { ["鸡"] = 3, ["鹿"] = 4, ["稻草人"] = 5, ["多钩猫"] = 6, ["钉耙猫"] = 7, ["蛤蟆"] = 8, ["半兽人"] = 9, ["食人花"] = 10, ["森林雪人"] = 11, ["毒蜘蛛"] = 12 };
    private readonly CancellationTokenSource lifetime = CancellationTokenSource.CreateLinkedTokenSource(requestToken);
    private readonly SemaphoreSlim sends = new(1);
    private LegacyConnection connection = new();
    private string account = "", certification = "", characterName = "", createdName = "";
    private readonly List<string> characterNames = [];
    private readonly List<(int Job, int Gender)> characterDetails = [];
    private readonly Dictionary<int, Dictionary<string, object?>> objects = [];
    private readonly Dictionary<int, Dictionary<string, object?>> itemInfos = [];
    private readonly Dictionary<int, (string Name, int Submenu, int NativeID)> shopItems = [];
    private readonly Dictionary<int, Dictionary<string, object?>> storedItems = [];
    private readonly Dictionary<int, object> learnedMagics = [];
    private readonly object?[] inventory = new object?[46];
    private readonly object?[] equipment = new object?[14];
    private int selfID, x, y, direction = 4, job, gender, npcID, gold;
    private string map = "0";
    private (int ID, int Slot)? pendingEquip, pendingRemove;
    private int pendingUse, pendingSell;
    private (int ID, bool Deposit)? pendingStorage;
    private (int X, int Y, int Direction, string Type)? pendingAction;
    private readonly JsonSerializerOptions json = new(JsonSerializerDefaults.Web) { IncludeFields = true };
    private CancellationToken Token => lifetime.Token;

    public async Task Run()
    {
        await connection.Connect(host, 7000, Token);
        await Emit("Ready", new { engine = "OpenMir2" });
        var readGame = ReadGame();
        var readBrowser = ReadBrowser();
        var heartbeat = Heartbeat();
        try { await await Task.WhenAny(readGame, readBrowser, heartbeat); }
        finally {
            lifetime.Cancel(); connection.Dispose();
            try { await Task.WhenAll(readGame, readBrowser, heartbeat); } catch (Exception) { }
            if (browser.State == WebSocketState.Open) await browser.CloseAsync(WebSocketCloseStatus.NormalClosure, "Session ended", CancellationToken.None);
        }
    }

    public async Task Emit(string type, object data)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(new { type, data }, json);
        await sends.WaitAsync(Token);
        try { await browser.SendAsync(bytes, WebSocketMessageType.Text, true, Token); }
        finally { sends.Release(); }
    }

    private async Task Switch(int port, bool game = false)
    {
        var next = new LegacyConnection();
        await next.Connect(host, port, Token);
        if (game) next.SetGame();
        var previous = connection; connection = next; previous.Dispose();
    }

    private Task Send(int command, int id = 0, int param = 0, int tag = 0, int series = 0, string body = "") => connection.Send(command, id, param, tag, series, body, Token);
    private static int Number(JsonElement data, string name, int fallback = 0) => data.TryGetProperty(name, out var value) && value.TryGetInt32(out var number) ? number : fallback;
    private static string Text(JsonElement data, string name) => data.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() ?? "" : "";
    private static string Encode(string value) => EDCode.EncodeString(value);
    private static int Point(int a, int b) => (a & 65535) | (b << 16);
    private object Location => new { x, y };

    private async Task ReadBrowser()
    {
        var buffer = new byte[8192]; int length = 0, count = 0; var window = Environment.TickCount64;
        while (!Token.IsCancellationRequested)
        {
            var result = await browser.ReceiveAsync(buffer.AsMemory(length), Token);
            if (result.MessageType == WebSocketMessageType.Close) return;
            if (result.MessageType != WebSocketMessageType.Text || length + result.Count >= buffer.Length) throw new InvalidDataException("Invalid browser message");
            length += result.Count;
            if (!result.EndOfMessage) continue;
            if (Environment.TickCount64 - window > 1000) { count = 0; window = Environment.TickCount64; }
            if (++count > 30) throw new InvalidDataException("Command rate exceeded");
            using var document = JsonDocument.Parse(buffer.AsMemory(0, length)); length = 0;
            var type = Text(document.RootElement, "type");
            if (!document.RootElement.TryGetProperty("data", out var data)) continue;
            if (type == "Login")
            {
                account = Text(data, "accountID"); var password = Text(data, "password");
                if (!Credentials.Valid(account, password)) { await Emit("Login", new { result = 1 }); continue; }
                await Send(Messages.CM_IDPASSWORD, body: Encode(account + "/" + password));
            }
            else if (type == "NewCharacter" && certification != "")
            {
                createdName = Text(data, "name"); job = Number(data, "class"); gender = Number(data, "gender");
                if (!Credentials.ValidName(createdName) || job is < 0 or > 2 || gender is < 0 or > 1) { await Emit("NewCharacter", new { result = 1 }); continue; }
                await Task.Delay(1200, Token);
                await Send(Messages.CM_NEWCHR, body: Encode($"{account}/{createdName}/0/{job}/{gender}"));
            }
            else if (type == "StartGame" && !connection.Game)
            {
                var index = Number(data, "characterIndex", -1);
                if (index < 0 || index >= characterNames.Count) continue;
                characterName = characterNames[index];
                (job, gender) = characterDetails[index];
                await Send(Messages.CM_SELCHR, body: Encode(account + "/" + characterName));
            }
            else if (type == "DeleteCharacter" && !connection.Game && certification != "")
            {
                var index = Number(data, "characterIndex", -1);
                if (index >= 0 && index < characterNames.Count) {
                    var name = characterNames[index];
                    await Task.Delay(1200, Token);
                    await Send(Messages.CM_DELCHR, body: Encode(name));
                }
            }
            else if (connection.Game && selfID != 0)
            {
                var id = Number(data, "uniqueID");
                var dir = Number(data, "direction", direction);
                var itemName = itemInfos.TryGetValue(id, out var item) ? item["name"]?.ToString() ?? "" : "";
                switch (type)
                {
                    case "Walk": case "Run":
                        if (dir is >= 0 and <= 7 && pendingAction == null) {
                            var offsets = new (int X, int Y)[] { (0,-1),(1,-1),(1,0),(1,1),(0,1),(-1,1),(-1,0),(-1,-1) };
                            var step = type == "Run" ? 2 : 1; var target = offsets[dir];
                            var nextX = x + target.X * step; var nextY = y + target.Y * step;
                            pendingAction = (nextX, nextY, dir, type);
                            await Send(type == "Run" ? Messages.CM_RUN : Messages.CM_WALK, id: Point(nextX, nextY), tag: dir);
                        }
                        break;
                    case "Turn": if (dir is >= 0 and <= 7 && pendingAction == null) { pendingAction = (x, y, dir, type); await Send(Messages.CM_TURN, id: Point(x, y), tag: dir); } break;
                    case "Attack": if (dir is >= 0 and <= 7 && pendingAction == null) { pendingAction = (x, y, dir, type); await Send(Messages.CM_HIT, id: Point(x, y), tag: dir); } break;
                    case "Pickup": case "PickUp": await Send(Messages.CM_PICKUP, param: x, tag: y); break;
                    case "Harvest": var corpse = Number(data, "objectID"); var corpseX = Number(data, "x", x); var corpseY = Number(data, "y", y); await Send(Messages.CM_BUTCH, corpse, corpseX, corpseY, dir); break;
                    case "UseItem": if (itemName != "" && pendingUse == 0) { pendingUse = id; await Send(Messages.CM_EAT, id, body: Encode(itemName)); } break;
                    case "EquipItem": if (itemName != "" && pendingEquip == null) { var slot = Number(data, "to"); pendingEquip = (id, slot); await Send(Messages.CM_TAKEONITEM, id, NativeSlot(slot), body: Encode(itemName)); } break;
                    case "RemoveItem": if (itemName != "" && pendingRemove == null) { var slot = Array.FindIndex(equipment, entry => entry is Dictionary<string, object?> values && Convert.ToInt32(values["uniqueID"]) == id); if (slot >= 0) { pendingRemove = (id, Number(data, "to")); await Send(Messages.CM_TAKEOFFITEM, id, NativeSlot(slot), body: Encode(itemName)); } } break;
                    case "Chat": var message = Text(data, "message"); if (message.Length is > 0 and <= 150 && !message.StartsWith('@')) await Send(Messages.CM_SAY, body: Encode(message)); break;
                    case "CallNPC": npcID = Number(data, "objectID"); var key = Text(data, "key"); await Send(key == "" ? Messages.CM_CLICKNPC : Messages.CM_MERCHANTDLGSELECT, npcID, body: key == "" ? "" : Encode(key.Trim('[', ']'))); break;
                    case "MagicKey": await Send(Messages.CM_MAGICKEYCHANGE, Number(data, "spell"), Number(data, "key")); break;
                    case "Magic": var location = data.TryGetProperty("location", out var targetLocation) ? targetLocation : data; var targetID = Number(data, "targetID"); var spell = Number(data, "spell"); await Send(Messages.CM_SPELL, Point(Number(location, "x", x), Number(location, "y", y)), targetID & 65535, spell, (targetID >> 16) & 65535); break;
                    case "BuyItem":
                        if (shopItems.TryGetValue(Number(data, "itemIndex"), out var goods)) {
                            if (goods.Submenu != 0) await Send(Messages.CM_USERGETDETAILITEM, npcID, body: Encode(goods.Name));
                            else await Send(Messages.CM_USERBUYITEM, npcID, goods.NativeID & 65535, (goods.NativeID >> 16) & 65535, Math.Clamp(Number(data, "count", 1), 1, 10), Encode(goods.Name));
                        }
                        break;
                    case "SellItem": if (itemName != "" && pendingSell == 0) { pendingSell = id; await Send(Messages.CM_USERSELLITEM, npcID, id & 65535, (id >> 16) & 65535, body: Encode(itemName)); } break;
                    case "StoreItem":
                        if (itemName != "" && pendingStorage == null && inventory.Any(entry => entry is Dictionary<string, object?> values && Convert.ToInt32(values["uniqueID"]) == id)) {
                            pendingStorage = (id, true);
                            await Send(Messages.CM_USERSTORAGEITEM, npcID, id & 65535, (id >> 16) & 65535, body: Encode(itemName));
                        }
                        else if (pendingStorage == null) await Emit("StorageResult", new { success = false, message = "背包中没有这件物品" });
                        break;
                    case "WithdrawItem":
                        if (pendingStorage == null && storedItems.TryGetValue(id, out var stored)) {
                            pendingStorage = (id, false);
                            await Send(Messages.CM_USERTAKEBACKSTORAGEITEM, npcID, id & 65535, (id >> 16) & 65535, body: Encode(stored["name"]!.ToString()!));
                        }
                        else if (pendingStorage == null) await Emit("StorageResult", new { success = false, message = "仓库中没有这件物品" });
                        break;
                    case "LogOut": case "Revive": case "TownRevive":
                        await Send(Messages.CM_SOFTCLOSE, series: 1);
                        await Task.Delay(500, Token);
                        await browser.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "Return to login", Token); return;
                }
            }
        }
    }

    private async Task Heartbeat()
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(15));
        while (await timer.WaitForNextTickAsync(Token)) if (connection.Game) await Send(Messages.CM_CHECKTIME, unchecked((int)Environment.TickCount64));
    }

    private async Task ReadGame()
    {
        while (!Token.IsCancellationRequested)
        {
            var active = connection;
            (CommandMessage Header, string Body) packet;
            try { packet = await active.Read(Token); }
            catch (IOException) when (active != connection) { continue; }
            catch (ObjectDisposedException) when (active != connection) { continue; }
            var h = packet.Header; var body = packet.Body;
            if (Environment.GetEnvironmentVariable("MIR_PROTOCOL_TRACE") == "1") Console.WriteLine($"SM {h.Ident} id={h.Recog} x={h.Param} y={h.Tag} series={h.Series} body={body.Length}");
            switch (h.Ident)
            {
                case ushort.MaxValue:
                    if (pendingAction is { } action) { if (body.StartsWith("+GD/")) { x = action.X; y = action.Y; direction = action.Direction; } pendingAction = null; await Emit("UserLocation", new { location = Location, direction, action = action.Type }); }
                    break;
                case Messages.SM_PASSWD_FAIL: await Emit("Login", new { result = h.Recog switch { -1 => 4, -3 => 5, _ => 3 } }); break;
                case Messages.SM_NEEDUPDATE_ACCOUNT: await Emit("Login", new { result = 0 }); break;
                case Messages.SM_PASSOK_SELECTSERVER: await Send(Messages.CM_SELECTSERVER, body: Encode(EDCode.DeCodeString(body).Split('/', StringSplitOptions.RemoveEmptyEntries)[0])); break;
                case Messages.SM_SELECTSERVER_OK:
                    var address = EDCode.DeCodeString(body).Split('/'); certification = address[2];
                    await Switch(7100); await Send(Messages.CM_QUERYCHR, body: Encode(account + "/" + certification)); break;
                case Messages.SM_QUERYCHR:
                    var fields = (body.Length == 0 ? "" : EDCode.DeCodeString(body)).Split('/', StringSplitOptions.RemoveEmptyEntries); characterNames.Clear(); characterDetails.Clear(); var characters = new List<object>();
                    for (var i = 0; i + 4 < fields.Length; i += 5) { characterNames.Add(fields[i].TrimStart('*')); characterDetails.Add((int.Parse(fields[i + 1]), int.Parse(fields[i + 4]))); characters.Add(LegacyProjection.Character(fields[i..(i + 5)], characters.Count)); }
                    await Emit("LoginSuccess", new { characters });
                    if (createdName != "" && characterNames.Contains(createdName)) { characterName = createdName; createdName = ""; await Send(Messages.CM_SELCHR, body: Encode(account + "/" + characterName)); }
                    break;
                case Messages.SM_NEWCHR_SUCCESS: await Send(Messages.CM_QUERYCHR, body: Encode(account + "/" + certification)); break;
                case Messages.SM_NEWCHR_FAIL: createdName = ""; await Emit("NewCharacter", new { result = h.Recog switch { 2 => 5, 3 => 4, _ => 1 } }); break;
                case Messages.SM_DELCHR_SUCCESS: await Send(Messages.CM_QUERYCHR, body: Encode(account + "/" + certification)); break;
                case Messages.SM_DELCHR_FAIL: await Emit("DeleteCharacterFailed", new { message = "删除失败，请重新选择角色" }); break;
                case Messages.SM_STARTPLAY: await Switch(7200, true); await connection.Raw(Encode($"**{account}/{characterName}/{certification}/{Grobal2.ClientVersionNumber}/{Grobal2.ClientVersionNumber}"), Token); break;
                case Messages.SM_STARTFAIL: await Emit("StartGame", new { result = 3 }); break;
                case Messages.SM_SENDNOTICE: await Send(Messages.CM_LOGINNOTICEOK); break;
                case Messages.SM_NEWMAP: case Messages.SM_CHANGEMAP:
                    map = EDCode.DeCodeString(body); x = h.Param; y = h.Tag; objects.Clear(); pendingAction = null;
                    await Emit("MapInformation", new { map, location = Location, direction });
                    await Emit("UserLocation", new { location = Location, direction }); break;
                case Messages.SM_LOGON:
                    selfID = h.Recog; x = h.Param; y = h.Tag; direction = h.Series & 255;
                    Array.Clear(inventory); Array.Clear(equipment); objects.Clear();
                    await Emit("UserInformation", new { objectID = selfID, name = characterName, @class = job, gender, level = 1, hp = 1, mp = 1, gold = 0, experience = 0, location = Location, direction, inventory, equipment, magics = Array.Empty<object>(), map });
                    await Send(Messages.CM_QUERYBAGITEMS, 1); await Send(Messages.CM_QUERYUSERSTATE, selfID, x, y); break;
                case Messages.SM_ABILITY: gold = h.Recog; job = h.Param & 255; await Emit("UserAbility", LegacyProjection.Ability(body, gold, job)); break;
                case Messages.SM_HEALTHSPELLCHANGED:
                    if (h.Recog == selfID) await Emit("HealthChanged", new { hp = h.Param, mp = h.Tag });
                    else if (objects.TryGetValue(h.Recog, out var target)) { target["percent"] = h.Series > 0 ? h.Param * 100 / h.Series : 0; await Emit("ObjectHealth", new { objectID = h.Recog, percent = target["percent"] }); }
                    break;
                case Messages.SM_GOLDCHANGED: gold = h.Recog; await Emit("UserGold", new { gold }); break;
                case Messages.SM_WINEXP: await Emit("UserExperience", new { experience = h.Recog, amount = h.Param | (h.Tag << 16) }); break;
                case Messages.SM_LEVELUP: await Emit("LevelChanged", new { level = h.Param, experience = h.Recog }); break;
                case Messages.SM_BAGITEMS:
                    Array.Clear(inventory);
                    foreach (var encoded in body.Split('/', StringSplitOptions.RemoveEmptyEntries)) { var item = await Item(encoded); var slot = InventorySlot(item); if (slot >= 0) inventory[slot] = item; }
                    await Slots(); break;
                case Messages.SM_ADDITEM: case Messages.SM_UPDATEITEM:
                    var added = await Item(body); var addID = Convert.ToInt32(added["uniqueID"]);
                    var equippedIndex = Array.FindIndex(equipment, item => item is Dictionary<string, object?> values && Convert.ToInt32(values["uniqueID"]) == addID);
                    if (h.Ident == Messages.SM_UPDATEITEM && equippedIndex >= 0) { equipment[equippedIndex] = added; await Slots(); break; }
                    var existing = Array.FindIndex(inventory, item => item is Dictionary<string, object?> values && Convert.ToInt32(values["uniqueID"]) == addID);
                    if (existing < 0) existing = InventorySlot(added);
                    if (existing >= 0) inventory[existing] = added;
                    await Slots(); break;
                case Messages.SM_DELITEM: Remove(h.Recog); await Slots(); break;
                case Messages.SM_SENDUSEITEMS:
                    Array.Clear(equipment); var worn = body.Split('/', StringSplitOptions.RemoveEmptyEntries);
                    for (var i = 0; i + 1 < worn.Length; i += 2) { var index = BrowserSlot(int.Parse(worn[i])); if (index >= 0 && index < equipment.Length) equipment[index] = await Item(worn[i + 1]); }
                    await Slots(); break;
                case Messages.SM_TAKEON_OK: case Messages.SM_TAKEON_FAIL:
                    if (pendingEquip is { } equip && h.Ident == Messages.SM_TAKEON_OK) { var index = Array.FindIndex(inventory, item => item is Dictionary<string, object?> values && Convert.ToInt32(values["uniqueID"]) == equip.ID); if (index >= 0 && equip.Slot is >= 0 and < 14) { (inventory[index], equipment[equip.Slot]) = (equipment[equip.Slot], inventory[index]); } }
                    pendingEquip = null; await Slots(); break;
                case Messages.SM_TAKEOFF_OK: case Messages.SM_TAKEOFF_FAIL:
                    if (pendingRemove is { } remove && h.Ident == Messages.SM_TAKEOFF_OK) { var index = Array.FindIndex(equipment, item => item is Dictionary<string, object?> values && Convert.ToInt32(values["uniqueID"]) == remove.ID); if (index >= 0 && remove.Slot is >= 0 and < 46 && inventory[remove.Slot] == null) { inventory[remove.Slot] = equipment[index]; equipment[index] = null; } }
                    pendingRemove = null; await Slots(); break;
                case Messages.SM_EAT_OK: case Messages.SM_EAT_FAIL: if (h.Ident == Messages.SM_EAT_OK) Remove(pendingUse); pendingUse = 0; await Slots(); break;
                case Messages.SM_STRUCK:
                    if (h.Recog == selfID) await Emit("HealthChanged", new { hp = h.Param });
                    else if (objects.TryGetValue(h.Recog, out var struck)) { struck["percent"] = h.Tag > 0 ? h.Param * 100 / h.Tag : 0; await Emit("ObjectHealth", new { objectID = h.Recog, percent = struck["percent"] }); }
                    await Emit("DamageIndicator", new { objectID = h.Recog, damage = h.Series }); break;
                case Messages.SM_TURN: case Messages.SM_WALK: case Messages.SM_RUN: case Messages.SM_HIT: case Messages.SM_HEAVYHIT: case Messages.SM_MOVEFAIL: case Messages.SM_ALIVE:
                    if (h.Recog == selfID) { pendingAction = null; x = h.Param; y = h.Tag; direction = h.Series & 255; await Emit("UserLocation", new { location = Location, direction, action = h.Ident == Messages.SM_RUN ? "Run" : "Walk" }); }
                    else await Actor(h, body);
                    break;
                case Messages.SM_USERNAME:
                    if (objects.TryGetValue(h.Recog, out var actor)) { var name = EDCode.DeCodeString(body).Split('/')[0].Split('\\')[0]; actor["name"] = name; if (actor["kind"]?.ToString() == "monster" && monsterArt.TryGetValue(name, out var art)) actor["image"] = art; await Emit(actor["kind"]?.ToString() == "npc" ? "ObjectNPC" : actor["kind"]?.ToString() == "player" ? "ObjectPlayer" : "ObjectMonster", actor); }
                    break;
                case Messages.SM_DISAPPEAR: case Messages.SM_HIDE: objects.Remove(h.Recog); await Emit("ObjectRemove", new { objectID = h.Recog }); break;
                case Messages.SM_DEATH: case Messages.SM_NOWDEATH:
                    if (objects.TryGetValue(h.Recog, out var deadActor)) { deadActor["dead"] = true; deadActor["location"] = new { x = h.Param, y = h.Tag }; }
                    if (h.Recog == selfID) await Emit("Death", new { location = new { x = h.Param, y = h.Tag } });
                    else await Emit("ObjectDied", new { objectID = h.Recog, location = new { x = h.Param, y = h.Tag } });
                    break;
                case Messages.SM_ITEMSHOW:
                    var dropName = EDCode.DeCodeString(body); var isGold = dropName == "金币";
                    await Emit(isGold ? "ObjectGold" : "ObjectItem", new { objectID = h.Recog, location = new { x = h.Param, y = h.Tag }, image = h.Series, name = dropName, gold = 0 }); break;
                case Messages.SM_ITEMHIDE: await Emit("ObjectRemove", new { objectID = h.Recog }); break;
                case Messages.SM_HEAR: case Messages.SM_SYSMESSAGE: case Messages.SM_WHISPER: case Messages.SM_GUILDMESSAGE: await Emit("Chat", new { message = EDCode.DeCodeString(body) }); break;
                case Messages.SM_MERCHANTSAY: npcID = h.Recog; await Emit("NPCResponse", new { page = EDCode.DeCodeString(body).Replace('\\', '\n').Split('\n') }); break;
                case Messages.SM_SENDUSERSELL: await Emit("NPCSell", new { }); break;
                case Messages.SM_SENDGOODSLIST:
                    npcID = h.Recog; shopItems.Clear(); var goodsFields = (body.Length == 0 ? "" : EDCode.DeCodeString(body)).Split('/'); var goodsList = new List<object>();
                    for (var i = 0; i + 3 < goodsFields.Length; i += 4) { var key = -1 - i / 4; var submenu = int.Parse(goodsFields[i + 1]); shopItems[key] = (goodsFields[i], submenu, 0); goodsList.Add(new { itemIndex = key, uniqueID = key, name = goodsFields[i], submenu, price = int.Parse(goodsFields[i + 2]), stock = int.Parse(goodsFields[i + 3]) }); }
                    await Emit("NPCGoods", new { list = goodsList, rate = 1 }); break;
                case Messages.SM_SENDDETAILGOODSLIST:
                    npcID = h.Recog; shopItems.Clear(); var details = new List<object>();
                    foreach (var encoded in (body.Length == 0 ? "" : EDCode.DeCodeString(body)).Split('/', StringSplitOptions.RemoveEmptyEntries)) { var detail = await Item(encoded); var key = Convert.ToInt32(detail["uniqueID"]); shopItems[key] = (detail["name"]!.ToString()!, 0, key); detail["price"] = detail["maxDurability"]; details.Add(detail); }
                    await Emit("NPCGoods", new { list = details, rate = 1 }); break;
                case Messages.SM_MERCHANTDLGCLOSE: await Emit("NPCUpdate", new { type = 0 }); break;
                case Messages.SM_SENDUSERSTORAGEITEM:
                    npcID = h.Recog; await Emit("NPCStorage", new { objectID = npcID }); break;
                case Messages.SM_SAVEITEMLIST:
                    npcID = h.Recog;
                    if (h.Tag == 0) storedItems.Clear();
                    foreach (var encoded in body.Split('/', StringSplitOptions.RemoveEmptyEntries)) { var stored = await Item(encoded); storedItems[Convert.ToInt32(stored["uniqueID"])] = stored; }
                    if (h.Tag >= h.Series) await Emit("NPCStorageList", new { objectID = npcID, list = storedItems.Values });
                    break;
                case Messages.SM_STORAGE_OK:
                    if (pendingStorage is { Deposit: true } deposit) { Remove(deposit.ID); await Slots(); await Emit("StorageResult", new { success = true, uniqueID = deposit.ID }); }
                    pendingStorage = null; break;
                case Messages.SM_TAKEBACKSTORAGEITEM_OK:
                    storedItems.Remove(h.Recog); pendingStorage = null;
                    await Emit("NPCStorageList", new { objectID = npcID, list = storedItems.Values });
                    await Emit("StorageResult", new { success = true, uniqueID = h.Recog }); break;
                case Messages.SM_STORAGE_FULL: case Messages.SM_STORAGE_FAIL: case Messages.SM_TAKEBACKSTORAGEITEM_FAIL: case Messages.SM_TAKEBACKSTORAGEITEM_FULLBAG:
                    pendingStorage = null;
                    await Emit("StorageResult", new { success = false, message = h.Ident == Messages.SM_STORAGE_FULL ? "仓库已满" : h.Ident == Messages.SM_TAKEBACKSTORAGEITEM_FULLBAG ? "背包已满" : "存取失败，请检查负重并回到仓库保管员身边" }); break;
                case Messages.SM_USERSELLITEM_OK:
                    Remove(pendingSell); pendingSell = 0; gold = h.Recog;
                    await Slots(); await Emit("UserGold", new { gold }); break;
                case Messages.SM_USERSELLITEM_FAIL: pendingSell = 0; await Emit("TransactionFailed", new { message = "商人不收这件物品" }); break;
                case Messages.SM_BUYITEM_SUCCESS: gold = h.Recog; await Emit("UserGold", new { gold }); break;
                case Messages.SM_BUYITEM_FAIL: await Emit("TransactionFailed", new { message = "购买失败，请检查金币和背包" }); break;
                case Messages.SM_DURACHANGE:
                    var durabilitySlot = BrowserSlot(h.Param);
                    if (durabilitySlot is >= 0 and < 14 && equipment[durabilitySlot] is Dictionary<string, object?> wornItem) { wornItem["durability"] = h.Recog; wornItem["maxDurability"] = h.Tag; await Slots(); }
                    break;
                case Messages.SM_FEATURECHANGED:
                    if (objects.TryGetValue(h.Recog, out var changedActor)) { var feature = h.Param | (h.Tag << 16); changedActor["armour"] = ((feature >> 24) & 255) / 2; changedActor["weapon"] = ((feature >> 8) & 255) / 2; await Emit(changedActor["kind"]?.ToString() == "npc" ? "ObjectNPC" : changedActor["kind"]?.ToString() == "player" ? "ObjectPlayer" : "ObjectMonster", changedActor); }
                    break;
                case Messages.SM_SENDMYMAGIC: case Messages.SM_ADDMAGIC:
                    if (h.Ident == Messages.SM_SENDMYMAGIC) learnedMagics.Clear();
                    foreach (var encoded in body.Split('/', StringSplitOptions.RemoveEmptyEntries)) { using var reader = LegacyProjection.Reader(encoded); var key = reader.ReadByte(); var level = reader.ReadByte(); reader.ReadBytes(2); var training = reader.ReadInt32(); var spell = reader.ReadUInt16(); var name = reader.ReadPascalString(14); var effectType = reader.ReadByte(); var effect = reader.ReadByte(); reader.ReadByte(); var cost = reader.ReadUInt16(); learnedMagics[spell] = new { key, level, training, spell, name, effectType, effect, baseCost = cost, levelCost = 0 }; }
                    await Emit("UserMagics", new { magics = learnedMagics.Values }); break;
                case Messages.SM_DELMAGIC: learnedMagics.Remove(h.Recog); await Emit("UserMagics", new { magics = learnedMagics.Values }); break;
                case Messages.SM_MAGIC_LVEXP: await Emit("MagicLeveled", new { spell = h.Recog, level = h.Param, training = h.Tag | (h.Series << 16) }); break;
                case Messages.SM_SPELL: await Emit("ObjectMagic", new { objectID = h.Recog, effect = h.Series, location = new { x = h.Param, y = h.Tag } }); break;
                case Messages.SM_MAGICFIRE:
                    using (var reader = LegacyProjection.Reader(body)) await Emit("MagicEffect", new { objectID = h.Recog, targetID = reader.ReadInt32(), effect = (h.Series >> 8) & 255, effectType = h.Series & 255, location = new { x = h.Param, y = h.Tag } });
                    break;
                case Messages.SM_BUTCH: await Emit("ObjectHarvest", new { objectID = h.Recog, direction = h.Series & 255 }); break;
            }
        }
    }

    private async Task<Dictionary<string, object?>> Item(string encoded)
    {
        var item = LegacyProjection.Item(encoded); var id = Convert.ToInt32(item["uniqueID"]); itemInfos[id] = item;
        await Emit("NewItemInfo", new { info = item.Append(new KeyValuePair<string, object?>("index", id)).ToDictionary(pair => pair.Key, pair => pair.Value) });
        return item;
    }
    private Task Slots() => Emit("UserSlotsRefresh", new { inventory, equipment });
    private int InventorySlot(Dictionary<string, object?> item)
    {
        if (Convert.ToInt32(item["stdMode"]) <= 3)
        {
            for (var i = 0; i < 6; i++) if (inventory[i] == null) return i;
        }
        for (var i = 6; i < inventory.Length; i++) if (inventory[i] == null) return i;
        return -1;
    }
    private void Remove(int id) { var index = Array.FindIndex(inventory, item => item is Dictionary<string, object?> values && Convert.ToInt32(values["uniqueID"]) == id); if (index >= 0) inventory[index] = null; }
    private static int NativeSlot(int slot) => slot switch { 0 => 1, 1 => 0, 2 => 4, 4 => 3, 5 => 5, 6 => 6, 7 => 7, 8 => 8, _ => slot };
    private static int BrowserSlot(int slot) => slot switch { 0 => 1, 1 => 0, 3 => 4, 4 => 2, _ => slot };

    private async Task Actor(CommandMessage h, string body)
    {
        if (!objects.TryGetValue(h.Recog, out var actor))
        {
            if (body.Length < 6) return;
            using var reader = LegacyProjection.Reader(body); var feature = reader.ReadInt32(); var race = feature & 255; var image = (feature >> 16) & 65535;
            var kind = race == 0 ? "player" : race == 50 ? "npc" : "monster";
            actor = new() { ["objectID"] = h.Recog, ["kind"] = kind, ["name"] = "", ["image"] = image, ["gender"] = (feature >> 24) & 1, ["armour"] = ((feature >> 24) & 255) / 2, ["weapon"] = ((feature >> 8) & 255) / 2 };
            objects[h.Recog] = actor;
            await Send(Messages.CM_QUERYUSERNAME, h.Recog, h.Param, h.Tag);
        }
        actor["location"] = new { x = h.Param, y = h.Tag }; actor["direction"] = h.Series & 255;
        await Emit(actor["kind"]?.ToString() == "npc" ? "ObjectNPC" : actor["kind"]?.ToString() == "player" ? "ObjectPlayer" : "ObjectMonster", actor);
        var action = h.Ident == Messages.SM_WALK ? "ObjectWalk" : h.Ident == Messages.SM_RUN ? "ObjectRun" : h.Ident is Messages.SM_HIT or Messages.SM_HEAVYHIT ? "ObjectAttack" : "ObjectTurn";
        await Emit(action, new { objectID = h.Recog, location = actor["location"], direction = h.Series & 255 });
    }

    public void Dispose() { lifetime.Cancel(); connection.Dispose(); lifetime.Dispose(); }
}

public static class Credentials
{
    public static bool Valid(string account, string password) => account.Length is >= 3 and <= 10 && password.Length is >= 5 and <= 10 && account.All(char.IsAsciiLetterOrDigit) && password.All(char.IsAsciiLetterOrDigit);
    public static bool ValidName(string name) => name.Length >= 3 && Encoding.GetEncoding("gb2312").GetByteCount(name) <= 14 && name.All(character => char.IsAsciiLetterOrDigit(character) || character == '_' || character is >= '\u4e00' and <= '\u9fff');
}
