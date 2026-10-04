import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execute=promisify(execFile);
const url=(process.env.MIR_URL??'http://172.30.0.16:18880').replace(/\/$/,'');
const project=process.env.MIR_PROJECT??'mir2-web';
const destination=process.env.MIR_DEPLOYMENT_REPORT??'docs/correction/source-deployment-evidence.json';
assert.match(project,/^[a-z0-9][a-z0-9_-]*$/);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
let previous;
try{previous=JSON.parse(await readFile(destination,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
const names=['db','engine','web','source-proxy'].map(service=>`${project}-${service}-1`);
const format='{"name":{{json .Name}},"id":{{json .Id}},"image":{{json .Image}},"startedAt":{{json .State.StartedAt}},"restartCount":{{json .RestartCount}},"health":{{json .State.Health.Status}},"labels":{{json .Config.Labels}},"mounts":{{json .Mounts}}}';
const {stdout:inspection}=await execute('docker',['inspect',...names,'--format',format]);
const containers=inspection.trim().split('\n').map(line=>JSON.parse(line));
for(const container of containers)assert.equal(container.health,'healthy',`${container.name} health`);
const nativeContainers=containers.filter(container=>names.slice(0,2).includes(container.name.slice(1)));
const hasPriorSnapshot=nativeContainers.every(container=>previous?.containers?.some(value=>value.name===container.name));
const preservedNativeContainers=hasPriorSnapshot?nativeContainers.every(container=>{
 const prior=previous?.containers?.find(value=>value.name===container.name);
 return container.id===prior.id&&container.startedAt===prior.startedAt;
}):null;
if(hasPriorSnapshot)assert.equal(preservedNativeContainers,true,'Native engine/database instances changed');
const {stdout:listing}=await execute('docker',['exec',names[2],'find','/usr/share/nginx/html','-type','f']);
const paths=listing.trim().split('\n').filter(file=>/\.(html|js|css)$/.test(file));
assert.ok(paths.length>20,'Incomplete frontend image');
const {stdout:hashes}=await execute('docker',['exec',names[2],'sha256sum',...paths]);
const imageHashes=new Map(hashes.trim().split('\n').map(line=>{const match=/^([a-f0-9]{64})\s+(.+)$/.exec(line);assert.ok(match);return [match[2],match[1]];}));
const requests=[{path:'/',file:'/usr/share/nginx/html/play.html'},...paths.map(file=>({path:file.slice('/usr/share/nginx/html'.length),file}))];
const files=await Promise.all(requests.map(async({path,file})=>{
 const response=await fetch(url+path,{signal:AbortSignal.timeout(15000)});assert.equal(response.status,200,path);
 const sha256=digest(Buffer.from(await response.arrayBuffer()));assert.equal(sha256,imageHashes.get(file),path);
 return {path,sha256,matchesDeployedImage:true};
}));
const patches=Object.fromEntries(await Promise.all(['server/source-client.patch','server/source-proxy.patch','server/source-tests.patch'].map(async file=>[file,digest(await readFile(file))])));
const {stdout:revision}=await execute('git',['-C','upstream/mir2-client','rev-parse','HEAD']);
const report={checkedAt:new Date().toISOString(),url,clientSource:'leiniaozl229/mir2',revision:revision.trim(),containers,files,patches,preservedNativeContainers,full176Acceptance:false};
await writeFile(destination,JSON.stringify(report,null,2)+'\n');
console.log(`Verified ${files.length} served HTML/JS/CSS hashes; all services healthy; ${hasPriorSnapshot?'native engine and database match the prior snapshot':'no prior native-container snapshot to compare'}.`);
