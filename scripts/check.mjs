import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const root = path.resolve('dist');
const html = fs.readFileSync(path.join(root,'index.html'),'utf8');
assert.match(html,/<!DOCTYPE html>/i);
assert.match(html,/lang="zh-CN"/);
assert.match(html,/viewport-fit=cover/);
assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html),'Inline script');
assert.ok(!/\bon\w+\s*=|type="module"|<base\b|<iframe\b|<object\b|\bdownload\s*[=>]/i.test(html),'Disallowed HTML');
const ids = new Set(Array.from(html.matchAll(/\bid="([^"]+)"/g),m=>m[1]));
const allIds = Array.from(html.matchAll(/\bid="([^"]+)"/g),m=>m[1]);
assert.equal(ids.size,allIds.length,'Duplicate DOM IDs');
for (const match of html.matchAll(/(?:src|href)="(\.\/[^"#]+)"/g)) assert.ok(fs.existsSync(path.resolve(root,match[1])),`Missing resource: ${match[1]}`);
const forbidden = /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|RTCPeerConnection|\bWorker\s*\(|SharedWorker|navigator\.(clipboard|geolocation|bluetooth|usb|hid|serial|connection|credentials|locks)|execCommand|requestFullscreen|WebAssembly|\beval\s*\(|new\s+Function|window\.(open|prompt)\s*\(|type\s*=\s*["']module|https?:\/\//;
for (const name of ['app.js','renderer.js','avatars.js']) {
  const source = fs.readFileSync(path.join(root,'assets',name),'utf8');
  new vm.Script(source,{filename:name});
  assert.ok(!forbidden.test(source),`Forbidden capability in ${name}`);
  assert.ok(!/\?\.|\?\?|\b(import|export)\s|\.replaceAll\s*\(|structuredClone|Object\.hasOwn|\.at\s*\(/.test(source),`Non-baseline API in ${name}`);
  for (const match of source.matchAll(/\$\('([^']+)'\)/g)) assert.ok(ids.has(match[1]),`Missing DOM ID: ${match[1]}`);
}
const presetScope={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(root,'assets/avatars.js'),'utf8'),presetScope);
const presets=presetScope.window.ChatAvatarPresets;
assert.equal(presets.length,20,'Expected 20 quick avatars');
assert.equal(new Set(presets.map(p=>p.id)).size,20,'Duplicate avatar IDs');
for(const preset of presets){
  assert.ok(preset.src.startsWith('./assets/avatars/'),'Avatar must be local');
  const data=fs.readFileSync(path.resolve(root,preset.src));
  assert.equal(data.subarray(1,4).toString(),'PNG','Invalid avatar PNG');
  assert.equal(data.readUInt32BE(16),256);assert.equal(data.readUInt32BE(20),256);
}
const source = fs.readFileSync(path.join(root,'assets/renderer.js'),'utf8');
const fakeContext = {measureText:text=>({width:Array.from(text).length*20})};
const sandbox = {window:{},document:{createElement:()=>({getContext:()=>fakeContext})}};
vm.runInNewContext(source,sandbox);
const renderer = sandbox.window.ChatRenderer;
assert.equal(renderer.timeText({date:'2026-08-31',time:'19:46',format:'weekday'}),'周一 19:46');
assert.equal(renderer.timeText({date:'2024-02-29',time:'00:01',format:'full'}),'2024年2月29日 00:01');
let layout=renderer.layout([{type:'text',text:'第一行\n第二行',side:'right'},{type:'time',date:'2026-09-05',time:'20:00'}]);
assert.equal(layout[0].box.lines.length,2);assert.equal(layout[1].y,layout[0].height);
for (const asset of [{width:200,height:1600},{width:1600,height:200},{width:800,height:800}]) {
  const box=renderer.layout([{type:'image',image:asset}])[0].box;
  assert.ok(box.width<=236&&box.bubbleHeight<=236);
  assert.ok(Math.abs(box.width/box.bubbleHeight-asset.width/asset.height)<.0001,'Image aspect changed');
}
const long=renderer.layout([{type:'text',text:'一'.repeat(2000),side:'left'}])[0];
assert.ok(long.box.lines.every(line=>Array.from(line).length<=14),'Long text exceeds bubble width');
assert.equal(long.box.lines.join('').length,2000,'Long text truncated');
const recalled=renderer.layout([{type:'recall',side:'right'},{type:'recall',side:'left'}],'张三');
assert.equal(recalled[0].height,40);assert.equal(recalled[1].y,40);
const draws=[];
const recallContext={fillRect(){},fillText(text,x,y){draws.push({text,x,y,color:this.fillStyle});}};
renderer.row(recallContext,recalled[0],{},{});
assert.equal(draws.map(d=>d.text).join(''),'你撤回了一条消息重新编辑');
assert.equal(draws.filter(d=>d.color==='#576b95').map(d=>d.text).join(''),'重新编辑');
assert.ok(recalled[0].box.links.length>0);assert.equal(recalled[1].box.links.length,0);
const name='很长的聊天昵称'.repeat(5);
const renamed=renderer.layout([{type:'recall',side:'left'}],name)[0];
assert.ok(renamed.height>40);
assert.equal(renamed.box.noticeLines.map(line=>line.tokens.map(t=>t.text).join('')).join(''),renderer.recallText({side:'left'},name));
assert.ok(renamed.box.noticeLines.every(line=>line.width<=444));
console.log('PASS: package paths, capability restrictions, script syntax, DOM bindings, date formatting, long-text wrapping, image proportions.');
