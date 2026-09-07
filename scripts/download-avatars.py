"""Fetch the curated, CC0 DiceBear avatar assets for offline use. Not used at runtime."""
from pathlib import Path
import subprocess
from urllib.parse import urlencode
from concurrent.futures import ThreadPoolExecutor
import json

root = Path(__file__).resolve().parent.parent
items = [
 ('lorelei','清新插画','Luna'),('notionists','黑白速写','Milo'),('open-peeps','手绘人物','Sunny'),
 ('pixel-art','复古像素','Hana'),('thumbs','俏皮卡通','Coco'),('line-face','极简线条','Remy'),
 ('cameo','复古剪影','Olive'),('clay','软萌黏土','Mochi'),('critters','可爱动物','Bean'),
 ('cutouts','剪纸拼贴','Poppy'),('gaze','漫画大眼','Skye'),('moods','情绪表情','Joy'),
 ('pixelbot','像素机器人','Bolt'),('voxel-art','立体像素','Alex'),('voxel-bot','积木机器人','Robo'),
 ('sprouts','清新植物','Fern'),('landscape','山野风景','Alpine'),('planets','梦幻星球','Nova'),
 ('marbles','彩色弹珠','Iris'),('constellation','星座夜空','Orion')
]
folder = root / 'dist/assets/avatars'
folder.mkdir(exist_ok=True)
def download(entry):
    style,label,seed = entry
    url = 'https://api.dicebear.com/10.x/'+style+'/png?'+urlencode({'seed':seed,'size':256})
    data = subprocess.run(['curl','--fail','--silent','--show-error','--location','--max-time','45',url],check=True,capture_output=True).stdout
    if not data.startswith(b'\x89PNG\r\n\x1a\n'): raise ValueError(style+' did not return PNG')
    file = folder / (style+'.png')
    file.write_bytes(data)
    return {'id':style,'label':label,'src':'./assets/avatars/'+file.name,'source':url,
      'stylePage':'https://www.dicebear.com/styles/'+style+'/', 'license':'CC0-1.0',
      'licenseURL':'https://creativecommons.org/publicdomain/zero/1.0/',
      'licenseEvidence':'https://www.dicebear.com/licenses/'}
with ThreadPoolExecutor(max_workers=3) as pool:
    manifest = list(pool.map(download,items))
(folder / 'sources.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
script = '/* Curated local avatar files. Sources and CC0 notices: avatars/sources.json. */\nwindow.ChatAvatarPresets = '+json.dumps([{'id':a['id'],'label':a['label'],'src':a['src']} for a in manifest],ensure_ascii=False,indent=2)+';\n'
(root / 'dist/assets/avatars.js').write_text(script)
print('Downloaded',len(manifest),'avatars,',sum(p.stat().st_size for p in folder.glob('*.png')),'bytes')
