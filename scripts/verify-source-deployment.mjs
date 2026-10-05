import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';

const execute=promisify(execFile);
const url=(process.env.MIR_URL??'http://172.30.0.16:18880').replace(/\/$/,'');
const project=process.env.MIR_PROJECT??'mir2-web';
const destination=process.env.MIR_DEPLOYMENT_REPORT??'docs/correction/source-deployment-evidence.json';
const expectedEngineImage=process.env.MIR_EXPECTED_ENGINE_IMAGE;
const expectedWebImage=process.env.MIR_EXPECTED_WEB_IMAGE;
const expectedProxyImage=process.env.MIR_EXPECTED_PROXY_IMAGE;
const assets=process.env.MIR_SOURCE_ASSETS??'.runtime/source-assets';
const rulesFile=process.env.MIR_MAGIC_RULES_FILE??'shared/classic-magic.json';
assert.match(project,/^[a-z0-9][a-z0-9_-]*$/);
if(expectedEngineImage)assert.match(expectedEngineImage,/^sha256:[a-f0-9]{64}$/);
if(expectedWebImage)assert.match(expectedWebImage,/^sha256:[a-f0-9]{64}$/);
if(expectedProxyImage)assert.match(expectedProxyImage,/^sha256:[a-f0-9]{64}$/);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
let previous;
try{previous=JSON.parse(await readFile(destination,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
const names=['db','engine','web','source-proxy'].map(service=>`${project}-${service}-1`);
const format='{"name":{{json .Name}},"id":{{json .Id}},"image":{{json .Image}},"startedAt":{{json .State.StartedAt}},"restartCount":{{json .RestartCount}},"health":{{json .State.Health.Status}},"labels":{{json .Config.Labels}},"mounts":{{json .Mounts}}}';
const {stdout:inspection}=await execute('docker',['inspect',...names,'--format',format]);
const containers=inspection.trim().split('\n').map(line=>JSON.parse(line));
for(const container of containers)assert.equal(container.health,'healthy',`${container.name} health`);
if(expectedWebImage)assert.equal(containers.find(container=>container.name===`/${names[2]}`).image,expectedWebImage,'Web does not match the declared tested image');
if(expectedProxyImage)assert.equal(containers.find(container=>container.name===`/${names[3]}`).image,expectedProxyImage,'Proxy does not match the declared tested image');
const nativeContainers=containers.filter(container=>names.slice(0,2).includes(container.name.slice(1)));
const hasPriorSnapshot=nativeContainers.every(container=>previous?.containers?.some(value=>value.name===container.name));
const preservedInstance=container=>{
 const prior=previous?.containers?.find(value=>value.name===container.name);
 return prior?container.id===prior.id&&container.startedAt===prior.startedAt:null;
};
const database=nativeContainers.find(container=>container.name===`/${names[0]}`),engine=nativeContainers.find(container=>container.name===`/${names[1]}`);
const preservedDatabase=preservedInstance(database),preservedEngine=preservedInstance(engine);
const preservedSourceProxy=preservedInstance(containers.find(container=>container.name===`/${names[3]}`));
const preservedNativeContainers=hasPriorSnapshot?preservedDatabase&&preservedEngine:null;
const storageMounts=container=>container.mounts.filter(mount=>mount.Type==='volume').map(({Name,Destination})=>({Name,Destination})).sort((a,b)=>a.Destination.localeCompare(b.Destination));
const priorEngine=previous?.containers?.find(container=>container.name===engine.name);
const preservedEngineStorage=priorEngine?JSON.stringify(storageMounts(engine))===JSON.stringify(storageMounts(priorEngine)):null;
if(expectedEngineImage)assert.equal(engine.image,expectedEngineImage,'Engine does not match the declared tested image');
if(hasPriorSnapshot){
 assert.equal(preservedDatabase,true,'Database instance changed');
 if(!preservedEngine){
  assert.ok(expectedEngineImage,'Engine changed without a declared tested image');
  assert.ok(storageMounts(engine).length>0,'Engine has no persistent storage');
  assert.equal(preservedEngineStorage,true,'Engine storage volumes changed');
 }
}
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
const resourceFiles=[];
async function verifyResource(path){
 const expected=await readFile(join(assets,path));
 const response=await fetch(`${url}/${path}`,{signal:AbortSignal.timeout(15000)});
 assert.equal(response.status,200,path);
 const bytes=Buffer.from(await response.arrayBuffer()),sha256=digest(bytes);
 assert.equal(sha256,digest(expected),path);
 resourceFiles.push({path,sha256,bytes:bytes.length,matchesPreparedAssets:true});
 return expected;
}
const integrationBytes=await readFile(join(assets,'integration.json'));
const {stdout:integrationHash}=await execute('docker',['exec',names[2],'sha256sum','/usr/share/nginx/resources/integration.json']);
assert.equal(integrationHash.trim().split(/\s+/)[0],digest(integrationBytes),'Mounted integration manifest');
const integration=JSON.parse(integrationBytes);
let hasMapCatalog=false;
try{await readFile(join(assets,'maps/catalog.json'));hasMapCatalog=true;}catch(error){if(error.code!=='ENOENT')throw error;}
if(hasMapCatalog){
 const catalog=JSON.parse(await verifyResource('maps/catalog.json'));
 assert.deepEqual(catalog.map(map=>map.id),integration.maps.map(map=>map.id),'Map catalog differs from the prepared profile');
 for(const map of catalog){
  const entry=integration.maps.find(entry=>entry.id===map.id);
  for(const field of ['sourceSha256','width','height'])assert.equal(map[field],entry[field],`Map catalog ${map.id}/${field}`);
 }
}
const libraryNames=new Set(['Tiles','SmTiles','Objects']);
for(const map of integration.maps){
 assert.match(map.id,/^[A-Za-z0-9]+$/);
 const manifest=JSON.parse(await verifyResource(`maps/${map.id}/map.json`));
 assert.equal(manifest.sourceSha256,map.sourceSha256);
 for(const name of Object.values(manifest.objectLibraries??{}))libraryNames.add(name);
 for(const chunk of manifest.chunks){
  assert.match(chunk.file,/^[A-Za-z0-9_.-]+$/);
  await verifyResource(`maps/${map.id}/${chunk.file}`);
 }
 if(manifest.auxiliaryTail){
  assert.match(manifest.auxiliaryTail.file,/^[A-Za-z0-9_.-]+$/);
  const bytes=await verifyResource(`maps/${map.id}/${manifest.auxiliaryTail.file}`);
  assert.equal(bytes.length,manifest.auxiliaryTail.bytes);
  assert.equal(digest(bytes),manifest.auxiliaryTail.sha256);
 }
}
const mapFrameRequests=[];
for(const name of libraryNames){
 assert.match(name,/^[A-Za-z0-9]+$/);
 const manifest=JSON.parse(await verifyResource(`libraries/${name}/library.json`));
 for(const frame of Object.values(manifest.frames))for(const layer of [frame,frame.mask]){
  if(!layer)continue;
  assert.match(layer.file,/^[A-Za-z0-9_.-]+\.png$/);
  mapFrameRequests.push({path:`libraries/${name}/${layer.file}`,sha256:layer.sha256});
 }
}
let nextMapFrame=0;
await Promise.all(Array.from({length:4},async()=>{
 while(nextMapFrame<mapFrameRequests.length){
  const frame=mapFrameRequests[nextMapFrame++];
  const bytes=await verifyResource(frame.path);
  assert.equal(digest(bytes),frame.sha256,'Map PNG manifest hash');
 }
}));
const magicIntegration=JSON.parse(await verifyResource('effects/integration.json'));
const minimapManifest=JSON.parse(await verifyResource('ui-national/mmap/library.json'));
if(minimapManifest.format==='wil-classic'){
 const archive=JSON.parse(await readFile('shared/archived-176-client.lock.json'));
 assert.equal(minimapManifest.sourceSha256,archive.clientFiles.find(file=>file.file==='DATA/mmap.wil').sha256);
 assert.equal(minimapManifest.indexSha256,archive.clientFiles.find(file=>file.file==='DATA/mmap.WIX').sha256);
}
for(const frame of Object.values(minimapManifest.frames)){
 assert.match(frame.file,/^[A-Za-z0-9_.-]+\.png$/);
 assert.equal(digest(await verifyResource(`ui-national/mmap/${frame.file}`)),frame.sha256,'Minimap PNG manifest hash');
}
const rulesHash=digest(await readFile(rulesFile));
assert.equal(magicIntegration.rulesSha256,rulesHash,'Deployed spell rules');
assert.deepEqual(integration.magicEffects,magicIntegration,'Top-level spell integration');
const effectPins=JSON.parse(await readFile('upstream/mir2-client/content/classic-176/asset-sources.json')).effectFiles;
for(const entry of magicIntegration.libraries){
 assert.ok(['Magic','Magic2'].includes(entry.library),'Unexpected effect library');
 const pin=effectPins.find(value=>value.file===`${entry.library}.Lib`);
 assert.ok(pin,'Missing pinned effect library');
 assert.equal(entry.sourceSha256,pin.sha256,'Effect source provenance');
 assert.deepEqual(entry.missing,[]);assert.deepEqual(entry.empty,[]);
 const manifest=JSON.parse(await verifyResource(`effects/${entry.library}/library.json`));
 assert.equal(manifest.sourceSha256,pin.sha256);
 assert.equal(Object.keys(manifest.frames).length,entry.frames);
 for(const frame of Object.values(manifest.frames)){
  assert.match(frame.file,/^[A-Za-z0-9_.-]+\.png$/);
  const bytes=await verifyResource(`effects/${entry.library}/${frame.file}`);
  assert.equal(digest(bytes),frame.sha256,'Effect PNG manifest hash');
 }
}
const {stdout:mapHashes}=await execute('docker',['exec',names[1],'sha256sum',...integration.maps.map(map=>`/data/server/Mir200/Map/${map.id}.map`)]);
const nativeMapHashes=new Map(mapHashes.trim().split('\n').map(line=>{const [hash,path]=line.trim().split(/\s+/);return [path.split('/').at(-1).replace(/\.map$/,''),hash];}));
for(const map of integration.maps)assert.equal(nativeMapHashes.get(map.id),map.sourceSha256,`Native/browser map mismatch: ${map.id}`);
const bookshopScript='/data/server/Mir200/Envir/Market_Def/比奇城/小书-0132.txt';
const {stdout:bookshopHash}=await execute('docker',['exec',names[1],'sha256sum',bookshopScript]);
const bookshopSha256=bookshopHash.trim().split(/\s+/)[0];
assert.match(bookshopSha256,/^[a-f0-9]{64}$/);
const preservedBookshopScript=previous?.bookshopSha256?previous.bookshopSha256===bookshopSha256:null;
if(previous?.bookshopSha256)assert.equal(preservedBookshopScript,true,'Native bookshop script changed');
const patches=Object.fromEntries(await Promise.all(['server/source-client.patch','server/source-proxy.patch','server/source-tests.patch','server/source-magic.patch','server/source-minimap.patch','server/source-minimap-proxy.patch','server/source-npc-receipt.patch','server/openmir2-linux.patch','server/openmir2-status.patch','server/openmir2-safezone.patch','server/openmir2-script.patch'].map(async file=>[file,digest(await readFile(file))])));
const {stdout:revision}=await execute('git',['-C','upstream/mir2-client','rev-parse','HEAD']);
const engineReplacement=hasPriorSnapshot&&!preservedEngine?{previousId:priorEngine.id,previousImage:priorEngine.image,expectedImage:expectedEngineImage,matchesTestedImage:true,storagePreserved:preservedEngineStorage}:undefined;
resourceFiles.sort((a,b)=>a.path.localeCompare(b.path));
const report={checkedAt:new Date().toISOString(),url,clientSource:'leiniaozl229/mir2',revision:revision.trim(),containers,files,resourceFiles,mapPngsVerified:mapFrameRequests.length,mapCatalogVerified:hasMapCatalog,nativeMapsMatchPreparedAssets:true,mapResourceAcceptance:integration.mapResourceAcceptance,magicIntegration,minimapFramesVerified:Object.keys(minimapManifest.frames).length,rulesFile,rulesHash,bookshopScript,bookshopSha256,preservedBookshopScript,patches,patchesAreWorktreeHashes:true,expectedWebImage,webMatchesDeclaredTestImage:expectedWebImage?true:null,expectedProxyImage,proxyMatchesDeclaredTestImage:expectedProxyImage?true:null,preservedNativeContainers,preservedDatabase,preservedEngine,preservedEngineStorage,preservedSourceProxy,engineReplacement,full176Acceptance:false};
await writeFile(destination,JSON.stringify(report,null,2)+'\n');
console.log(`Verified ${files.length} served HTML/JS/CSS and ${resourceFiles.length} resource hashes; native/browser maps match; map resource acceptance: ${integration.mapResourceAcceptance}; all services healthy; ${hasPriorSnapshot?(preservedEngine?'native engine and database match the prior snapshot':'database instance and engine storage preserved; engine matches the declared tested image'):'no prior native-container snapshot to compare'}.`);
