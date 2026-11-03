"""Save small catalogue previews from an early illustrated frame from each film."""
from concurrent.futures import ThreadPoolExecutor, as_completed
from html.parser import HTMLParser
from io import BytesIO
from pathlib import Path
from urllib.parse import urlencode, urljoin, urlparse
import json
import subprocess
import sys
import time
import tempfile
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / 'catalog.json'
COVERS = ROOT / 'covers'
CACHE = Path(tempfile.gettempdir()) / 'luch-cover-posts.json'


def fetch(url):
    for attempt in range(3):
        try:
            return subprocess.run(['curl', '--fail', '--silent', '--show-error', '--location', '--max-time', '40', url], check=True, capture_output=True).stdout
        except Exception:
            if attempt == 2:
                raise
            time.sleep(attempt + 1)


class Gallery(HTMLParser):
    def __init__(self):
        super().__init__()
        self.depth = 0
        self.gallery = 0
        self.urls = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'div':
            self.depth += 1
            if 'gallery-top' in attrs.get('class', '').split():
                self.gallery = self.depth
        if tag == 'img' and self.gallery:
            url = urljoin('https://www.hobobo.ru/', attrs.get('data-src') or attrs.get('src') or '')
            parts = urlparse(url)
            if parts.hostname in ('www.hobobo.ru', 'hobobo.ru') and parts.path.startswith('/assets/uploads/'):
                self.urls.append(url.replace('http://', 'https://', 1))

    def handle_endtag(self, tag):
        if tag == 'div':
            if self.depth == self.gallery:
                self.gallery = 0
            self.depth -= 1


def main():
    data = json.loads(CATALOG.read_text())
    films = data['films']
    posts = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    missing = [film['id'].split('-')[1] for film in films if film['id'] not in posts]
    for start in range(0, len(missing), 80):
        ids = missing[start:start + 80]
        query = urlencode({'include': ','.join(ids), 'per_page': 100, '_fields': 'id,content'})
        batch = json.loads(fetch('https://www.hobobo.ru/wp-json/wp/v2/posts?' + query))
        posts.update({'hobobo-' + str(post['id']): post['content']['rendered'] for post in batch})
        CACHE.write_text(json.dumps(posts))
        print(f'Gallery metadata: {len(posts)}/{len(films)}', flush=True)
    COVERS.mkdir(exist_ok=True)

    def cover(film):
        dest = COVERS / (film['id'] + '.webp')
        if not dest.exists() or '--refresh' in sys.argv:
            gallery = Gallery()
            gallery.feed(posts.get(film['id'], ''))
            urls = list(dict.fromkeys(gallery.urls))
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
