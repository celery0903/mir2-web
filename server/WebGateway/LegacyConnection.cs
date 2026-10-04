using System.Net.Sockets;
using System.Text;
using OpenMir2;
using OpenMir2.Packets.ClientPackets;

public sealed class LegacyConnection : IDisposable
{
    private readonly TcpClient client = new() { NoDelay = true };
    private readonly SemaphoreSlim writes = new(1);
    private string pending = "";
    private readonly byte[] buffer = new byte[8192];
    public bool Game { get; private set; }
    public Task Connect(string host, int port, CancellationToken token) => client.ConnectAsync(host, port, token).AsTask();
    public void SetGame() => Game = true;

    public async Task Send(int command, int id = 0, int x = 0, int y = 0, int series = 0, string body = "", CancellationToken token = default)
    {
        await Raw(EDCode.EncodeMessage(Messages.MakeMessage(command, id, x, y, series)) + body, token);
    }

    public async Task Raw(string value, CancellationToken token = default)
    {
        await writes.WaitAsync(token);
        try { await client.GetStream().WriteAsync(Encoding.ASCII.GetBytes("#1" + value + "!"), token); }
        finally { writes.Release(); }
    }

    public async Task<(CommandMessage Header, string Body)> Read(CancellationToken token)
    {
        while (true)
        {
            var start = pending.IndexOf('#');
            var end = start >= 0 ? pending.IndexOf('!', start) : -1;
            if (end >= 0)
            {
                var packet = pending[(start + 1)..end];
                pending = pending[(end + 1)..];
                if (packet.StartsWith('+')) return (new CommandMessage { Ident = ushort.MaxValue }, packet);
                if (packet.Length < Messages.DefBlockSize) continue;
                return (EDCode.DecodePacket(packet[..Messages.DefBlockSize]), packet[Messages.DefBlockSize..]);
            }
            if (pending.Length > 262144) throw new InvalidDataException("Legacy frame exceeded size limit");
            var count = await client.GetStream().ReadAsync(buffer, token);
            if (count == 0) throw new EndOfStreamException("OpenMir2 closed the connection");
            pending += Encoding.ASCII.GetString(buffer, 0, count);
        }
    }

    public void Dispose() { client.Dispose(); }
}
