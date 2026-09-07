// Isolated gate state tests; this does not accept any terms in a real browser.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync('dist/assets/app.js','utf8');
const start=source.indexOf('  function focusConsent()');
const end=source.indexOf('  function toast(message)',start);
assert.ok(start>=0&&end>start);
function fixture(helpSeen=true){
  const events={},pageEvents={},nodes={},classes=new Set();
  let focused=null;const saved=[];
  function element(id){
    if(!nodes[id])nodes[id]={id,hidden:false,disabled:true,attrs:{},listeners:{},
      focus(){focused=id;},querySelector(){return element('help-close');},contains(target){return target===this||target===nodes['disclaimer-agree']||target===nodes['disclaimer-modal'];},
      setAttribute(key,value){this.attrs[key]=value;},removeAttribute(key){delete this.attrs[key];},
      addEventListener(name,fn){this.listeners[name]=fn;}};
    return nodes[id];
  }
  const context=vm.createContext({$:element,consentAccepted:false,consentReady:false,activeModal:null,returnFocus:null,state:{helpSeen},
    cancelPress(){},updateSize(){},requestAnimationFrame(fn){fn();},persist(){saved.push(JSON.parse(JSON.stringify(context.state)));},
    document:{querySelectorAll(){return [element('help-modal')];},body:{classList:{add(name){classes.add(name);},remove(name){classes.delete(name);}}},addEventListener(name,fn){events[name]=fn;}},
    window:{addEventListener(name,fn){pageEvents[name]=fn;}}});
  const showStart=source.indexOf('  function showModal(id)');
  const showEnd=source.indexOf('  function closeModal(',showStart);
  vm.runInContext(source.slice(start,end)+source.slice(showStart,showEnd)+'\nbindConsentGate();',context);
  return {context,events,pageEvents,nodes,classes,saved,focused:()=>focused};
}
function event(key,target){return {key,target,prevented:false,stopped:false,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}};}
const gate=fixture();
assert.equal(gate.context.consentAccepted,false);
assert.ok(gate.classes.has('consent-pending'));
assert.equal(gate.nodes.app.attrs['aria-hidden'],'true');
assert.equal(gate.nodes['disclaimer-layer'].hidden,false);
gate.nodes['disclaimer-agree'].listeners.click();
assert.equal(gate.context.consentAccepted,false,'Not ready must not permit entry');
for(const key of ['Escape','Tab']){
  const e=event(key,gate.nodes['disclaimer-modal']);gate.events.keydown(e);
  assert.ok(e.prevented&&e.stopped);assert.equal(gate.context.consentAccepted,false);
}
const outside=event(null,{id:'export-button'});gate.events.click(outside);
assert.ok(outside.prevented&&outside.stopped);
gate.events.click(event(null,gate.nodes['disclaimer-layer']));
assert.equal(gate.context.consentAccepted,false,'Backdrop click must not dismiss');
gate.context.consentReady=true;
gate.nodes['disclaimer-agree'].listeners.click();
assert.equal(gate.context.consentAccepted,true);
assert.equal(gate.nodes['disclaimer-layer'].hidden,true);
assert.ok(!gate.classes.has('consent-pending'));
assert.equal(gate.nodes.app.attrs['aria-hidden'],undefined);
assert.equal(gate.focused(),'footer-add');
gate.pageEvents.pageshow({persisted:false});assert.equal(gate.context.consentAccepted,true);
gate.pageEvents.pageshow({persisted:true});assert.equal(gate.context.consentAccepted,false);
assert.equal(gate.nodes['disclaimer-layer'].hidden,false);
assert.equal(fixture().context.consentAccepted,false,'A new page must ask again');
const html=fs.readFileSync('dist/index.html','utf8');
assert.match(html,/<body class="consent-pending">/);
const disclaimer=html.slice(html.indexOf('<div id="disclaimer-layer"'),html.indexOf('<input id="file-input"'));
assert.ok(!/data-close|取消|跳过/.test(disclaimer));
assert.equal((disclaimer.match(/<button\b/g)||[]).length,1);
assert.match(disclaimer,/同意并继续使用/);
const first=fixture(false);
first.context.consentReady=true;first.nodes['disclaimer-agree'].listeners.click();
assert.equal(first.context.activeModal,'help-modal');
assert.equal(first.context.state.helpSeen,true);assert.equal(first.saved.length,1);
assert.equal(first.saved[0].helpSeen,true);
first.context.activeModal=null;
first.pageEvents.pageshow({persisted:true});first.nodes['disclaimer-agree'].listeners.click();
assert.equal(first.context.activeModal,null,'Help must not reopen after being shown');
const returning=fixture(first.saved[0].helpSeen);
returning.context.consentReady=true;returning.nodes['disclaimer-agree'].listeners.click();
assert.equal(returning.context.activeModal,null,'Help flag survives a new page');
const manual=fixture(false);manual.context.consentAccepted=true;
manual.context.showModal('help-modal');assert.equal(manual.saved[0].helpSeen,true);
const clearing=vm.createContext({consentAccepted:true,
  state:{title:'保留昵称',avatars:{left:{src:'left.png'},right:{src:'right.png'}},helpSeen:true,messages:[{type:'text',text:'test'},{type:'recall'}]},
  pictureCache:new Map([['photo',{}]]),persist(){clearing.snapshot=JSON.parse(JSON.stringify(clearing.state));},closeModal(){},rebuild(){},toast(){}
});
const clearStart=source.indexOf('  function clearConversation()');
vm.runInContext(source.slice(clearStart,source.indexOf('  function bind()',clearStart)),clearing);
clearing.clearConversation();
assert.equal(clearing.snapshot.messages.length,0);assert.equal(clearing.state.messages.length,0);assert.equal(clearing.pictureCache.size,0);
assert.equal(clearing.state.title,'保留昵称');assert.equal(clearing.state.avatars.left.src,'left.png');
assert.equal(clearing.state.helpSeen,true);
assert.match(html,/<button id="clear-conversation" class="button danger-button"/);
assert.ok(!/resetUndo|reset-example/.test(source));
console.log('PASS: one-time help, persisted help flag, manual help, clear only messages.');
console.log('PASS: initial lock, loading guard, Escape/Tab/backdrop blocking, acceptance transition, BFCache return, fresh-page consent.');
