// The index is served by Pages. The public Google Drive images load as needed.
let frameIndex;

export async function fetchFrameUrls(film, signal) {
  if (!frameIndex) {
    const response = await fetch(new URL('./frames.json?v=20261109-drive', import.meta.url), {signal});
    if (!response.ok) throw new Error('Не удалось загрузить список кадров.');
    frameIndex = await response.json();
  }

  const gallery = frameIndex[film.id];
  if (!gallery) throw new Error('Диафильм отсутствует в списке кадров.');
  const {base, files, count, start = 1} = gallery;
  const names = files || Array.from({length: count}, (_, i) => (start + i) + '.jpg');
  return names.map(name => new URL(name, base).href);
}
