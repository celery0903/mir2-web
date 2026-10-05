using System.Security.Cryptography;
using System.Text.Json;
using OpenMir2;

Console.WriteLine("OpenMir2 assembly SHA-256: " + Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(typeof(HUtil32).Assembly.Location))).ToLowerInvariant());
var fixtures = new (string Label, string Source, string Token, string Tail)[] {
    ("null", null, "", ""),
    ("empty", "", "", ""),
    ("whitespace", " \t  ", "", ""),
    ("plain", "word 2", "word", "2"),
    ("quoted", "\"fireball\" 2", "fireball", " 2"),
    ("spaces within quotes", "  \t\"fire ball\" \t3", "fire ball", " \t3"),
    ("empty quotes", "\"\"", "", ""),
    ("empty quoted parameter", "\"\" next", "", " next"),
    ("single quote legacy token", "\"", "\"", ""),
    ("unclosed quote legacy token", "\"unfinished", "unfinished", ""),
    ("adjacent quoted tokens", "\"x\"\"y\"", "x", "\"y\""),
    ("Chinese item name", "\"火球术\" 3 60", "火球术", " 3 60"),
    ("Chinese spaced item name", "\"火球 术\"", "火球 术", "")
};
var results = new List<object>();
int passed = 0;
foreach (var fixture in fixtures) for (int overload = 0; overload < 3; overload++) {
    var label = $"{fixture.Label}/overload:{overload}";
    try {
        string token = "previous";
        var tail = overload switch {
            0 => HUtil32.GetValidStrCap(fixture.Source, ref token, ' '),
            1 => HUtil32.GetValidStrCap(fixture.Source, ref token, new char[] { ' ', '\t' }),
            _ => HUtil32.GetValidStrCap(fixture.Source, ref token, new string[] { " ", "\t" })
        };
        if (token != fixture.Token || tail != fixture.Tail) throw new Exception(JsonSerializer.Serialize(new { token, tail, expectedToken = fixture.Token, expectedTail = fixture.Tail }));
        passed++;
        results.Add(new { label, passed = true });
    } catch (Exception error) { results.Add(new { label, passed = false, error = error.Message }); }
}
Console.WriteLine("QUOTE_CHECK_RESULTS=" + JsonSerializer.Serialize(results));
Console.WriteLine($"Quoted-name checks: {passed}/{results.Count}");
Environment.ExitCode = passed == results.Count ? 0 : 1;
