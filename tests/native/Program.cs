using System.Buffers.Binary;
using System.Text;
using System.Reflection;
using OpenMir2;
using Serilog;
using M2Server;
using M2Server.Maps;
using M2Server.Player;
using M2Server.Net;
using OpenMir2.Packets.ServerPackets;
using SystemModule;
using SystemModule.Data;

Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
LogService.Logger = new LoggerConfiguration().WriteTo.Console().CreateLogger();
SystemShare.Config.EnvirDir = Path.GetTempPath();
void Check(bool condition, string message)
{
    if (!condition) throw new Exception(message);
}

var bytes = new byte[52 + 4 * 4 * 12];
BinaryPrimitives.WriteInt16LittleEndian(bytes, 4);
BinaryPrimitives.WriteInt16LittleEndian(bytes.AsSpan(2), 4);
BinaryPrimitives.WriteUInt16LittleEndian(bytes.AsSpan(52), 0x8000);
bytes[52 + (1 * 4 + 1) * 12 + 6] = 0x81;
var path = Path.Combine(Path.GetTempPath(), Guid.NewGuid() + ".map");
File.WriteAllBytes(path, bytes);
using var map = new Envirnoment { MapName = "checks" };
try
{
    Check(map.LoadMapData(path), "Native map load failed");
    Check(!map.CellValid(0, 0) && map.CellValid(0, 1), "Wall state leaked into another cell");
    Check(map.DoorList.Single().DoorId != 0, "Door must have an identity");
    var first = new MapItem { Name = "金币", Count = 100, OfBaseObject = 1 };
    var second = new MapItem { Name = "金币", Count = 180, OfBaseObject = 1 };
    Check(first.ItemId != 0 && second.ItemId != first.ItemId, "Ground items must have distinct identities");
    Check(map.AddItemToMap(2, 2, first) && map.AddItemToMap(2, 2, second), "Native ground gold insertion failed");
    ref var cell = ref map.GetCellInfo(2, 2, out var valid);
    Check(valid && cell.Count == 1, "Compatible gold must merge into one stack");
    var merged = M2Share.CellObjectMgr.Get<MapItem>(cell.ObjList[0].CellObjId);
    Check(merged.Count == 280 && merged.ItemId == second.ItemId, "Merged gold lost quantity or identity");
    Check(M2Share.CellObjectMgr.Get<MapItem>(first.ItemId).ItemId == 0, "Old gold identity must be removed");
    var otherOwner = new MapItem { Name = "金币", Count = 60, OfBaseObject = 2 };
    Check(map.AddItemToMap(2, 2, otherOwner) && cell.Count == 2, "Different owners must retain separate gold");
    var weapon = new MapItem { Name = "木剑", Count = 1 };
    var gold = new MapItem { Name = "金币", Count = 50 };
    Check(map.AddItemToMap(1, 2, weapon) && map.AddItemToMap(1, 2, gold), "Mixed ground items failed");
    ref var mixed = ref map.GetCellInfo(1, 2, out _);
    Check(mixed.Count == 2 && M2Share.CellObjectMgr.Get<MapItem>(weapon.ItemId).Name == "木剑", "Gold must not merge with a weapon");
    var large = new MapItem { Name = "金币", Count = 1900 };
    var extra = new MapItem { Name = "金币", Count = 200 };
    Check(map.AddItemToMap(3, 3, large) && map.AddItemToMap(3, 3, extra), "Large gold stacks failed");
    ref var capped = ref map.GetCellInfo(3, 3, out _);
    Check(capped.Count == 2, "Gold above the merge cap must remain separate");
    var observer = new ItemObserver();
    observer.Observe(2, 2, merged);
    observer.Observe(1, 2, weapon);
    Check(observer.VisibleItems.Count == 2 && !ReferenceEquals(observer.VisibleItems[0], observer.VisibleItems[1]), "Distinct visible drops must not reuse one record");
    Check(observer.VisibleItems[0].MapItem.ItemId == merged.ItemId && observer.VisibleItems[1].MapItem.ItemId == weapon.ItemId, "Every visible drop must retain its identity");
    observer.Observe(1, 2, weapon);
    Check(observer.VisibleItems.Count == 2, "Repeated visibility scans must not duplicate an item");
    Console.WriteLine("PASS: native wall isolation, door/item identities, gold conservation, ownership, stack cap and multiple visible drops.");
}
finally { File.Delete(path); }

var channel = DispatchProxy.Create<INetChannel, GateCapture>();
M2Share.NetChannel = channel;
var capture = (GateCapture)channel;
var emptyPlayer = new PlayObject { SocketId = 123, SocketIdx = 7, GateIdx = 2 };
emptyPlayer.ClientQueryBagItems();
emptyPlayer.ClientQueryBagItems();
Check(capture.Packets.Count == 2, "Empty bag queries must each receive a native response");
foreach (var (gate, packet) in capture.Packets)
{
    Check(gate == 2 && packet.Length == 32, "Empty inventory must use the normal gate header without a body");
    Check(BinaryPrimitives.ReadInt32LittleEndian(packet.AsSpan(4)) == 123
        && BinaryPrimitives.ReadUInt16LittleEndian(packet.AsSpan(8)) == 7, "Inventory response lost its socket/session routing");
    Check(BinaryPrimitives.ReadInt32LittleEndian(packet.AsSpan(16)) == 12, "Empty inventory command length mismatch");
    Check(BinaryPrimitives.ReadUInt16LittleEndian(packet.AsSpan(24)) == 201
        && BinaryPrimitives.ReadUInt16LittleEndian(packet.AsSpan(30)) == 0, "Empty inventory must be SM_BAGITEMS with a zero item count");
}
Console.WriteLine("PASS: empty inventory sends a routed SM_BAGITEMS response with zero records.");

class ItemObserver : PlayObject
{
    public void Observe(short x, short y, MapItem item) => UpdateVisibleItem(x, y, item);
}

public class GateCapture : DispatchProxy
{
    public readonly List<(int gate, byte[] packet)> Packets = [];
    protected override object Invoke(MethodInfo method, object[] args)
    {
        if (method.Name != nameof(INetChannel.AddGateBuffer)) throw new InvalidOperationException(method.Name);
        Packets.Add(((int)args[0], (byte[])args[1]));
        return null;
    }
}
