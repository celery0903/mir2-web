using System.Text;
using OpenMir2;
using OpenMir2.Extensions;

public static class LegacyProjection
{
    public static BinaryReader Reader(string value) => new(new MemoryStream(EDCode.DecodeBuffer(value)), Encoding.GetEncoding("gb2312"));

    public static Dictionary<string, object?> Item(string encoded)
    {
        using var reader = Reader(encoded);
        var name = reader.ReadPascalString(14);
        var mode = reader.ReadByte();
        var shape = reader.ReadByte();
        var weight = reader.ReadByte();
        var animation = reader.ReadByte();
        reader.ReadBytes(3);
        var image = reader.ReadUInt16();
        reader.ReadUInt16();
        var ac = reader.ReadUInt16(); var mac = reader.ReadUInt16(); var dc = reader.ReadUInt16(); var mc = reader.ReadUInt16(); var sc = reader.ReadUInt16();
        var need = reader.ReadByte(); var level = reader.ReadByte(); reader.ReadBytes(2);
        var price = reader.ReadInt32(); reader.ReadInt32();
        reader.ReadBytes(52);
        var id = reader.ReadInt32();
        var durability = reader.ReadUInt16(); var maximumDurability = reader.ReadUInt16();
        var type = mode switch { 5 or 6 => 1, 10 or 11 => 2, 15 => 4, 19 or 20 or 21 => 5, 22 or 23 => 7, 24 or 26 => 6, 0 => 13, 3 or 4 => 14, _ => 0 };
        return new() { ["uniqueID"] = id, ["itemIndex"] = id, ["count"] = 1, ["name"] = name, ["stdMode"] = mode, ["shape"] = shape, ["type"] = type, ["image"] = image, ["weight"] = weight, ["price"] = price, ["need"] = need, ["requiredLevel"] = level, ["durability"] = durability, ["maxDurability"] = maximumDurability, ["ac"] = ac, ["mac"] = mac, ["dc"] = dc, ["mc"] = mc, ["sc"] = sc, ["stackSize"] = 1 };
    }

    public static object Ability(string encoded, int gold, int job)
    {
        using var reader = Reader(encoded);
        var level = reader.ReadByte(); reader.ReadByte();
        var ac = reader.ReadUInt16(); var mac = reader.ReadUInt16(); var dc = reader.ReadUInt16(); var mc = reader.ReadUInt16(); var sc = reader.ReadUInt16();
        var hp = reader.ReadUInt16(); var mp = reader.ReadUInt16(); var maxHP = reader.ReadUInt16(); var maxMP = reader.ReadUInt16();
        reader.ReadBytes(4);
        var experience = reader.ReadInt32(); var maxExperience = reader.ReadInt32();
        var weight = reader.ReadUInt16(); var maxWeight = reader.ReadUInt16();
        return new { level, ac, mac, dc, mc, sc, hp, mp, maxHP, maxMP, experience, maxExperience, gold, @class = job, weight, maxWeight };
    }

    public static object Character(string[] fields, int index) => new { index, name = fields[0].TrimStart('*'), @class = int.Parse(fields[1]), hair = int.Parse(fields[2]), level = int.Parse(fields[3]), gender = int.Parse(fields[4]) };
}
