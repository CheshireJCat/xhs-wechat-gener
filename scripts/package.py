"""Build an offline ZIP with index.html at its root; Python standard library only."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import subprocess

root = Path(__file__).resolve().parent.parent
subprocess.run(['node', str(root / 'scripts/check.mjs')], cwd=root, check=True)
source = root / 'dist'
output = root / 'wechat-chat-minitool.zip'
allowed = {'.html', '.js', '.css', '.jpg', '.jpeg', '.png', '.webp', '.svg', '.gif', '.woff', '.woff2', '.json'}
files = sorted(path for path in source.rglob('*') if path.is_file())
assert (source / 'index.html').is_file(), 'Missing entry point'
assert all(path.suffix.lower() in allowed for path in files), 'Unsupported file type'
with ZipFile(output, 'w', ZIP_DEFLATED, compresslevel=9) as package:
    for path in files:
        package.write(path, path.relative_to(source).as_posix())
assert output.stat().st_size <= 10 * 1024 * 1024, 'ZIP exceeds 10 MiB'
with ZipFile(output) as package:
    assert 'index.html' in package.namelist()
    assert package.testzip() is None
print(f'{output.name}: {output.stat().st_size:,} bytes; {len(files)} files; ZIP integrity OK')
