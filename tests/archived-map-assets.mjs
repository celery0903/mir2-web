import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {PNG} from 'pngjs';

const assets=process.env.MIR_SOURCE_ASSETS??'.runtime/source-assets';
const source=process.env.MIR_ARCHIVED_CLIENT??'.runtime/original-client-research/extracted/App_Executables';
const destination=process.env.MIR_ARCHIVED_MAP_REPORT??'.runtime/reports/archived-map-assets';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=async file=>JSON.parse(await readFile(file));
const lock=await json('shared/archived-176-client.lock.json');
const world=await json(join(assets,'native-world.json'));
const references=new Map();
for(const map of world.maps){
 const manifest=await json(join(assets,'maps',map.id,'map.json'));
 for(const [name,indices] of Object.entries(manifest.dependencies)){
  const refs=references.get(name)??new Set();
  for(const index of indices)refs.add(index);
  references.set(name,refs);
 }
}
const libraries=[];
let framesChecked=0,pixelsChecked=0;
for(const entry of lock.mapLibraries){
 const library=world.libraries.find(library=>library.name===entry.library);
 if(!library)continue;
 const wil=await readFile(join(source,entry.file)),wix=await readFile(join(source,entry.index));
 for(const [file,raw] of [[entry.file,wil],[entry.index,wix]]){
  const pin=lock.clientFiles.find(pin=>pin.file===file);
  assert.equal(raw.length,pin.bytes);assert.equal(digest(raw),pin.sha256);
 }
 assert.ok(wil.subarray(0,11).equals(Buffer.from('#ILIB v1.0-')));
 assert.equal(wil.readInt32LE(48),256);
 assert.equal((wix.length-48)%4,0);
 const count=(wix.length-48)/4,directory=join(assets,'libraries',entry.library);
 const manifest=await json(join(directory,'library.json'));
 assert.equal(manifest.format,'wil-classic');assert.equal(manifest.sourceFrameCount,count);
 assert.equal(manifest.sourceSha256,digest(wil));assert.equal(library.sourceSha256,digest(wil));
 assert.equal(manifest.indexSha256,digest(wix));assert.equal(manifest.installerSha256,lock.installer.sha256);
 const frames=[],empty=manifest.empty,missing=manifest.missing;
 const indices=[...Object.keys(manifest.frames).map(Number),...empty,...missing];
 assert.equal(new Set(indices).size,indices.length,'Frame categories overlap');
 assert.deepEqual(new Set(indices),references.get(entry.library),'Exported indices differ from native map dependencies');
 for(const index of indices){
  if(missing.includes(index)){assert.ok(index>=count);continue;}
  assert.ok(index>=0&&index<count);
  const offset=wix.readInt32LE(48+index*4);
  if(!offset){assert.ok(empty.includes(index));continue;}
  assert.ok(offset>=1080&&offset+8<=wil.length);
  const width=wil.readInt16LE(offset),height=wil.readInt16LE(offset+2);
  if(!width||!height){assert.ok(empty.includes(index));continue;}
  assert.ok(width>0&&height>0&&offset+8+width*height<=wil.length);
  const end=index+1<count?wix.readInt32LE(48+(index+1)*4):wil.length;
  assert.equal(end-offset-8,width*height,'Unexpected WIL scanline padding or frame payload');
  const frame=manifest.frames[index],offsetX=wil.readInt16LE(offset+4),offsetY=wil.readInt16LE(offset+6);
  assert.deepEqual([frame.index,frame.width,frame.height,frame.offsetX,frame.offsetY],[index,width,height,offsetX,offsetY]);
  const encoded=await readFile(join(directory,frame.file)),png=PNG.sync.read(encoded);
  assert.equal(digest(encoded),frame.sha256);assert.equal(png.width,width);assert.equal(png.height,height);
  // Decode raw bottom-up palette indices independently of the Python WIL exporter.
  const expected=Buffer.alloc(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   const color=wil[offset+8+(height-1-y)*width+x],at=(y*width+x)*4,palette=56+color*4;
   if(color){expected[at]=wil[palette+2];expected[at+1]=wil[palette+1];expected[at+2]=wil[palette];expected[at+3]=255;}
  }
  assert.ok(png.data.equals(expected),`${entry.library}:${index} pixels differ from the archived WIL`);
  frames.push({index,width,height,offsetX,offsetY,pngSha256:frame.sha256,pixelSha256:digest(expected)});
  framesChecked++;pixelsChecked+=width*height;
 }
 libraries.push({name:entry.library,sourceFile:entry.file,sourceSha256:digest(wil),indexSha256:digest(wix),
  sourceFrameCount:count,compactRowsVerified:true,allReferencedFramesCompared:true,frames,empty,missing});
}
assert.equal(libraries.length,lock.mapLibraries.length,'Not all archived map libraries were imported');
await mkdir(destination,{recursive:true});
await writeFile(join(destination,'evidence.json'),JSON.stringify({checkedAt:new Date().toISOString(),archive:lock.archive,
 installerSha256:lock.installer.sha256,passed:true,framesChecked,pixelsChecked,libraries,
 mapResourceAcceptance:world.mapResourceAcceptance,authenticated2003Client:false,full176Acceptance:false},null,2)+'\n');
console.log(`${framesChecked} referenced frames and ${pixelsChecked} RGBA pixels match the archived map WIL files; world resources: ${world.mapResourceAcceptance}.`);
