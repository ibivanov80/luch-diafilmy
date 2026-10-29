// Read only the film gallery. The source HTML is never added to the page.
export function extractFrameUrls(html) {
  const template = document.createElement('template');
  template.innerHTML = String(html);
  let images = [...template.content.querySelectorAll('.diafilm_block .gallery-top .swiper-slide img')];
  if (!images.length) images = [...template.content.querySelectorAll('.gallery-top .swiper-slide img')];
  if (!images.length) images = [...template.content.querySelectorAll('.diafilm_block .swiper-slide img')];
  const urls = images.flatMap(image => {
    const raw = image.getAttribute('data-src') || image.getAttribute('src');
    if (!raw) return [];
    try {
      const url = new URL(raw, 'https://www.hobobo.ru/');
      if (!['www.hobobo.ru', 'hobobo.ru'].includes(url.hostname)) return [];
      if (!['http:', 'https:'].includes(url.protocol)) return [];
      if (!url.pathname.startsWith('/assets/uploads/') || !/\.(jpe?g|png|webp|gif)$/i.test(url.pathname)) return [];
      url.protocol = 'https:';
      return [url.href];
    } catch { return []; }
  });
  return [...new Set(urls)];
}

export async function fetchFrameUrls(film, signal) {
  const match = /^hobobo-(\d+)$/.exec(film.id);
  if (!match) throw new Error('Некорректный номер диафильма.');
  const response = await fetch(`https://www.hobobo.ru/wp-json/wp/v2/posts/${match[1]}?_fields=id,content`, {
    signal, credentials: 'omit', referrerPolicy: 'no-referrer'
  });
  if (!response.ok) throw new Error('Источник временно не отвечает. Попробуйте ещё раз.');
  const post = await response.json();
  const urls = extractFrameUrls(post.content?.rendered || '');
  if (!urls.length) throw new Error('Не удалось найти кадры этого диафильма.');
  return urls;
}
