import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root=resolve(process.env.MIR_MINIMAP_CLIENT_ROOT??'.runtime/source-minimap-fix2');
const source=ts.transpileModule(await readFile(join(root,'apps/web/src/minimap.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function harness(){
 const imageRequests=[],elements=new Map(),callbacks=[];
 let resolveLibrary;
 const library=new Promise(resolve=>{resolveLibrary=resolve;});
 const context2D=new Proxy({}, {get:()=>()=>{}});
 const canvas={clientWidth:150,clientHeight:100,width:150,height:100,getContext:()=>context2D,addEventListener(){}};
 for(const selector of ['[data-minimap-name]','[data-hud-coords]','[data-minimap-status]','[data-minimap-toggle]'])elements.set(selector,{textContent:'',addEventListener(){},setAttribute(){}});
 elements.set('#mini-map',canvas);
 class Image{
  naturalWidth=900;naturalHeight=600;
  set src(url){imageRequests.push(url);callbacks.push(()=>this.onload());}
 }
 const context={exports:{},require:()=>({minimapFrameByMap:{'0':100,'4':120},minimapName:id=>`legacy ${id}`}),
  fetch:async()=>({ok:true,json:()=>library}),Image,ResizeObserver:class{observe(){}},
  window:{devicePixelRatio:1},requestAnimationFrame:callback=>callback()};
 vm.createContext(context);vm.runInContext(source,context);
 const instance=new context.exports.MiniMapController({dataset:{},setAttribute(){},querySelector:selector=>elements.get(selector)},()=>{});
 return {instance,imageRequests,callbacks,resolveLibrary,settle:()=>new Promise(resolve=>setImmediate(resolve))};
}

test('native failure clears the previous minimap and catalog names override the upstream numbering',async()=>{
 const h=harness();h.resolveLibrary({names:{'0':'Bichon','4':'Fengmo'},frames:{100:{file:'original-100.png'}}});
 const pending=h.instance.setMap('0',700,700,100);await h.settle();h.callbacks.shift()();await pending;
 assert.equal(h.instance.debugState().imageReady,true);
 await h.instance.setMap('4',500,500,null);
 const state=h.instance.debugState();
 assert.equal(state.name,'Fengmo');assert.equal(state.imageReady,false);assert.equal(state.imageUrl,undefined);assert.equal(state.frameIndex,undefined);
 assert.deepEqual(h.imageRequests,['/ui-national/mmap/original-100.png']);
});

test('a delayed library response cannot change the name or native frame of a newer map',async()=>{
 const h=harness();
 const old=h.instance.setMap('1',600,600,101),current=h.instance.setMap('11',500,500,102);
 h.resolveLibrary({names:{'1':'Woma','11':'White Gate'},frames:{101:{file:'101.png'},102:{file:'102.png'}}});
 await h.settle();assert.deepEqual(h.imageRequests,['/ui-national/mmap/102.png']);
 h.callbacks.shift()();await Promise.all([old,current]);
 const state=h.instance.debugState();assert.equal(state.name,'White Gate');assert.equal(state.frameIndex,102);assert.equal(state.imageReady,true);
});

test('a delayed image from the previous map cannot restore its bitmap after a native failure',async()=>{
 const h=harness();h.resolveLibrary({frames:{100:{file:'100.png'}},names:{'0123':'Room'}});
 const old=h.instance.setMap('0',700,700,100);await h.settle();
 await h.instance.setMap('0123',30,30,null);h.callbacks.shift()();await old;
 const state=h.instance.debugState();assert.equal(state.mapId,'0123');assert.equal(state.name,'Room');assert.equal(state.imageReady,false);
});
