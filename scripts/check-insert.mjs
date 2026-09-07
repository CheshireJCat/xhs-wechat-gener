import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync('dist/assets/app.js','utf8');
const section=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
function fixture(){
  const nodes={};
  const $=id=>nodes[id]||(nodes[id]={hidden:id==='crop-layer',value:'',focus(){},removeAttribute(){},querySelector(){return $('submit');}});
  const c=vm.createContext({$,consentAccepted:true,exporting:false,activeModal:null,editingId:null,insertionAfterId:null,parentEdit:null,draft:null,submitting:false,returnFocus:null,
    state:{title:'张三',avatars:{left:{src:'left'},right:{src:'right'}},messages:[{id:'a',side:'left',type:'time',date:'2026-09-05',time:'12:00',format:'date'},{id:'b',side:'right',type:'text',text:'原消息'},{id:'c',side:'left',type:'recall'}]},
    clone:x=>JSON.parse(JSON.stringify(x)),today:()=> '2026-09-05',now:()=> '12:00',cancelPress(){},selectType(){},updateAvatarPreview(){},updateImagePreview(){},
    document:{querySelectorAll(){return [];},body:{contains(){return false;}}},showModal(id){c.activeModal=id;},
    R:{image:async src=>src},avatarImages:{},pictureCache:new Map(),rows:[],scale:1,scheduleRender(){},toast(){},
    persist(){c.saved=JSON.parse(JSON.stringify(c.state));},rebuild(){c.rows=c.state.messages.map((message,i)=>({message,y:i*100}));}
  });
  vm.runInContext(section('  function closeModal(', '  function selectType(')+section('  function editMessage(', '  function chooseFile('),c);
  c.submit=()=>c.submitMessage({preventDefault(){}});
  return {c,$};
}
for(const type of ['text','image','time','recall']){
  const {c,$}=fixture();c.editMessage('b');assert.equal($('message-edit-actions').hidden,false);
  c.addMessageAfter();assert.equal($('message-edit-actions').hidden,true);c.draft.type=type;
  $('message-text').value='插入内容';c.draft.image={src:'photo'};await c.submit();
  assert.equal(c.state.messages.length,4);assert.equal(c.state.messages[1].text,'原消息');assert.equal(c.state.messages[2].type,type);assert.equal(c.state.messages[3].id,'c');
  assert.equal(c.insertionAfterId,null);assert.equal(c.parentEdit,null);assert.equal(c.saved.messages.length,4);
}
for(const id of ['a','c']){const {c,$}=fixture();c.editMessage(id);c.addMessageAfter();$('message-text').value='插入';await c.submit();const i=c.state.messages.findIndex(m=>m.id===id);assert.equal(c.state.messages[i+1].text,'插入');}
const {c,$}=fixture();c.editMessage('b');$('message-text').value='未提交草稿';c.addMessageAfter();c.closeModal();
assert.equal(c.editingId,'b');assert.equal($('message-text').value,'未提交草稿');assert.equal(c.state.messages[1].text,'原消息');
c.closeModal();c.editMessage(null);$('message-text').value='普通新增';await c.submit();assert.equal(c.state.messages[3].text,'普通新增');
const missing=fixture();missing.c.editMessage('b');missing.c.addMessageAfter();missing.$('message-text').value='不应追加';missing.c.state.messages.splice(1,1);await missing.c.submit();assert.equal(missing.c.state.messages.length,2);assert.equal(missing.$('form-error').hidden,false);
const canceled=fixture();canceled.c.editMessage('b');canceled.c.addMessageAfter();canceled.$('message-text').value='取消提交';const pending=canceled.c.submit();canceled.c.closeModal();await pending;assert.equal(canceled.c.state.messages.length,3);assert.equal(canceled.c.editingId,'b');
console.log('PASS: insert all types, time/recall anchors, original unchanged, cancel restores draft, ordinary append, missing anchor, canceled async submission.');
