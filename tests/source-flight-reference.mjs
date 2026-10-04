import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, join } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const execute = promisify(execFile), destination = resolve(process.env.MIR_FLIGHT_REPORT ?? '.runtime/reports/source-flight-reference');
const rules = JSON.parse(await readFile('shared/classic-magic.json'));
const legacy = resolve(process.env.MIR_LEGACY_SOURCE ?? '.runtime/legacy-source');
async function source(file, hash) {
  const bytes = await readFile(join(legacy, file));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), hash, file);
  return bytes.toString('latin1');
}
const magic = await source(rules.source.file, rules.source.sha256);
const directionEntry = rules.source.references.find(entry => entry.file.endsWith('/ClFunc.pas'));
const directions = await source(directionEntry.file, directionEntry.sha256);
function section(text, start, end) {
  const left = text.indexOf(start), right = text.indexOf(end, left + start.length);
  assert.ok(left >= 0 && right > left, `Missing source section: ${start}`);
  return text.slice(left, right);
}
const direction = section(directions.slice(directions.lastIndexOf('function  GetFlyDirection16 (sx, sy, ttx, tty:')), 'function  GetFlyDirection16 (sx, sy, ttx, tty:', 'function  PrivDir (');
const initialVelocity = section(magic, '   if fireX <> TargetX then tax :=', '   NextEffect := nil;');
const shift = section(magic, 'function  TMagicEff.Shift: Boolean;', 'procedure TMagicEff.GetFlyXY');
const run = section(magic, 'function  TMagicEff.Run: Boolean;', 'procedure TMagicEff.DrawEff');
const groundRun = section(magic, 'function  TBujaukGroundEffect.Run: Boolean;', 'procedure TBujaukGroundEffect.DrawEff');
const cases = [
  { name: 'stationary', from: [288, 619], to: [294, 618], actor: true },
  { name: 'moving', from: [288, 619], to: [294, 618], actor: true, moves: [[204, 295, 618], [408, 296, 619], [612, 295, 621]] },
  { name: 'crossing', from: [288, 619], to: [294, 619], actor: true, moves: [[204, 285, 619]] },
  { name: 'lost-actor', from: [288, 619], to: [294, 618], actor: true, lost: 204 },
  { name: 'talisman', from: [288, 619], to: [296, 619], actor: true, count: 3, moves: [[204, 297, 620]] },
  { name: 'ground', from: [288, 619], to: [292, 621], actor: false, ground: true, count: 3 },
  { name: 'untargeted', from: [288, 619], to: [294, 618], actor: false },
  { name: 'north-wrap', from: [288, 619], to: [288, 609], actor: true, moves: [[102, 287, 609], [204, 288, 608]] },
  { name: 'negative', from: [0, 0], to: [-10, -4], actor: true },
];
for (const entry of cases) {
  let target = entry.to;
  entry.steps = Array.from({ length: 590 }, (_, index) => {
    const time = index * 17;
    target = entry.moves?.find(move => move[0] === time)?.slice(1) ?? target;
    return { time, target: entry.actor && !(entry.lost && time >= entry.lost) ? target : null };
  });
}
const program = `program NativeFlightReference;
{$mode delphi}
uses SysUtils;
type
 TActor=class
  m_nRx,m_nRy,m_nShiftX,m_nShiftY,m_nMagicExplosionSound:Integer;
 end;
 TScene=class
  procedure ScreenXYfromMCXY(x,y:Integer;var sx,sy:Integer);
  procedure CXYfromMouseXY(x,y:Integer;var rx,ry:Integer);
 end;
 TMagicEff=class
  TargetActor,MagOwner:TObject;
  fireX,fireY,FlyX,FlyY,TargetX,TargetY,OldFlyX,OldFlyY,FireMyselfX,FireMyselfY:Integer;
  firedisX,firedisY,newfiredisX,newfiredisY,Dir16,OldDir16,prevdisx,prevdisy,Rx,Ry:Integer;
  start,frame,curframe,ExplosionFrame,NextFrameTime,RepeatTime,light:Integer;
  FlyXf,FlyYf:Real;
  steptime,m_dwFrameTime,m_dwStartTime:LongWord;
  Repetition,FixedEffect:Boolean;
  procedure Init(sx,sy,tx,ty:Integer);
  function Shift:Boolean;
  function Run:Boolean;virtual;
 end;
 TBujaukGroundEffect=class(TMagicEff)
  function Run:Boolean;override;
 end;
const UNITX=48;UNITY=32;
var TickNow:LongWord;g_MySelf,Target:TActor;PlayScene:TScene;Flight:TMagicEff;Alive:Boolean;
function GetTickCount:LongWord;begin Result:=TickNow;end;
function _MAX(a,b:Integer):Integer;begin if a>b then Result:=a else Result:=b;end;
procedure DebugOutStr(const text:string);begin end;
procedure PlaySound(sound:Integer);begin end;
procedure TScene.ScreenXYfromMCXY(x,y:Integer;var sx,sy:Integer);begin sx:=x*UNITX;sy:=y*UNITY;end;
procedure TScene.CXYfromMouseXY(x,y:Integer;var rx,ry:Integer);begin rx:=x div UNITX;ry:=y div UNITY;end;
${direction}
procedure TMagicEff.Init(sx,sy,tx,ty:Integer);
var tax,tay,anitime:Integer;
begin
 TargetX:=tx;TargetY:=ty;fireX:=sx;fireY:=sy;FlyX:=sx;FlyY:=sy;FlyXf:=sx;FlyYf:=sy;
 start:=0;frame:=6;curframe:=0;ExplosionFrame:=10;Repetition:=True;FixedEffect:=False;anitime:=0;MagOwner:=g_MySelf;
${initialVelocity}
 prevdisx:=99999;prevdisy:=99999;
end;
${shift}
${run}
${groundRun}
procedure Emit(caseId,time:Integer);
begin
 if not Alive or Flight.FixedEffect then Exit;
 TickNow:=time;Alive:=Flight.Run;
 Writeln(caseId,',',time,',',Flight.FlyX,',',Flight.FlyY,',',Ord(Flight.FixedEffect),',',Ord(not Alive),',',Flight.Dir16,',',Flight.curframe);
end;
begin
 g_MySelf:=TActor.Create;Target:=TActor.Create;PlayScene:=TScene.Create;
${cases.map((entry, index) => `
 TickNow:=0;Alive:=True;Flight:=${entry.ground ? 'TBujaukGroundEffect' : 'TMagicEff'}.Create;
 Flight.Init(${entry.from[0] * 48},${entry.from[1] * 32},${entry.to[0] * 48},${entry.to[1] * 32});
 Flight.frame:=${entry.count ?? 6};
 ${entry.steps.map(step => `${step.target ? `Flight.TargetActor:=Target;Target.m_nRx:=${step.target[0]};Target.m_nRy:=${step.target[1]};` : 'Flight.TargetActor:=nil;'}Emit(${index},${step.time});`).join('\n')}
 Flight.Free;`).join('\n')}
 PlayScene.Free;Target.Free;g_MySelf.Free;
end.
`;
await mkdir(destination, { recursive: true });
await writeFile(join(destination, 'oracle.pas'), program, 'latin1');
const compiler = await execute('docker', ['run', '--rm', '-v', `${destination}:/test`, 'mir2-flight-reference:tools', '/test/oracle.pas', '-o/test/oracle'], { maxBuffer: 1024 * 1024 });
await writeFile(join(destination, 'compiler.txt'), compiler.stdout + compiler.stderr);
const { stdout } = await execute(join(destination, 'oracle'), [], { maxBuffer: 1024 * 1024 });
await writeFile(join(destination, 'native.csv'), stdout);
const root = resolve(process.env.MIR_MAGIC_CLIENT_ROOT ?? '.runtime/source-magic-fix/client');
const context = { exports: {}, require: () => ({ default: rules }) };
vm.createContext(context);
const browserSource = await readFile(join(root, 'apps/web/src/classic-magic.ts'));
vm.runInContext(ts.transpileModule(browserSource.toString(), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
const pixels = point => ({ x: point[0] * 48, y: point[1] * 32 });
const nativeRows = stdout.trim().split('\n').map(line => line.split(',').map(Number));
const report = { checkedAt: new Date().toISOString(), source: rules.source, passed: false, authenticated2003Client: false, full176Acceptance: false,
  scope: 'Extracted Pascal velocity, Shift, Run, ground Run and direction methods; mocked actors and a static 48-by-32 camera transform. Compares every emitted pixel coordinate, hit, expiry, direction and animation counter. Does not verify graphical rendering or authenticate the 2003 client.',
  programSha256: createHash('sha256').update(Buffer.from(program, 'latin1')).digest('hex'),
  browserSourceSha256: createHash('sha256').update(browserSource).digest('hex'),
  extractedMethodHashes: Object.fromEntries(Object.entries({ direction, initialVelocity, shift, run, groundRun }).map(([name, text]) => [name, createHash('sha256').update(Buffer.from(text, 'latin1')).digest('hex')])),
  cases: [], mismatches: [] };
for (const [index, entry] of cases.entries()) {
  const flight = new context.exports.ProjectileFlight(pixels(entry.from), pixels(entry.to), 0, Boolean(entry.ground), 50);
  const rows = nativeRows.filter(row => row[0] === index);
  for (const row of rows) {
    const step = entry.steps.find(step => step.time === row[1]);
    flight.advance(step.time, step.target ? pixels(step.target) : undefined, entry.count ?? 6);
    const actual = [flight.point.x, flight.point.y, Number(flight.hit), Number(flight.expired), flight.direction, flight.frame];
    const expected = row.slice(2);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) report.mismatches.push({ case: entry.name, time: step.time, actual, expected });
  }
  report.cases.push({ name: entry.name, frames: rows.length, nativeLastTime: rows.at(-1)[1], hit: flight.hit, expired: flight.expired });
}
report.passed = report.mismatches.length === 0;
await writeFile(join(destination, 'evidence.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
assert.equal(report.passed, true, 'The browser flight differs from the extracted Pascal reference');
