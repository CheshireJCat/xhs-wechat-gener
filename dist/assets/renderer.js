/* One Canvas 2D renderer for the editor and exported image. ES2017, offline. */
(function () {
  'use strict';
  var W = 472, H = 1024, STATUS = 55, HEADER = 54, FOOTER = 66;
  var BG = '#ededed', GREEN = '#95ec69';
  var FONT = '"PingFang SC", "Microsoft YaHei", sans-serif';
  var reference = null;
  var measureCanvas = document.createElement('canvas');
  var measure = measureCanvas.getContext('2d');
  function image(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('图片无法读取，请重新选择 JPG、PNG 或 WebP 图片')); };
      img.src = src;
    });
  }
  function rect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }
  function ref(ctx, sx, sy, sw, sh, x, y, w, h) {
    ctx.drawImage(reference, sx * reference.width / W, sy * reference.height / H,
      sw * reference.width / W, sh * reference.height / H, x, y, w, h);
  }
  function extract(sx, sy, sw, sh, width) {
    var c = document.createElement('canvas'); c.width = width; c.height = Math.round(width * sh / sw);
    ref(c.getContext('2d'), sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  }
  function defaultMessages() {
    var date = new Date();
    var day = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
    var time = String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
    return [
      {id:'intro-time', type:'time', side:'right', date:day, time:time, format:'date'},
      {id:'intro-add', type:'text', side:'right', text:'右下角+号新增对话'},
      {id:'intro-edit', type:'text', side:'left', text:'双击消息和时间编辑、删除消息'},
      {id:'intro-export', type:'text', side:'left', text:'右上角... 生成预览图'}
    ];
  }
  function seed() {
    return {
      version: 1, defaultsVersion: 2, title: '张三',
      avatars: {left: {src: extract(14, 648, 47, 47, 128)}, right: {src: extract(410.5, 179, 47, 47, 128)}},
      messages: defaultMessages()
    };
  }
  function upgradeDefaults(saved) {
    if (saved.defaultsVersion === 2) return saved;
    // Only replace the untouched original example; retain user-created/edited records and avatars.
    var bands = [[109,70],[179,250],[429,66.5],[495.5,86],[581.5,66.5],[648,61.5],[709.5,66],[775.5,61.5],[837,61.5],[898.5,59.5]];
    var untouched = saved.messages.length === bands.length && saved.messages.every(function (m, i) {
      return m.id === 's' + (i + 1) && Array.isArray(m.seed) && m.seed[0] === bands[i][0] && m.seed[1] === bands[i][1];
    });
    if (untouched) saved.messages = defaultMessages();
    if (saved.title === '张艺坤') saved.title = '张三';
    saved.defaultsVersion = 2;
    return saved;
  }
  // Local grapheme fallback: keep surrogate pairs, modifiers, ZWJ and flags together.
  function characters(text) {
    var units = Array.from(text), result = [], join = false;
    units.forEach(function (char) {
      var code = char.codePointAt(0);
      var combining = code === 0xfe0f || code === 0x20e3 || (code >= 0x1f3fb && code <= 0x1f3ff) || (code >= 0x300 && code <= 0x36f);
      var last = result[result.length - 1];
      var flag = code >= 0x1f1e6 && code <= 0x1f1ff && last && Array.from(last).length === 1 && last.codePointAt(0) >= 0x1f1e6 && last.codePointAt(0) <= 0x1f1ff;
      if ((combining || join || code === 0x200d || flag) && result.length) result[result.length - 1] += char;
      else result.push(char);
      join = code === 0x200d;
    });
    return result;
  }
  function wrap(text) {
    measure.font = '20px ' + FONT;
    var lines = [];
    text.split('\n').forEach(function (paragraph) {
      var line = '';
      characters(paragraph).forEach(function (char) {
        if (line && measure.measureText(line + char).width > 296) { lines.push(line); line = char; }
        else line += char;
      });
      lines.push(line);
    });
    return lines;
  }
  function timeText(m) {
    var parts = m.date.split('-').map(Number);
    var date = new Date(parts[0], parts[1] - 1, parts[2]);
    if (m.format === 'weekday') return '周' + '日一二三四五六'.charAt(date.getDay()) + ' ' + m.time;
    return (m.format === 'full' ? parts[0] + '年' : '') + parts[1] + '月' + parts[2] + '日 ' + m.time;
  }
  function recallText(m, title) {
    return m.side === 'left' ? '"' + title + '" 撤回了一条消息' : '你撤回了一条消息 重新编辑';
  }
  function recallBox(m, title) {
    measure.font = '16px ' + FONT;
    var parts = m.side === 'left' ? [{text:recallText(m,title),color:'#909090'}] :
      [{text:'你撤回了一条消息',color:'#909090'}, {text:'重新编辑',color:'#576b95',gap:8,link:true}];
    var lines = [{tokens:[],width:0}], line = lines[0];
    parts.forEach(function (part) {
      if (part.gap) {line.tokens.push({text:'',width:part.gap,color:part.color});line.width += part.gap;}
      characters(part.text).forEach(function (char) {
        var width = measure.measureText(char).width;
        if (line.width + width > W - 28 && line.tokens.length) {line={tokens:[],width:0};lines.push(line);}
        line.tokens.push({text:char,width:width,color:part.color,link:!!part.link});line.width += width;
      });
    });
    var links = [];
    lines.forEach(function (line,index) {
      var x = (W-line.width)/2;
      line.tokens.forEach(function (token) {if(token.link)links.push({x:x,y:9+index*22,width:token.width,height:22});x+=token.width;});
    });
    return {height:18+lines.length*22,noticeLines:lines,links:links};
  }
  function dimensions(m, title) {
    if (m.seed) return {height:m.seed[1]};
    if (m.type === 'time') return {height:66};
    if (m.type === 'recall') return recallBox(m, title || '');
    if (m.type === 'image') {
      var ratio = m.image.width / m.image.height;
      return {width:ratio >= 1 ? 236 : 236 * ratio, bubbleHeight:ratio >= 1 ? 236 / ratio : 236,
        height:(ratio >= 1 ? 236 / ratio : 236) + 14};
    }
    var lines = wrap(m.text);
    var width = Math.max.apply(null, lines.map(function (line) {return measure.measureText(line).width;}));
    var height = Math.max(47, lines.length * 26 + 20);
    return {height:height + 14, bubbleHeight:height, width:Math.min(324, Math.max(47,width + 28)), lines:lines};
  }
  function layout(messages, title) {
    var y = 0;
    return messages.map(function (m) {var box = dimensions(m, title); var row = {message:m, box:box, y:y, height:box.height}; y += row.height; return row;});
  }
  function drawAvatar(ctx, side, img) {
    var x = side === 'left' ? 14 : 410.5;
    ctx.fillStyle = BG; ctx.fillRect(x - 1, 0, 49, 49);
    ctx.save(); rect(ctx, x, 0, 47, 47, 4); ctx.clip(); ctx.drawImage(img, x, 0, 47, 47); ctx.restore();
  }
  function row(ctx, item, avatars, pictures) {
    var m = item.message, b = item.box;
    ctx.fillStyle = BG; ctx.fillRect(0,0,W,item.height);
    if (m.seed) {
      ref(ctx,0,m.seed[0],W,m.seed[1],0,0,W,item.height);
      if (m.type !== 'time') drawAvatar(ctx,m.side,avatars[m.side]);
      return;
    }
    if (m.type === 'time') {
      ctx.font = '14px ' + FONT; ctx.fillStyle = '#989898'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(timeText(m), W/2, 29); ctx.textAlign = 'left'; return;
    }
    if (m.type === 'recall') {
      ctx.font='16px '+FONT;ctx.textAlign='left';ctx.textBaseline='middle';
      b.noticeLines.forEach(function (line,index) {
        var x=(W-line.width)/2;
        line.tokens.forEach(function (token) {ctx.fillStyle=token.color;ctx.fillText(token.text,x,20+index*22);x+=token.width;});
      });
      return;
    }
    drawAvatar(ctx, m.side, avatars[m.side]);
    var x = m.side === 'left' ? 73.5 : 397.5-b.width;
    ctx.save(); rect(ctx,x,0,b.width,b.bubbleHeight,5); ctx.clip();
    if (m.type === 'image') ctx.drawImage(pictures[m.id], x,0,b.width,b.bubbleHeight);
    else {ctx.fillStyle=m.side === 'left' ? '#fff' : GREEN;ctx.fillRect(x,0,b.width,b.bubbleHeight);}
    ctx.restore();
    if (m.type === 'text') {
      ctx.fillStyle=m.side === 'left' ? '#fff' : GREEN;
      ctx.beginPath(); var tip = m.side === 'left' ? x : x+b.width; var direction = m.side === 'left' ? -1 : 1;
      ctx.moveTo(tip,17);ctx.lineTo(tip+6*direction,23.5);ctx.lineTo(tip,30);ctx.closePath();ctx.fill();
      ctx.fillStyle='#080808';ctx.font='20px '+FONT;ctx.textAlign='left';ctx.textBaseline='middle';
      b.lines.forEach(function (line,i) {ctx.fillText(line,x+14,23.5+i*26);});
    }
  }
  function header(ctx,title) {
    ref(ctx,0,STATUS,W,HEADER,0,0,W,HEADER);
    if (title !== '张艺坤') {
      ctx.fillStyle=BG;ctx.fillRect(66,0,328,48);
      ctx.fillStyle='#111';ctx.font='20px '+FONT;ctx.textAlign='center';ctx.textBaseline='middle';
      var shown=title; while (ctx.measureText(shown).width>290 && shown.length>1) shown=shown.slice(0,-1);
      if (shown!==title) shown=shown.slice(0,-1)+'…';
      ctx.fillText(shown,W/2,26);ctx.textAlign='left';
    }
  }
  function footer(ctx) {ref(ctx,0,H-FOOTER,W,FOOTER,0,0,W,FOOTER);}
  function setup(canvas,height,ratio) {
    canvas.width=Math.round(W*ratio);canvas.height=Math.ceil(height*ratio);
    var ctx=canvas.getContext('2d');if(!ctx) throw new Error('当前设备无法绘制图片');
    ctx.setTransform(ratio,0,0,ratio,0,0);return ctx;
  }
  window.ChatRenderer={W:W,H:H,STATUS:STATUS,HEADER:HEADER,FOOTER:FOOTER,BG:BG,image:image,rect:rect,
    seed:seed,upgradeDefaults:upgradeDefaults,layout:layout,row:row,header:header,footer:footer,setup:setup,timeText:timeText,recallText:recallText,
    initialize:async function () {
      reference=await image('./assets/reference.jpg');
      var sample=document.createElement('canvas');sample.width=W;sample.height=H;
      var context=sample.getContext('2d');context.drawImage(reference,0,0,W,H);
      function color(x,y){var p=context.getImageData(x,y,1,1).data;return 'rgb('+p[0]+','+p[1]+','+p[2]+')';}
      BG=color(200,200);GREEN=color(100,505);window.ChatRenderer.BG=BG;sample.width=1;sample.height=1;
    }};
})();
