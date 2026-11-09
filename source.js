// Keep the ordered frame lists on GitHub Pages. Only the images themselves
// are requested from their archives while a film is playing.
let frameIndex;

export async function fetchFrameUrls(film, signal) {
  if (!frameIndex) {
    const response = await fetch(new URL('./frames.json', import.meta.url), {signal});
    if (!response.ok) throw new Error('Не удалось загрузить список кадров.');
    frameIndex = await response.json();
  }

  const gallery = frameIndex[film.id];
  if (!gallery) throw new Error('Диафильм отсутствует в списке кадров.');
  const {base, files, count, start = 1} = gallery;
  const names = files || Array.from({length: count}, (_, i) => (start + i) + '.jpg');
  return names.map(name => new URL(name, base).href);
}
