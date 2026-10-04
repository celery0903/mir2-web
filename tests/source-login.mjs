import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import WebSocket from 'ws';

const base=(process.env.MIR_URL??'http://127.0.0.1:18883').replace(/\/$/,'');
const destination=process.env.MIR_LOGIN_REPORT??'.runtime/reports/source-login';
await mkdir(destination,{recursive:true});
const report={checkedAt:new Date().toISOString(),url:base,passed:false,abortedHandshakes:0,full176Acceptance:false};
const unknownAccount=`n${String(Date.now()).slice(-8)}`;
function login(abortAfterMs){
 return new Promise((resolve,reject)=>{
  const started=Date.now(),socket=new WebSocket(base.replace(/^http/,'ws')+'/ws',{origin:base});
  let response,connected=false,finished=false,abortTimer;
  const finish=(error,value)=>{
   if(finished)return;finished=true;clearTimeout(timeout);clearTimeout(abortTimer);socket.terminate();
   if(error)reject(error);else resolve(value);
  };
  const timeout=setTimeout(()=>finish(new Error('Native login response timed out after disconnected clients')),10000);
  socket.on('message',bytes=>{
   try{
    const {message}=JSON.parse(String(bytes));
    if(message.type==='connected'){
     connected=true;socket.send(JSON.stringify({type:'login',account:unknownAccount,password:'Probe987'}));
     if(abortAfterMs!==undefined)abortTimer=setTimeout(()=>socket.terminate(),abortAfterMs);
    }else if(message.type==='error'){
     response=message;
     if(abortAfterMs===undefined)finish(undefined,{message:message.message,elapsedMs:Date.now()-started});
    }
   }catch(error){finish(error);}
  });
  socket.on('error',error=>{if(!connected)finish(error);});
  socket.on('close',()=>{
   if(abortAfterMs!==undefined&&connected)finish(undefined,{closed:true,responseReceived:!!response});
   else if(!finished)finish(new Error('Login channel closed before its native response'));
  });
 });
}
try{
 const initial=await login();assert.equal(initial.message,'Login rejected (503/0)');report.initial=initial;
 for(let round=0;round<5;round++){
  const attempts=await Promise.all(Array.from({length:10},(_,index)=>login(index%5)));
  report.abortedHandshakes+=attempts.length;
  const next=await login();assert.equal(next.message,'Login rejected (503/0)');
  (report.responseChecks??=[]).push(next);
 }
 report.passed=true;
}catch(error){report.error=String(error);process.exitCode=1;}
await writeFile(`${destination}/evidence.json`,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
