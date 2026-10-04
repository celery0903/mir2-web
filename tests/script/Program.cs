using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using OpenMir2;
using ScriptSystem;
using ScriptSystem.Consts;
using Serilog;
using SystemModule;
using SystemModule.Actors;

Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
LogService.Logger = new LoggerConfiguration().CreateLogger();
Console.WriteLine("Script assembly SHA-256: " + Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(typeof(ScriptParsers).Assembly.Location))).ToLowerInvariant());
var parser = new ScriptParsers();
var actionMethod = typeof(ScriptParsers).GetMethod("LoadScriptFileQuestAction", BindingFlags.Instance | BindingFlags.NonPublic);
var conditionMethod = typeof(ScriptParsers).GetMethod("LoadScriptFileQuestCondition", BindingFlags.Instance | BindingFlags.NonPublic);
QuestActionInfo Action(string text, ExecutionCode expected) {
    object[] args = { text, new QuestActionInfo() };
    if (!(bool)actionMethod.Invoke(parser, args)) throw new Exception("Action rejected: " + text);
    var result = (QuestActionInfo)args[1];
    if (result.nCmdCode != (int)expected) throw new Exception($"Action {text} became {(ExecutionCode)result.nCmdCode}, expected {expected}");
    return result;
}
void Condition(string text, ConditionCode expected) {
    object[] args = { text, new QuestConditionInfo() };
    if (!(bool)conditionMethod.Invoke(parser, args)) throw new Exception("Condition rejected: " + text);
    var result = (QuestConditionInfo)args[1];
    if (result.CmdCode != (int)expected) throw new Exception($"Condition {text} became {(ConditionCode)result.CmdCode}, expected {expected}");
}
var move = Action("mapmove 11 47 477", ExecutionCode.MapMove);
if (move.sParam1 != "11" || move.nParam2 != 47 || move.nParam3 != 477) throw new Exception("Original white-gate coordinates changed");
var first = Action("PKPOINT 2", ExecutionCode.PkPoint);
var second = Action("PKPOINT 3", ExecutionCode.PkPoint);
var stop = Action("BREAK", ExecutionCode.Break);
var afterStop = Action("PKPOINT 100", ExecutionCode.PkPoint);
Action("SET [58] 1", ExecutionCode.Set);
Condition("CHECK [58] 1", ConditionCode.CHECK);
Condition("CHECKLEVEL 7", ConditionCode.CHECKLEVEL);
var player = new M2Server.Player.PlayObject();
var npc = new M2Server.Npc.NormNpc();
var script = new ScriptEngine();
var execute = typeof(ScriptEngine).GetMethod("GotoLableQuestActionProcess", BindingFlags.Instance | BindingFlags.NonPublic);
var parameters = new GotoLabParams();
object[] executeArgs = { npc, player, new List<QuestActionInfo> { first, second, stop, afterStop }, parameters };
execute.Invoke(script, executeArgs);
if (player.PkPoint != 5) throw new Exception($"Registered action sequence and BREAK produced PK={player.PkPoint}, expected 5");
Console.WriteLine("Script checks: original MAPMOVE parameters, action and condition identities, sequential actions and BREAK passed.");
