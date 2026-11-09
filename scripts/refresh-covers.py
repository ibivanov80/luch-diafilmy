"""Save small catalogue previews from an early illustrated frame from each film."""
from concurrent.futures import ThreadPoolExecutor, as_completed
from io import BytesIO
from pathlib import Path
from urllib.parse import urljoin
import json
import subprocess
import sys
import time
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / 'catalog.json'
COVERS = ROOT / 'covers'
FRAME_INDEX = ROOT / 'frames.json'


def fetch(url):
    for attempt in range(3):
        try:
            return subprocess.run(['curl', '--fail', '--silent', '--show-error', '--location', '--max-time', '40', url], check=True, capture_output=True).stdout
        except Exception:
            if attempt == 2:
                raise
            time.sleep(attempt + 1)


def main():
    data = json.loads(CATALOG.read_text())
    films = data['films']
    galleries = json.loads(FRAME_INDEX.read_text())
    COVERS.mkdir(exist_ok=True)

    def cover(film):
        dest = COVERS / (film['id'] + '.webp')
        if not dest.exists() or '--refresh' in sys.argv:
            gallery = galleries[film['id']]
            start = gallery.get('start', 1)
            names = gallery.get('files') or [f'{i}.jpg' for i in range(start, start + gallery['count'])]
            urls = [urljoin(gallery['base'], name) for name in names]
            if not urls:
                raise ValueError('No gallery: ' + film['id'])
            # Skip title/credit and calibration frames so children can see the characters.
            start = min(3, len(urls) - 1)
            candidates = urls[start:start + 3] + urls[:1]
            for url in candidates:
                try:
                    with Image.open(BytesIO(fetch(url))) as source:
                        image = ImageOps.exif_transpose(source).convert('RGB')
                        image.thumbnail((560, 420), Image.Resampling.LANCZOS)
                        image.save(dest, 'WEBP', quality=80, method=6)
                    break
                except Exception:
                    if url == candidates[-1]:
                        raise
        film['cover'] = 'covers/' + dest.name
        return film['id']

    failures = []
    with ThreadPoolExecutor(max_workers=6) as pool:
        tasks = {pool.submit(cover, film): film for film in films}
        for count, task in enumerate(as_completed(tasks), 1):
            try:
                task.result()
            except Exception as error:
                failures.append({'id': tasks[task]['id'], 'error': str(error)})
            if count % 50 == 0 or count == len(films):
                print(f'Previews: {count}/{len(films)}; errors: {len(failures)}', flush=True)
    if failures:
        print(json.dumps(failures, ensure_ascii=False), flush=True)
        raise SystemExit(1)
    CATALOG.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')
    print(f'Saved {len(films)} previews, {sum(p.stat().st_size for p in COVERS.iterdir()) / 1024 / 1024:.1f} MB', flush=True)


if __name__ == '__main__':
    main()
