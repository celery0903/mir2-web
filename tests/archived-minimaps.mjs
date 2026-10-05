import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {PNG} from 'pngjs';

const assets=process.env.MIR_MINIMAP_ASSETS??'.runtime/source-assets';
const source=process.env.MIR_ARCHIVED_CLIENT??'.runtime/original-client-research/extracted/App_Executables';
const destination=process.env.MIR_MINIMAP_PIXEL_REPORT??'.runtime/reports/archived-minimaps';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const lock=JSON.parse(await readFile('shared/archived-176-client.lock.json'));
for(const pin of lock.clientFiles){
 const raw=await readFile(join(source,pin.file));assert.equal(raw.length,pin.bytes);assert.equal(digest(raw),pin.sha256);
}
const wil=await readFile(join(source,'DATA/mmap.wil')),wix=await readFile(join(source,'DATA/mmap.WIX'));
assert.ok(wil.subarray(0,11).equals(Buffer.from('#ILIB v1.0-')));
assert.equal(wil.readInt32LE(48),256);
const directory=join(assets,'ui-national/mmap'),manifest=JSON.parse(await readFile(join(directory,'library.json')));
assert.equal(manifest.sourceSha256,digest(wil));assert.equal(manifest.indexSha256,digest(wix));
assert.equal(manifest.sourceFrameCount,189);assert.equal(Object.keys(manifest.frames).length,189);
const frames=[];
for(let index=0;index<189;index++){
 const offset=wix.readInt32LE(48+index*4),width=wil.readInt16LE(offset),height=wil.readInt16LE(offset+2);
 const offsetX=wil.readInt16LE(offset+4),offsetY=wil.readInt16LE(offset+6),frame=manifest.frames[index];
 assert.ok(offset>=1080&&offset+8+width*height<=wil.length);
 assert.deepEqual([frame.index,frame.width,frame.height,frame.offsetX,frame.offsetY],[index,width,height,offsetX,offsetY]);
 const encoded=await readFile(join(directory,frame.file));assert.equal(digest(encoded),frame.sha256);
 const png=PNG.sync.read(encoded);assert.equal(png.width,width);assert.equal(png.height,height);
 // Independently compare each exported RGBA pixel with the bottom-up indexed WIL bytes.
 const expected=Buffer.alloc(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const color=wil[offset+8+(height-1-y)*width+x],at=(y*width+x)*4,palette=56+color*4;
  if(color){expected[at]=wil[palette+2];expected[at+1]=wil[palette+1];expected[at+2]=wil[palette];expected[at+3]=255;}
 }
 assert.ok(png.data.equals(expected),`Original minimap pixels differ: ${index}`);
 frames.push({index,width,height,offsetX,offsetY,pixelsMatch:true,pixelSha256:digest(expected),pngSha256:frame.sha256});
}
await mkdir(destination,{recursive:true});
await writeFile(join(destination,'evidence.json'),JSON.stringify({checkedAt:new Date().toISOString(),archive:lock.archive,
 installerSha256:lock.installer.sha256,sourceSha256:digest(wil),indexSha256:digest(wix),passed:true,
 all189FramesCompared:true,frames,authenticated2003Client:false,full176Acceptance:false},null,2)+'\n');
console.log('All 189 original minimap frames match raw indexed pixels, dimensions and signed offsets.');
