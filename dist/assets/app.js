(function () {
  'use strict';
  var R=window.ChatRenderer, $=function(id){return document.getElementById(id);};
  var consentAccepted=false, consentReady=false;
  var state, rows=[], avatarImages={}, pictureCache=new Map(), db=null, storageFallback=false;
  var scale=1, renderVersion=0, scheduled=false, activeModal=null, returnFocus=null;
  var draft=null, editingId=null, insertionAfterId=null, parentEdit=null, crop=null, fileTarget=null, toastTimer=null, saveQueue=Promise.resolve();
  var press=null,lastTap=null;
  var outputData=null, exporting=false, submitting=false, exportTicket=0, liveNodes=new Map();
  function focusConsent(){
    var target=consentReady?$('disclaimer-agree'):$('disclaimer-modal');target.focus();
  }
  function requireConsent(){
    consentAccepted=false;cancelPress();
    document.body.classList.add('consent-pending');$('app').setAttribute('aria-hidden','true');
    $('disclaimer-layer').hidden=false;$('disclaimer-agree').disabled=!consentReady;
    focusConsent();
  }
  function bindConsentGate(){
    $('disclaimer-agree').addEventListener('click',function(){
      if(!consentReady||consentAccepted)return;
      consentAccepted=true;$('disclaimer-layer').hidden=true;
      document.body.classList.remove('consent-pending');$('app').removeAttribute('aria-hidden');
      updateSize();
      if(!state.helpSeen)showModal('help-modal');
      if(activeModal){var target=$(activeModal).querySelector('button:not([disabled]),input,textarea');if(target)target.focus();}
      else $('footer-add').focus();
    });
    document.addEventListener('keydown',function(event){
      if(consentAccepted)return;
      if(event.key==='Escape'||event.key==='Tab'){
        event.preventDefault();event.stopImmediatePropagation();focusConsent();
      }
    },true);
    document.addEventListener('focusin',function(event){
      if(!consentAccepted&&!$('disclaimer-layer').contains(event.target))focusConsent();
    },true);
    document.addEventListener('click',function(event){
      if(!consentAccepted&&!$('disclaimer-layer').contains(event.target)){
        event.preventDefault();event.stopImmediatePropagation();focusConsent();
      }
    },true);
    window.addEventListener('pageshow',function(event){if(event.persisted)requireConsent();});
    requireConsent();
  }
  function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(function(){$('toast').hidden=true;},3500);}
  function clone(value){return JSON.parse(JSON.stringify(value));}
  function tick(){return new Promise(function(resolve){requestAnimationFrame(resolve);});}
  function today(){var d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
  function now(){var d=new Date();return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');}
  function openDatabase(){return new Promise(function(resolve){
    if(!window.indexedDB){storageFallback=true;resolve(null);return;}
    var request;
    try{request=indexedDB.open('wechat-chat-tool',1);}catch(e){storageFallback=true;resolve(null);return;}
    request.onupgradeneeded=function(){request.result.createObjectStore('drafts');};
    request.onsuccess=function(){resolve(request.result);};
    request.onerror=function(){storageFallback=true;resolve(null);};
    request.onblocked=function(){storageFallback=true;resolve(null);};
  });}
  function readState(){return new Promise(function(resolve){
    if(!db){try{resolve(JSON.parse(localStorage.getItem('wechat-chat-tool')||'null'));}catch(e){resolve(null);}return;}
    var request=db.transaction('drafts','readonly').objectStore('drafts').get('current');
    request.onsuccess=function(){resolve(request.result||null);};request.onerror=function(){resolve(null);};
  });}
  function validState(s){return s&&s.version===1&&typeof s.title==='string'&&s.avatars&&s.avatars.left&&s.avatars.right&&Array.isArray(s.messages)&&s.messages.every(function(m){return m&&typeof m.id==='string'&&['text','image','time','recall'].includes(m.type)&&['left','right'].includes(m.side)&&(m.type!=='text'||typeof m.text==='string')&&(m.type!=='image'||m.image&&typeof m.image.src==='string'&&m.image.width>0&&m.image.height>0)&&(m.type!=='time'||typeof m.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(m.date)&&/^\d{2}:\d{2}$/.test(m.time));});}
  function persist(){
    var snapshot=clone(state);
    saveQueue=saveQueue.then(function(){return new Promise(function(resolve){
      if(!db){try{localStorage.setItem('wechat-chat-tool',JSON.stringify(snapshot));}catch(e){toast('本地空间不足，当前内容仍可导出，重新打开后可能丢失');}resolve();return;}
      try{var tx=db.transaction('drafts','readwrite');tx.objectStore('drafts').put(snapshot,'current');tx.oncomplete=resolve;tx.onerror=function(){toast('保存失败：本地空间不足，建议先导出图片');resolve();};tx.onabort=tx.onerror;}catch(e){toast('暂时无法保存到本地，当前内容仍可导出');resolve();}
    });});
  }
  function bodyHeight(){return rows.length ? rows[rows.length-1].y+rows[rows.length-1].height : 0;}
  async function refreshAvatars(){avatarImages.left=await R.image(state.avatars.left.src);avatarImages.right=await R.image(state.avatars.right.src);}
  async function picture(message){
    if(pictureCache.has(message.id)){var hit=pictureCache.get(message.id);if(hit.src===message.image.src)return hit.img;}
    var img=await R.image(message.image.src);pictureCache.set(message.id,{src:message.image.src,img:img});
    if(pictureCache.size>24)pictureCache.delete(pictureCache.keys().next().value);
    return img;
  }
  function updateSize(){
    renderVersion++;
    var viewport=window.visualViewport;
    var height=viewport ? viewport.height : window.innerHeight;
    document.documentElement.style.setProperty('--app-height',height+'px');
    scale=$('app').clientWidth/R.W;
    if(!state)return;
    var pixelRatio=Math.min(window.devicePixelRatio||1,3)*scale;
    R.header(R.setup($('header-canvas'),R.HEADER,pixelRatio),state.title);
    R.footer(R.setup($('footer-canvas'),R.FOOTER,pixelRatio));
    $('title-button').setAttribute('aria-label','修改聊天标题：'+state.title);
    $('header').style.height=(R.HEADER*scale)+'px';$('footer').style.height=(R.FOOTER*scale)+'px';
    $('chat-spacer').style.height=Math.max(bodyHeight()*scale,$('chat-scroll').clientHeight)+'px';
    liveNodes.forEach(function(node){node.parentNode.removeChild(node);});liveNodes.clear();
    scheduleRender();
  }
  function rebuild(scrollToEnd){rows=R.layout(state.messages,state.title);updateSize();if(scrollToEnd)$('chat-scroll').scrollTop=$('chat-spacer').offsetHeight;scheduleRender();}
  function scheduleRender(){if(scheduled)return;scheduled=true;requestAnimationFrame(function(){scheduled=false;renderVisible().catch(function(e){toast(e.message);});});}
  async function renderVisible(){
    if(!state)return;var version=++renderVersion;
    var top=$('chat-scroll').scrollTop/scale-80, bottom=top+$('chat-scroll').clientHeight/scale+160;
    var low=0,high=rows.length;
    while(low<high){var mid=(low+high)>>1;if(rows[mid].y+rows[mid].height<top)low=mid+1;else high=mid;}
    var visible=[];for(var n=low;n<rows.length&&rows[n].y<bottom;n++)visible.push(rows[n]);
    var ids=new Set(visible.map(function(item){return item.message.id;}));
    liveNodes.forEach(function(node,id){if(!ids.has(id)){node.parentNode.removeChild(node);liveNodes.delete(id);}});
    for(var i=0;i<visible.length;i++){
      var item=visible[i],m=item.message;if(liveNodes.has(m.id))continue;
      var pictures={};if(m.type==='image'&&!m.seed)pictures[m.id]=await picture(m);
      if(version!==renderVersion)return;
      var button=document.createElement('button');button.className='chat-row';button.type='button';button.dataset.id=m.id;
      button.style.top=(item.y*scale)+'px';button.style.height=(item.height*scale)+'px';
      button.setAttribute('aria-label',(m.side==='left'?'左边':'右边')+'，'+(m.type==='time'?R.timeText(m):m.type==='text'?m.text:m.type==='recall'?R.recallText(m,state.title):'图片')+'，双击或按回车编辑');
      var canvas=document.createElement('canvas');canvas.setAttribute('aria-hidden','true');
      var rowRatio=Math.min(Math.min(window.devicePixelRatio||1,3)*scale,Math.sqrt(2000000/(R.W*item.height)),4096/item.height);
      R.row(R.setup(canvas,item.height,rowRatio),item,avatarImages,pictures);
      button.appendChild(canvas);$('chat-spacer').appendChild(button);liveNodes.set(m.id,button);
    }
  }
  function cancelPress(){if(press)clearTimeout(press.timer);press=null;}
  function showModal(id){
    if(!consentAccepted)return;
    cancelPress();
    if(!activeModal)returnFocus=document.activeElement;
    document.querySelectorAll('#modal-layer > .modal').forEach(function(el){el.hidden=el.id!==id;});
    $('modal-layer').hidden=false;activeModal=id;
    if(id==='help-modal'&&!state.helpSeen){state.helpSeen=true;persist();}
    $('chat-scroll').setAttribute('aria-hidden','true');
    requestAnimationFrame(function(){var target=$(id).querySelector('input:not([type=radio]), textarea, button');if(target)target.focus();});
  }
  function closeModal(completed){
    if(!consentAccepted)return;
    if(!$('crop-layer').hidden){closeCrop();return;}
    if(activeModal==='export-modal'){exportTicket++;outputData=null;$('export-preview').removeAttribute('src');$('export-preview').hidden=true;}
    if(parentEdit&&completed!==true){draft=parentEdit.draft;editingId=parentEdit.id;parentEdit=null;insertionAfterId=null;renderMessageEditor();return;}
    $('modal-layer').hidden=true;activeModal=null;draft=null;editingId=null;insertionAfterId=null;parentEdit=null;$('chat-scroll').removeAttribute('aria-hidden');
    if(returnFocus&&document.body.contains(returnFocus))returnFocus.focus();else $('footer-add').focus();
  }
  function selectType(type){
    draft.type=type;
    ['image','text','time','recall'].forEach(function(t){$('panel-'+t).hidden=t!==type;$('tab-'+t).setAttribute('aria-selected',String(t===type));$('tab-'+t).tabIndex=t===type?0:-1;});
    $('message-date').required=type==='time';$('message-time').required=type==='time';
    $('form-error').hidden=true;updateRecallPreview();
  }
  function updateRecallPreview(){
    if(!draft)return;var preview=$('recall-preview');preview.textContent='';
    if(draft.side==='left')preview.textContent=R.recallText(draft,state.title);
    else{preview.appendChild(document.createTextNode('你撤回了一条消息'));var link=document.createElement('span');link.className='recall-reedit';link.textContent='重新编辑';preview.appendChild(link);}
  }
  function updateAvatarPreview(){
    var selected=draft.avatars[draft.side];$('avatar-preview').src=selected.src;
    document.querySelectorAll('.avatar-choice').forEach(function(button){button.setAttribute('aria-pressed',String(selected.presetId===button.dataset.preset));});
  }
  function initializeAvatarPresets(){
    var presets=window.ChatAvatarPresets||[];
    presets.forEach(function(preset){
      var button=document.createElement('button');button.type='button';button.className='avatar-choice';button.dataset.preset=preset.id;
      button.setAttribute('aria-label','选择'+preset.label+'头像');button.setAttribute('aria-pressed','false');button.title=preset.label;
      var picture=document.createElement('span');picture.className='avatar-choice-picture';
      var image=document.createElement('img');image.src=preset.src;image.alt='';image.width=256;image.height=256;picture.appendChild(image);
      var label=document.createElement('span');label.className='avatar-choice-label';label.textContent=preset.label;
      button.appendChild(picture);button.appendChild(label);
      button.addEventListener('click',function(){
        if(!draft)return;
        draft.avatars[draft.side]={src:preset.src,width:256,height:256,presetId:preset.id};updateAvatarPreview();
      });
      $('avatar-presets').appendChild(button);
    });
    $('avatar-presets-toggle').addEventListener('click',function(){
      var expanded=this.getAttribute('aria-expanded')!=='true';this.setAttribute('aria-expanded',String(expanded));
      this.textContent=expanded?'收起':'查看全部 20 款';$('avatar-presets').classList.toggle('expanded',expanded);
    });
  }
  function updateImagePreview(){var asset=draft.image;$('message-image-preview').hidden=!asset;$('image-recrop').hidden=!asset;$('image-upload-label').textContent=asset?'更换图片':'＋ 选择图片';if(asset)$('message-image-preview').src=asset.src;else $('message-image-preview').removeAttribute('src');}
  function editMessage(id,type){
    if(!consentAccepted||exporting||activeModal)return;
    cancelPress();
    var message=id?state.messages.find(function(m){return m.id===id;}):null;
    if(id&&!message)return;
    editingId=id||null;insertionAfterId=null;parentEdit=null;
    draft=message?clone(message):{side:'right',type:type||'text',text:'',date:today(),time:now(),format:'date'};
    if(!draft.date)draft.date=today();if(!draft.time)draft.time=now();if(!draft.format)draft.format='date';
    draft.avatars=clone(state.avatars);
    renderMessageEditor();
  }
  function renderMessageEditor(){
    $('message-heading').textContent=editingId?'编辑对话':insertionAfterId?'在后面新增对话':'新增对话';
    $('message-edit-actions').hidden=!editingId;
    document.querySelectorAll('input[name=side]').forEach(function(radio){radio.checked=radio.value===draft.side;});
    $('message-text').value=draft.text||'';$('message-date').value=draft.date;$('message-time').value=draft.time;$('time-format').value=draft.format;
    selectType(draft.type);updateAvatarPreview();updateImagePreview();showModal('message-modal');
  }
  function addMessageAfter(){
    if(!consentAccepted||activeModal!=='message-modal'||!editingId||submitting)return;
    if(!state.messages.some(function(m){return m.id===editingId;})){formError('该消息已不存在');return;}
    draft.text=$('message-text').value;draft.date=$('message-date').value;draft.time=$('message-time').value;draft.format=$('time-format').value;
    parentEdit={id:editingId,draft:draft};insertionAfterId=editingId;editingId=null;
    draft={side:parentEdit.draft.side,type:'text',text:'',date:today(),time:now(),format:'date',avatars:clone(state.avatars)};
    renderMessageEditor();
  }
  function formError(message){$('form-error').textContent=message;$('form-error').hidden=false;}
  function sameContent(a,b){
    if(a.type!==b.type||a.side!==b.side)return false;
    if(a.type==='text')return a.text===b.text;
    if(a.type==='image')return a.image.src===b.image.src;
    if(a.type==='recall')return true;
    return a.date===b.date&&a.time===b.time&&a.format===b.format;
  }
  async function submitMessage(event){
    event.preventDefault();if(!consentAccepted||!draft||submitting)return;
    var m={id:editingId||'m'+Date.now().toString(36)+Math.random().toString(36).slice(2,7),side:draft.side,type:draft.type};
    if(m.type==='text'){m.text=$('message-text').value;if(!m.text.trim()){formError('请输入消息内容');return;}}
    if(m.type==='image'){if(!draft.image){formError('请先选择一张图片');return;}m.image=draft.image;}
    if(m.type==='time'){
      m.date=$('message-date').value;m.time=$('message-time').value;m.format=$('time-format').value;
      if(!/^\d{4}-\d{2}-\d{2}$/.test(m.date)||!/^\d{2}:\d{2}$/.test(m.time)){formError('请选择有效的日期和时间');return;}
      var p=m.date.split('-').map(Number),d=new Date(p[0],p[1]-1,p[2]);
      if(d.getFullYear()!==p[0]||d.getMonth()!==p[1]-1||d.getDate()!==p[2]||Number(m.time.slice(0,2))>23||Number(m.time.slice(3))>59){formError('日期或时间无效');return;}
    }
    var wasEdit=!!editingId, index=state.messages.findIndex(function(item){return item.id===editingId;});
    if(wasEdit&&index<0){formError('该消息已不存在');return;}
    if(wasEdit&&sameContent(state.messages[index],m)&&state.messages[index].seed)m.seed=state.messages[index].seed;
    var owner=draft, nextAvatars=draft.avatars, afterId=insertionAfterId;
    submitting=true;var submitButton=$('message-form').querySelector('[type=submit]');submitButton.disabled=true;
    // Decode before committing so a failed image cannot leave a half-updated draft.
    var decoded;
    try{decoded={left:await R.image(nextAvatars.left.src),right:await R.image(nextAvatars.right.src)};}catch(e){if(draft===owner)formError(e.message);return;}finally{submitting=false;submitButton.disabled=false;}
    if(draft!==owner)return;
    index=state.messages.findIndex(function(item){return item.id===(wasEdit?m.id:afterId);});
    if((wasEdit||afterId)&&index<0){formError('该消息已不存在');return;}
    state.avatars=nextAvatars;avatarImages=decoded;
    if(wasEdit)state.messages[index]=m;else if(afterId)state.messages.splice(index+1,0,m);else state.messages.push(m);
    pictureCache.delete(m.id);persist();closeModal(true);rebuild(!wasEdit&&!afterId);
    if(afterId){var inserted=rows.find(function(row){return row.message.id===m.id;});if(inserted){$('chat-scroll').scrollTop=Math.max(0,inserted.y*scale-24);scheduleRender();}}
    toast(wasEdit?'已更新对话':'已添加对话');
  }
  function chooseFile(target){fileTarget=target;$('file-input').value='';$('file-input').click();}
  function normalizeImage(img){
    var ratio=Math.min(1,1600/Math.max(img.width,img.height));var c=document.createElement('canvas');
    c.width=Math.max(1,Math.round(img.width*ratio));c.height=Math.max(1,Math.round(img.height*ratio));
    var ctx=c.getContext('2d');if(!ctx)throw new Error('当前设备无法处理图片');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(img,0,0,c.width,c.height);
    return c.toDataURL('image/jpeg',.9);
  }
  async function fileChosen(){
    var file=$('file-input').files[0],target=fileTarget,owner=draft;if(!file||!owner)return;
    if(!/^image\//.test(file.type)){formError('请选择 JPG、PNG 或 WebP 图片');return;}
    if(file.size>25*1024*1024){formError('图片超过 25 MB，请先压缩后上传');return;}
    var url;
    try{
      if(!window.URL||!URL.createObjectURL)throw new Error('当前环境不支持选择图片预览');
      url=URL.createObjectURL(file);var img=await R.image(url);
      if(img.width*img.height>48000000)throw new Error('图片分辨率过大，请使用 4800 万像素以内的图片');
      var source=normalizeImage(img);URL.revokeObjectURL(url);url=null;
      if(draft!==owner)return;
      await openCrop(target,{originalSrc:source,src:source},true);
    }catch(e){formError(e.message);}finally{if(url)URL.revokeObjectURL(url);$('file-input').value='';}
  }
  async function openCrop(target,asset,fresh){
    var owner=draft;if(!owner)return;
    try{
      var img=await R.image(asset.originalSrc||asset.src);if(draft!==owner)return;
      crop={target:target,side:owner.side,img:img,source:asset.originalSrc||asset.src,zoom:1,dx:0,dy:0,ratio:target==='avatar'?1:img.width/img.height,drag:null,owner:owner};
      if(!fresh&&asset.crop){crop.zoom=asset.crop.zoom;crop.dx=asset.crop.dx;crop.dy=asset.crop.dy;crop.ratio=asset.crop.ratio;}
      $('crop-heading').textContent=target==='avatar'?'裁剪头像':'裁剪消息图片';$('ratio-label').hidden=target==='avatar';
      var matched=Array.from($('crop-ratio').options).some(function(option){return option.value!=='original'&&Math.abs(Number(option.value)-crop.ratio)<.001;});
      $('crop-ratio').value=matched?Array.from($('crop-ratio').options).find(function(option){return Math.abs(Number(option.value)-crop.ratio)<.001;}).value:'original';
      $('crop-zoom').value=crop.zoom;$('crop-layer').hidden=false;
      requestAnimationFrame(function(){drawCrop();$('crop-confirm').focus();});
    }catch(e){formError(e.message);}
  }
  function cropGeometry(){
    var w=$('crop-stage').clientWidth,h=$('crop-stage').clientHeight;
    var fw=Math.min(w-36,(h-36)*crop.ratio),fh=fw/crop.ratio;
    var base=Math.max(fw/crop.img.width,fh/crop.img.height),s=base*crop.zoom;
    // Normalized offsets survive viewport changes and recropping.
    var maxX=Math.max(0,(crop.img.width*s-fw)/2),maxY=Math.max(0,(crop.img.height*s-fh)/2);
    crop.dx=Math.max(-1,Math.min(1,crop.dx));crop.dy=Math.max(-1,Math.min(1,crop.dy));
    return {w:w,h:h,fw:fw,fh:fh,s:s,maxX:maxX,maxY:maxY,ix:w/2-crop.img.width*s/2+crop.dx*maxX,iy:h/2-crop.img.height*s/2+crop.dy*maxY};
  }
  function drawCrop(){
    if(!crop)return;var g=cropGeometry(),c=$('crop-canvas'),dpr=Math.min(window.devicePixelRatio||1,2);
    c.width=Math.round(g.w*dpr);c.height=Math.round(g.h*dpr);var ctx=c.getContext('2d');ctx.scale(dpr,dpr);
    ctx.fillStyle='#202423';ctx.fillRect(0,0,g.w,g.h);ctx.drawImage(crop.img,g.ix,g.iy,crop.img.width*g.s,crop.img.height*g.s);
    ctx.fillStyle='rgba(0,0,0,.58)';ctx.fillRect(0,0,g.w,g.h);
    var x=(g.w-g.fw)/2,y=(g.h-g.fh)/2;
    ctx.save();ctx.beginPath();ctx.rect(x,y,g.fw,g.fh);ctx.clip();ctx.drawImage(crop.img,g.ix,g.iy,crop.img.width*g.s,crop.img.height*g.s);ctx.restore();
    ctx.strokeStyle='#fff';ctx.lineWidth=1;ctx.strokeRect(x,y,g.fw,g.fh);ctx.strokeStyle='rgba(255,255,255,.3)';
    for(var i=1;i<3;i++){ctx.beginPath();ctx.moveTo(x+g.fw*i/3,y);ctx.lineTo(x+g.fw*i/3,y+g.fh);ctx.moveTo(x,y+g.fh*i/3);ctx.lineTo(x+g.fw,y+g.fh*i/3);ctx.stroke();}
    $('crop-zoom-value').textContent=Math.round(crop.zoom*100)+'%';
  }
  function closeCrop(){crop=null;$('crop-layer').hidden=true;$('crop-canvas').width=1;$('crop-canvas').height=1;if(activeModal==='message-modal')$('avatar-upload').focus();}
  function confirmCrop(){
    if(!crop||crop.owner!==draft)return;
    try{
      var g=cropGeometry(),c=document.createElement('canvas'),size=crop.target==='avatar'?256:960;
      c.width=Math.max(1,Math.round(crop.ratio>=1?size:size*crop.ratio));c.height=Math.max(1,Math.round(crop.ratio>=1?size/crop.ratio:size));
      var ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);
      ctx.drawImage(crop.img,((g.w-g.fw)/2-g.ix)/g.s,((g.h-g.fh)/2-g.iy)/g.s,g.fw/g.s,g.fh/g.s,0,0,c.width,c.height);
      var asset={src:c.toDataURL('image/jpeg',.92),originalSrc:crop.source,width:c.width,height:c.height,crop:{zoom:crop.zoom,dx:crop.dx,dy:crop.dy,ratio:crop.ratio}};
      if(crop.target==='avatar'){draft.avatars[crop.side]=asset;updateAvatarPreview();}else{draft.image=asset;updateImagePreview();}
      closeCrop();
    }catch(e){toast('裁剪失败，请重试或换一张较小的图片');}
  }
  async function generate(){
    if(!consentAccepted||exporting)return;exporting=true;$('export-button').disabled=true;outputData=null;
    var ticket=++exportTicket;
    showModal('export-modal');$('export-preview').hidden=true;$('export-error').hidden=true;$('save-image').disabled=true;$('export-status').textContent='正在生成完整聊天记录…';
    var canvas;
    try{
      await tick();var height=Math.max(R.W*2640/1216-R.STATUS,R.HEADER+bodyHeight()+R.FOOTER);
      // Keep the entire conversation: lower resolution for very long records, never clip.
      var ratio=Math.min(1216/R.W,16000/height,Math.sqrt(8000000/(R.W*height)));
      if(ratio<.25)throw new Error('聊天记录过长，超过当前设备单张长图容量，请减少消息后重试');
      canvas=document.createElement('canvas');var ctx=R.setup(canvas,height,ratio);ctx.fillStyle=R.BG;ctx.fillRect(0,0,R.W,height);
      R.header(ctx,state.title);
      for(var i=0;i<rows.length;i++){
        if(ticket!==exportTicket)return;
        var item=rows[i],pictures={};if(item.message.type==='image'&&!item.message.seed)pictures[item.message.id]=await picture(item.message);
        ctx.save();ctx.translate(0,R.HEADER+item.y);R.row(ctx,item,avatarImages,pictures);ctx.restore();
        if(i%12===0){$('export-status').textContent='正在生成 '+Math.round((i+1)/Math.max(1,rows.length)*100)+'%…';await tick();}
      }
      ctx.save();ctx.translate(0,height-R.FOOTER);R.footer(ctx);ctx.restore();
      if(ticket!==exportTicket)return;
      outputData=canvas.toDataURL('image/png');if(outputData==='data:,')throw new Error('设备内存不足，无法生成长图，请减少图片后重试');
      $('export-preview').src=outputData;$('export-preview').hidden=false;
      var native=window.xhs&&window.xhs.miniTool&&typeof window.xhs.miniTool.saveImageToPhotosAlbum==='function';
      $('export-status').textContent=canvas.width+' × '+canvas.height+' 像素 · '+state.messages.length+' 条记录'+(native?'':'。请在小红书小工具容器内使用“保存到相册”。');
      $('save-image').disabled=!native;
    }catch(e){$('export-status').textContent='生成未完成';$('export-error').textContent=e.message;$('export-error').hidden=false;}
    finally{if(canvas){canvas.width=1;canvas.height=1;}exporting=false;$('export-button').disabled=false;}
  }
  async function saveImage(){
    if(!consentAccepted||!outputData)return;var bridge=window.xhs&&window.xhs.miniTool;if(!bridge||typeof bridge.saveImageToPhotosAlbum!=='function'){toast('请在小红书小工具容器内保存到相册');return;}
    var data=outputData;$('save-image').disabled=true;$('save-image').textContent='正在保存…';
    try{
      var path=data;
      if(typeof bridge.writeTempFile==='function'){var result=await window.xhs.miniTool.writeTempFile({data:data});if(!result||!result.filePath)throw new Error('图片临时文件生成失败');path=result.filePath;}
      await window.xhs.miniTool.saveImageToPhotosAlbum({filePath:path});toast('已保存到相册');
    }catch(e){$('export-error').textContent=e.errMsg||e.message||'保存失败，请检查相册权限后重试';$('export-error').hidden=false;}
    finally{$('save-image').textContent='保存到相册';$('save-image').disabled=!outputData;}
  }
  function clearConversation(){
    if(!consentAccepted)return;
    state.messages=[];pictureCache.clear();persist();closeModal();rebuild(false);toast('已清空对话');
  }
  function bind(){
    initializeAvatarPresets();
    $('footer-add').addEventListener('click',function(){editMessage(null);});$('compose-button').addEventListener('click',function(){editMessage(null,'text');});
    $('help-button').addEventListener('click',function(){showModal('help-modal');});
    $('clear-conversation').addEventListener('click',clearConversation);
    $('title-button').addEventListener('click',function(){$('title-input').value=state.title;showModal('title-modal');});
    $('title-form').addEventListener('submit',function(e){e.preventDefault();var title=$('title-input').value.trim();if(!title){$('title-input').focus();return;}state.title=title;persist();closeModal();rebuild(false);});
    document.querySelectorAll('[data-close]').forEach(function(button){button.addEventListener('click',closeModal);});
    document.querySelectorAll('input[name=side]').forEach(function(radio){radio.addEventListener('change',function(){if(draft){draft.side=radio.value;updateAvatarPreview();updateRecallPreview();}});});
    document.querySelectorAll('[data-type]').forEach(function(button){button.addEventListener('click',function(){if(draft)selectType(button.dataset.type);});button.addEventListener('keydown',function(e){if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight')return;e.preventDefault();var types=['image','text','time','recall'],index=types.indexOf(draft.type);selectType(types[(index+(e.key==='ArrowRight'?1:types.length-1))%types.length]);$('tab-'+draft.type).focus();});});
    $('message-form').addEventListener('submit',submitMessage);
    $('add-message-after').addEventListener('click',addMessageAfter);
    $('delete-message').addEventListener('click',function(){if(!editingId)return;var id=editingId;state.messages=state.messages.filter(function(m){return m.id!==id;});pictureCache.delete(id);persist();closeModal();rebuild(false);toast('已删除消息');});
    $('avatar-upload').addEventListener('click',function(){chooseFile('avatar');});$('image-upload').addEventListener('click',function(){chooseFile('image');});
    $('avatar-recrop').addEventListener('click',function(){openCrop('avatar',draft.avatars[draft.side],false);});$('image-recrop').addEventListener('click',function(){if(draft.image)openCrop('image',draft.image,false);});
    $('file-input').addEventListener('change',fileChosen);
    $('crop-close').addEventListener('click',closeCrop);$('crop-cancel').addEventListener('click',closeCrop);$('crop-confirm').addEventListener('click',confirmCrop);
    $('crop-zoom').addEventListener('input',function(){if(crop){crop.zoom=Number(this.value);drawCrop();}});
    $('crop-ratio').addEventListener('change',function(){if(crop){crop.ratio=this.value==='original'?crop.img.width/crop.img.height:Number(this.value);crop.dx=0;crop.dy=0;crop.zoom=1;$('crop-zoom').value=1;drawCrop();}});
    $('crop-canvas').addEventListener('pointerdown',function(e){if(!crop)return;e.preventDefault();crop.drag={id:e.pointerId,x:e.clientX,y:e.clientY,dx:crop.dx,dy:crop.dy};if(this.setPointerCapture)this.setPointerCapture(e.pointerId);});
    $('crop-canvas').addEventListener('pointermove',function(e){if(!crop||!crop.drag||crop.drag.id!==e.pointerId)return;e.preventDefault();var g=cropGeometry();crop.dx=crop.drag.dx+(g.maxX?(e.clientX-crop.drag.x)/g.maxX:0);crop.dy=crop.drag.dy+(g.maxY?(e.clientY-crop.drag.y)/g.maxY:0);drawCrop();});
    ['pointerup','pointercancel','lostpointercapture'].forEach(function(name){$('crop-canvas').addEventListener(name,function(){if(crop)crop.drag=null;});});
    $('export-button').addEventListener('click',generate);$('save-image').addEventListener('click',saveImage);
    $('chat-scroll').addEventListener('scroll',scheduleRender,{passive:true});
    $('chat-scroll').addEventListener('click',function(e){
      var node=e.target.closest('.chat-row');if(!node||activeModal)return;
      var item=rows.find(function(row){return row.message.id===node.dataset.id;});
      if(!item||item.message.type!=='recall'||item.message.side!=='right')return;
      var bounds=node.getBoundingClientRect(),x=(e.clientX-bounds.left)/scale,y=(e.clientY-bounds.top)/scale;
      if(item.box.links.some(function(link){return x>=link.x-2&&x<=link.x+link.width+2&&y>=link.y-4&&y<=link.y+link.height+4;}))editMessage(item.message.id);
    });
    $('chat-scroll').addEventListener('dblclick' ,function(e){var row=e.target.closest('.chat-row');if(row)editMessage(row.dataset.id);});
    $('chat-scroll').addEventListener('keydown',function(e){var row=e.target.closest('.chat-row');if(row&&(e.key==='Enter'||e.key===' ')){e.preventDefault();editMessage(row.dataset.id);}});
    $('chat-scroll').addEventListener('pointerdown',function(e){if(activeModal)return;cancelPress();var node=e.target.closest('.chat-row');if(!node)return;var current={id:node.dataset.id,x:e.clientX,y:e.clientY,at:Date.now(),pointer:e.pointerType};press=current;current.timer=setTimeout(function(){if(press===current&&!activeModal){var id=current.id;cancelPress();editMessage(id);}},550);},{passive:true});
    $('chat-scroll').addEventListener('pointermove',function(e){if(press&&(Math.abs(e.clientX-press.x)>8||Math.abs(e.clientY-press.y)>8)){clearTimeout(press.timer);press=null;}},{passive:true});
    $('chat-scroll').addEventListener('pointerup',function(){if(!press)return;clearTimeout(press.timer);if(press.pointer==='touch'&&Date.now()-press.at<350){if(lastTap&&lastTap.id===press.id&&Date.now()-lastTap.at<350){editMessage(press.id);lastTap=null;}else lastTap={id:press.id,at:Date.now()};}press=null;});
    document.addEventListener('pointerup',cancelPress);document.addEventListener('pointercancel',cancelPress);
    $('chat-scroll').addEventListener('scroll',cancelPress,{passive:true});
    document.addEventListener('keydown',function(e){
      if(e.key==='Escape'&&activeModal){e.preventDefault();closeModal();return;}
      if(e.key==='Tab'&&activeModal){var root=!$('crop-layer').hidden?$('crop-layer'):$(activeModal);var nodes=Array.from(root.querySelectorAll('button:not([disabled]),input:not([hidden]),textarea,select,[tabindex="0"]')).filter(function(el){return el.offsetParent!==null;});if(!nodes.length)return;var first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&(document.activeElement===first||!root.contains(document.activeElement))){e.preventDefault();last.focus();}else if(!e.shiftKey&&(document.activeElement===last||!root.contains(document.activeElement))){e.preventDefault();first.focus();}}
    });
    window.addEventListener('resize',function(){updateSize();if(crop)drawCrop();});if(window.visualViewport)window.visualViewport.addEventListener('resize',function(){updateSize();if(crop)drawCrop();});
  }
  async function initialize(){
    try{updateSize();await R.initialize();document.documentElement.style.setProperty('--bg',R.BG);db=await openDatabase();var saved=await readState();var upgrade=validState(saved)&&saved.defaultsVersion!==2;state=validState(saved)?R.upgradeDefaults(saved):R.seed();
      try{await refreshAvatars();}catch(e){state.avatars=R.seed().avatars;await refreshAvatars();toast('头像读取失败，已恢复参考头像');}
      bind();rebuild(false);consentReady=true;$('disclaimer-agree').disabled=false;$('disclaimer-status').hidden=true;focusConsent();if(upgrade)persist();if(storageFallback)toast('当前使用本地轻量存储，请及时导出重要内容');
    }catch(e){$('disclaimer-status').textContent='工具加载失败，请重新打开后再试。';$('disclaimer-status').hidden=false;toast('加载失败，请重新打开小工具');}
  }
  bindConsentGate();
  initialize();
})();
