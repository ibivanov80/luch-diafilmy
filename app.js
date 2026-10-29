import { fetchFrameUrls } from './source.js';
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const normalize = s => s.toLocaleLowerCase('ru').replaceAll('ё','е').normalize('NFC');
const naturalSort = (a,b) => a.name.localeCompare(b.name,'ru',{numeric:true,sensitivity:'base'});
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const write = (key,value) => { try { localStorage.setItem(key,JSON.stringify(value)); return true; } catch { toast('Браузер не разрешил сохранить изменения. Проверьте настройки хранения.'); return false; } };
let toastTimeout;
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>$('#toast').classList.remove('visible'),3600);}
const savedFavorites = read('luch-favorites-v1',[]);
let favorites = new Set(Array.isArray(savedFavorites)?savedFavorites:[]);
let progress = read('luch-progress-v1',{});
if(!progress || typeof progress!=='object' || Array.isArray(progress)) progress={};
let sourceFilms=[], localFilms=[], tab='catalog', filter='all', limit=24, db;
let activeFilm=null, activeIndex=0, frameUrls=[], renderGeneration=0, lastFocus=null, touchStart=null, wakeLock=null;
let selectedFiles=[];
let sortMode=read('luch-sort-v1','popular');
if(!['popular','title'].includes(sortMode))sortMode='popular';
let sourceRequest=null;
const sourceFrameCache=new Map();
const demo={id:'luch-demo-1',title:'Путешествие луча',kind:'demo',count:6};
const palettes=[['#dedac7','#626749'],['#d8dfd1','#536a56'],['#e8d3c0','#966449'],['#d6dde0','#5b6e76'],['#e4debd','#8d7c3c'],['#dcd4dc','#79637c'],['#d5d8c2','#69734c'],['#e4cfc6','#936c5e']];
const symbols=['☼','✳','❧','✦','☽','✧'];
function colorFor(id){let n=0;for(const c of id)n=(n*31+c.charCodeAt(0))>>>0;return {colors:palettes[n%palettes.length],symbol:symbols[n%symbols.length],n};}
function allFilms(){return [demo,...localFilms,...sourceFilms];}
function findFilm(id){return allFilms().find(f=>f.id===id);}
function isLocalFilm(f){return f.kind!=='source';}
function frameCount(f){return f.count||progress[f.id]?.count||1;}
function getProgress(f){const p=progress[f.id];return p && Number.isInteger(p.index) ? Math.max(0,Math.min(frameCount(f)-1,p.index)) : 0;}

async function openDatabase(){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open('luch-library',1);
    request.onupgradeneeded=()=>{request.result.createObjectStore('films',{keyPath:'id'});request.result.createObjectStore('frames');};
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
    request.onblocked=()=>reject(new Error('Закройте другие вкладки «Луча» и попробуйте снова.'));
  });
}
function dbRequest(store,key){return new Promise((resolve,reject)=>{if(!db)return reject(new Error('Хранилище недоступно'));const tx=db.transaction(store);const r=key===undefined?tx.objectStore(store).getAll():tx.objectStore(store).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function refreshLocal(){localFilms=(await dbRequest('films')).sort((a,b)=>b.createdAt-a.createdAt);}
function syncNav(){
  $$('[data-tab]').forEach(b=>{const selected=b.dataset.tab===tab;b.classList.toggle('active',selected);b.setAttribute('aria-current',selected?'page':'false');});
  $('#nav-count').textContent=allFilms().length;
  $('#favorite-count').textContent=favorites.size||'';
  const names={catalog:['ИСТОРИИ НА ПОЛКЕ','Все диафильмы'],favorites:['ОСТАВИТЬ НА СЛЕДУЮЩИЙ ВЕЧЕР','Избранное'],local:['СМОТРЕТЬ В «ЛУЧЕ»','Моя коллекция']};
  $('#library-kicker').textContent=names[tab][0];
  $('#library-title').innerHTML=`${names[tab][1]} <span id="result-count"></span>`;
  $('#hero').hidden=tab!=='catalog';
  $('.library-toolbar').hidden=tab==='local';
  $('#source-note').hidden=tab==='local';
}
function renderContinue(){
  const latest=Object.entries(progress).filter(([id])=>findFilm(id)).sort((a,b)=>(b[1].updatedAt||0)-(a[1].updatedAt||0))[0];
  $('#continue-section').hidden=!latest||tab==='favorites';
  if(latest){const f=findFilm(latest[0]);$('#continue-film').dataset.id=f.id;$('#continue-title').textContent=f.title;$('#continue-frame').textContent=`Кадр ${getProgress(f)+1} из ${frameCount(f)}`;}
}
function renderGrid(){
  syncNav();renderContinue();
  const query=normalize($('#search').value.trim());
  let films=allFilms().filter(f=>(tab!=='favorites'||favorites.has(f.id))&&(tab!=='local'||isLocalFilm(f))&&(tab==='local'||filter==='all'||(filter==='playable'?isLocalFilm(f):!isLocalFilm(f)))&&normalize(f.title).includes(query));
  films.sort((a,b)=>{if(sortMode==='popular'&&tab!=='local'){const diff=(b.rating??-1)-(a.rating??-1);if(diff)return diff;}return a.title.localeCompare(b.title,'ru',{numeric:true});});
  $('#result-count').textContent=films.length;
  $('#loading').hidden=true;
  $('#show-more').hidden=films.length<=limit;
  const visible=films.slice(0,limit);
  if(!visible.length){
    const title=query?'История пока не нашлась':tab==='favorites'?'Здесь будут любимые истории':'На этой полке пока тихо';
    const text=query?'Попробуйте другое название или сбросьте поиск.':tab==='favorites'?'Нажмите на звёздочку у диафильма, чтобы сохранить его.':'Добавьте свои кадры или попробуйте авторский пример.';
    $('#film-grid').innerHTML=`<div class="empty"><span class="empty-icon">✳</span><h3>${title}</h3><p>${text}</p>${query?'<button class="button secondary" id="clear-search">Сбросить поиск</button>':tab==='favorites'?'<button class="button secondary" data-tab="catalog">В каталог</button>':'<button class="button secondary import-trigger">Добавить диафильм</button>'}</div>`;return;
  }
  $('#film-grid').innerHTML=visible.map(f=>{
    const {colors:[bg,ink],symbol}=colorFor(f.id), local=isLocalFilm(f), p=progress[f.id];
    const rating=Number.isFinite(f.rating)?`<span class="rating" title="Рейтинг на 25 октября 2026 года" aria-label="Рейтинг: ${f.rating}">↑ ${f.rating.toLocaleString('ru-RU')}</span>`:'';
    const meta=f.kind==='source'?'Смотреть диафильм':f.kind==='demo'?'Авторский пример · 6 кадров':`Мой диафильм · ${f.count} кадров`;
    return `<article class="film-card" style="--cover:${bg};--cover-ink:${ink}" data-film="${esc(f.id)}">
      <button class="cover ${local?'local-cover':''}" data-open="${esc(f.id)}" aria-label="Смотреть: ${esc(f.title)}"><span class="cover-number">${local?'ЛУЧ / '+(f.kind==='demo'?'АВТОРСКИЙ ПРИМЕР':'ЛИЧНАЯ КОЛЛЕКЦИЯ'):'БИБЛИОТЕКА / ЛУЧ'}</span><span class="cover-shape" aria-hidden="true">${local?'✳':symbol}</span><span class="cover-title">${esc(f.title)}</span><span class="cover-play" aria-hidden="true">▶</span></button>
      <button class="favorite" data-favorite="${esc(f.id)}" aria-pressed="${favorites.has(f.id)}" aria-label="${favorites.has(f.id)?'Убрать из избранного':'В избранное'}: ${esc(f.title)}">${icon('star')}</button>
      <h3><button data-open="${esc(f.id)}">${esc(f.title)}</button></h3>
      <div class="card-meta"><span>${meta}</span>${rating||''}${f.kind==='local'?`<button class="delete-film" data-delete="${esc(f.id)}" aria-label="Удалить: ${esc(f.title)}">Удалить</button>`:''}</div>
      ${p?`<div class="progress-track" aria-label="Кадр ${getProgress(f)+1} из ${frameCount(f)}"><i style="width:${(getProgress(f)+1)/frameCount(f)*100}%"></i></div>`:''}</article>`;
  }).join('');
}
function setTab(next){tab=next;limit=24;$('#search').value='';history.replaceState(null,'','#'+next);renderGrid();}
function showInfo(html){$('#info-content').innerHTML=html;if(!$('#info-dialog').open)$('#info-dialog').showModal();}
function help(){showInfo(`<span class="eyebrow">МАЛЕНЬКАЯ ИНСТРУКЦИЯ</span><h2>Ваш домашний «Луч»</h2><p>Выберите историю в каталоге — кадры откроются прямо здесь. Для просмотра нужен интернет; изображения загружаются по мере перелистывания.</p><p><strong>Рейтинг.</strong> По умолчанию первыми показываются самые популярные диафильмы. Числовой рейтинг получен 25 октября 2026 года и не обновляется в реальном времени. Можно переключиться на алфавит.</p><p><strong>На компьютере.</strong> Листайте кнопками под кадром или стрелками клавиатуры. Пробел открывает следующий кадр, Home — первый, End — последний. Ползунок позволяет выбрать нужное место.</p><p><strong>На телефоне.</strong> Листайте свайпом или кнопками. Коснитесь центра изображения, чтобы скрыть управление и увеличить кадр. Ещё одно касание вернёт кнопки.</p><p>Панели управления расположены отдельно от изображения: нижние строки диафильма остаются видны и в вертикальной, и в горизонтальной ориентации.</p><div class="details-row"><strong>Продолжить.</strong> Последний кадр и избранное сохраняются в этом браузере на этом устройстве. Синхронизации между устройствами нет.</div><h2>Иконка на iPhone</h2><ol class="steps"><li>Откройте «Луч» в Safari.</li><li>Нажмите «Поделиться» → «На экран “Домой”».</li><li>Если доступно, включите «Открывать как веб-приложение» и нажмите «Добавить».</li></ol><p>Поверните телефон горизонтально для крупного изображения. На некоторых версиях iOS данные Safari и веб-приложения хранятся отдельно.</p>`);}
function airplay(){showInfo(`<span class="eyebrow">ВЕЧЕР НА БОЛЬШОМ ЭКРАНЕ</span><h2>Смотрим на Apple TV</h2><p>Для диафильмов используйте системный «Повтор экрана» iPhone. Эта кнопка открывает инструкцию; подключение выбирается в Пункте управления.</p><ol class="steps"><li>Подключите iPhone и Apple TV к одной сети Wi-Fi.</li><li>Откройте диафильм и поверните iPhone горизонтально. При необходимости выключите блокировку ориентации.</li><li>Смахните вниз от правого верхнего угла iPhone, нажмите <strong>«Повтор экрана»</strong> и выберите Apple TV.</li><li>Вернитесь к диафильму. Коснитесь центра кадра, чтобы скрыть кнопки; листайте свайпом.</li></ol><p>Передаётся весь экран телефона. Его пропорции могут оставлять поля на телевизоре. Для выхода откройте «Повтор экрана» → «Остановить повтор».</p><a class="text-link" href="https://support.apple.com/ru-ru/102661" target="_blank" rel="noopener noreferrer">Инструкция Apple ↗</a>`);}

function toggleFavorite(id){if(favorites.has(id))favorites.delete(id);else favorites.add(id);write('luch-favorites-v1',[...favorites]);renderGrid();toast(favorites.has(id)?'История в избранном':'История убрана из избранного');}

async function acquireWakeLock(){try{if('wakeLock' in navigator&&activeFilm)wakeLock=await navigator.wakeLock.request('screen');}catch{}}
function savePosition(){if(!activeFilm||!frameUrls.length)return;progress[activeFilm.id]={index:activeIndex,count:activeFilm.count,updatedAt:Date.now()};write('luch-progress-v1',progress);}
function releaseFrames(){frameUrls.forEach(u=>{if(u.startsWith('blob:'))URL.revokeObjectURL(u);});frameUrls=[];}
async function openFilm(id){
  const f=findFilm(id);if(!f)return;
  lastFocus=document.activeElement;
  if($('#info-dialog').open)$('#info-dialog').close();
  sourceRequest?.abort();
  const request=new AbortController();sourceRequest=request;
  releaseFrames();activeFilm=f;activeIndex=getProgress(f);renderGeneration++;
  $('#retry-frame').hidden=true;$('#viewer-title').textContent=f.title;$('#frame-range').max=frameCount(f);$('#frame-range').disabled=true;$('#frame-counter').textContent='… / …';$('#prev-frame').disabled=true;$('#next-frame').disabled=true;$('#end-message').hidden=true;$('#frame-error').hidden=true;$('#frame-image').removeAttribute('src');$('#frame-image').alt='';$('#frame-loading').textContent=f.kind==='source'?'Загружаем диафильм…':'Открываем диафильм…';$('#frame-loading').hidden=false;$('#viewer').classList.remove('hide-chrome');if(!$('#viewer').open)$('#viewer').showModal();document.body.classList.add('viewing');
  const timeout=setTimeout(()=>request.abort(new DOMException('Timeout','TimeoutError')),20000);
  try{
    if(f.kind==='source'){
      const urls=sourceFrameCache.get(f.id)||await fetchFrameUrls(f,request.signal);
      if(request.signal.aborted||sourceRequest!==request||!activeFilm)return;
      sourceFrameCache.set(f.id,urls);f.count=urls.length;frameUrls=[...urls];$('#frame-range').max=f.count;
    }
    else if(f.kind==='demo')frameUrls=Array.from({length:f.count},(_,i)=>`demo/frame-${i+1}.svg`);
    else{const blobs=await Promise.all(Array.from({length:f.count},(_,i)=>dbRequest('frames',`${f.id}:${i}`)));if(!blobs.every(b=>b instanceof Blob))throw new Error('Кадры не найдены в хранилище.');if(activeFilm?.id!==f.id)return;frameUrls=blobs.map(b=>URL.createObjectURL(b));}
    $('#frame-range').disabled=false;showFrame(activeIndex);acquireWakeLock();
  }catch(error){
    if(sourceRequest!==request||!activeFilm)return;
    $('#frame-loading').hidden=true;
    $('#frame-error').textContent=f.kind==='source'?'Не удалось загрузить диафильм. Проверьте интернет и нажмите «Повторить».':'Не удалось открыть сохранённые кадры. Добавьте диафильм заново.';
    $('#frame-error').hidden=false;$('#retry-frame').hidden=false;
  }finally{clearTimeout(timeout);}
}
async function showFrame(index){
  if(!activeFilm||!frameUrls.length)return;
  activeIndex=Math.min(Math.max(0,index),activeFilm.count-1);const generation=++renderGeneration;
  const img=$('#frame-image');$('#frame-loading').textContent='Открываем кадр…';$('#frame-loading').hidden=false;$('#frame-error').hidden=true;$('#retry-frame').hidden=true;
  img.alt=`${activeFilm.title}. Кадр ${activeIndex+1} из ${activeFilm.count}`;img.src=frameUrls[activeIndex];
  $('#frame-counter').textContent=`${String(activeIndex+1).padStart(2,'0')} / ${String(activeFilm.count).padStart(2,'0')}`;
  $('#frame-range').value=activeIndex+1;$('#prev-frame').disabled=activeIndex===0;$('#next-frame').disabled=activeIndex===activeFilm.count-1;$('#end-message').hidden=activeIndex!==activeFilm.count-1;
  savePosition();
  try{await img.decode();}catch{if(generation===renderGeneration){$('#frame-error').textContent='Кадр не загрузился. Проверьте интернет и попробуйте ещё раз.';$('#frame-error').hidden=false;$('#retry-frame').hidden=false;}}
  if(generation===renderGeneration)$('#frame-loading').hidden=true;
  if(frameUrls[activeIndex+1]){const prefetch=new Image();prefetch.referrerPolicy='no-referrer';prefetch.src=frameUrls[activeIndex+1];}
}
async function closeViewer(){
  if(!activeFilm)return;savePosition();renderGeneration++;activeFilm=null;
  sourceRequest?.abort();sourceRequest=null;$('#retry-frame').hidden=true;
  if(document.fullscreenElement){try{await document.exitFullscreen();}catch{}}
  $('#viewer').close();$('#frame-image').removeAttribute('src');document.body.classList.remove('viewing');
  try{await wakeLock?.release();}catch{}wakeLock=null;releaseFrames();renderGrid();if(lastFocus?.isConnected)lastFocus.focus();
}
async function fullscreen(){
  if(document.fullscreenElement){await document.exitFullscreen();return;}
  if($('#viewer').requestFullscreen){try{await $('#viewer').requestFullscreen();return;}catch{}}
  showInfo('<span class="eyebrow">НА ВЕСЬ ЭКРАН</span><h2>Больше места для истории</h2><p>В этом браузере полноэкранный режим для изображений недоступен. На iPhone добавьте «Луч» на экран «Домой» и открывайте через иконку. Поверните телефон горизонтально и коснитесь центра кадра, чтобы скрыть кнопки.</p><button class="button dark" data-close>Вернуться к просмотру</button>');
}
function openImport(){
  if(!db){showInfo('<h2>Хранилище недоступно</h2><p>Откройте «Луч» в обычном режиме Safari и разрешите сайту хранить данные. Каталог и авторский пример доступны без импорта.</p>');return;}
  $('#import-form').reset();selectedFiles=[];$('#import-summary').textContent='Кадры будут идти по имени файла: 1, 2, 3…';$('#import-order').innerHTML='';$('#import-error').textContent='';$('#import-dialog').showModal();
}
function renderOrder(){
  $('#import-order').innerHTML=selectedFiles.map((f,i)=>`<div><span>${i+1}. ${esc(f.name)}</span><button type="button" data-move="${i}" data-direction="-1" ${i===0?'disabled':''} aria-label="Кадр ${i+1} выше">↑</button><button type="button" data-move="${i}" data-direction="1" ${i===selectedFiles.length-1?'disabled':''} aria-label="Кадр ${i+1} ниже">↓</button></div>`).join('');
  $('#import-summary').textContent=selectedFiles.length?`${selectedFiles.length} кадров · ${(selectedFiles.reduce((s,f)=>s+f.size,0)/1024/1024).toFixed(1)} МБ. Проверьте порядок; его можно изменить стрелками.`:'Кадры не выбраны.';
}
async function validateImage(file){const url=URL.createObjectURL(file);try{const img=new Image();img.src=url;await img.decode();if(!img.naturalWidth)throw new Error('bad image');}finally{URL.revokeObjectURL(url);}}
async function importFilm(event){
  event.preventDefault();const title=$('#film-title').value.trim(), files=[...selectedFiles];
  const fail=m=>{$('#import-error').textContent=m;};
  if(!title)return fail('Введите название диафильма.');
  if(!files.length)return fail('Выберите хотя бы один кадр.');
  if(files.length>150)return fail('Выберите не больше 150 кадров за один раз.');
  if(files.some(f=>f.size>15*1024*1024)||files.reduce((s,f)=>s+f.size,0)>60*1024*1024)return fail('Слишком большой диафильм: до 60 МБ в сумме и до 15 МБ на кадр.');
  const submit=$('#import-submit');submit.disabled=true;submit.textContent='Проверяем и сохраняем…';$('#import-error').textContent='';
  try{
    for(const file of files)await validateImage(file);
    const f={id:'local-'+crypto.randomUUID(),kind:'local',title,count:files.length,createdAt:Date.now()};
    await new Promise((resolve,reject)=>{const tx=db.transaction(['films','frames'],'readwrite');tx.objectStore('films').put(f);files.forEach((file,i)=>tx.objectStore('frames').put(file,`${f.id}:${i}`));tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
    await refreshLocal();$('#import-dialog').close();tab='local';renderGrid();toast('Диафильм сохранён на этом устройстве');openFilm(f.id);
  }catch(e){fail(e?.name==='QuotaExceededError'?'На устройстве не хватает места. Удалите ненужные диафильмы или выберите меньше кадров.':'Не удалось сохранить диафильм. Проверьте, что все файлы — исправные JPG, PNG или WebP, и разрешено хранение данных.');}
  finally{submit.disabled=false;submit.innerHTML='Добавить и смотреть <span>↗</span>';}
}
function askDelete(id){const f=findFilm(id);if(!f||f.kind!=='local')return;showInfo(`<span class="eyebrow">МОЯ КОЛЛЕКЦИЯ</span><h2>Удалить диафильм?</h2><p>«${esc(f.title)}» и его кадры будут удалены из коллекции этого браузера. Исходные файлы на устройстве сохранятся.</p><button class="button dark" data-confirm-delete="${esc(id)}">Удалить из «Луча»</button><button class="button secondary" data-close>Оставить</button>`);}
async function deleteFilm(id){const f=findFilm(id);if(!f||f.kind!=='local')return;try{await new Promise((resolve,reject)=>{const tx=db.transaction(['films','frames'],'readwrite');tx.objectStore('films').delete(id);for(let i=0;i<f.count;i++)tx.objectStore('frames').delete(`${id}:${i}`);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});favorites.delete(id);delete progress[id];write('luch-favorites-v1',[...favorites]);write('luch-progress-v1',progress);await refreshLocal();$('#info-dialog').close();renderGrid();toast('Диафильм удалён');}catch{toast('Не удалось удалить диафильм. Попробуйте ещё раз.');}}

document.addEventListener('click',e=>{
  const b=e.target.closest('button,a');if(!b)return;
  if(b.matches('[data-tab]'))setTab(b.dataset.tab);
  else if(b.matches('[data-filter]')){filter=b.dataset.filter;limit=24;$$('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));renderGrid();}
  else if(b.matches('[data-favorite]'))toggleFavorite(b.dataset.favorite);
  else if(b.matches('[data-open]'))openFilm(b.dataset.open);
  else if(b.matches('.help-trigger'))help();
  else if(b.matches('.airplay-trigger'))airplay();
  else if(b.matches('.import-trigger'))openImport();
  else if(b.matches('[data-close]'))b.closest('dialog').close();
  else if(b.matches('[data-delete]'))askDelete(b.dataset.delete);
  else if(b.matches('[data-confirm-delete]'))deleteFilm(b.dataset.confirmDelete);
  else if(b.matches('[data-move]')){const i=+b.dataset.move,j=i+(+b.dataset.direction);if(j>=0&&j<selectedFiles.length){[selectedFiles[i],selectedFiles[j]]=[selectedFiles[j],selectedFiles[i]];renderOrder();}}
  else if(b.id==='clear-search'){$('#search').value='';limit=24;renderGrid();}
});
$('#search').addEventListener('input',()=>{limit=24;renderGrid();});
$('#show-more').addEventListener('click',()=>{limit+=24;renderGrid();});
$('#demo-start').addEventListener('click',()=>{const top=[...sourceFilms].sort((a,b)=>(b.rating||0)-(a.rating||0))[0];openFilm(top?.id||demo.id);});
$('#sort').value=sortMode;
$('#sort').addEventListener('change',e=>{sortMode=e.target.value;write('luch-sort-v1',sortMode);limit=24;renderGrid();});
$('#retry-frame').addEventListener('click',()=>{if(activeFilm){if(frameUrls.length)showFrame(activeIndex);else openFilm(activeFilm.id);}});
$('#continue-film').addEventListener('click',e=>openFilm(e.currentTarget.dataset.id));
$('#close-viewer').addEventListener('click',closeViewer);
$('#viewer').addEventListener('cancel',e=>{e.preventDefault();closeViewer();});
$('#prev-frame').addEventListener('click',()=>showFrame(activeIndex-1));
$('#next-frame').addEventListener('click',()=>showFrame(activeIndex+1));
$('#frame-range').addEventListener('input',e=>showFrame(+e.target.value-1));
$('#restart-film').addEventListener('click',()=>showFrame(0));
$('#fullscreen').addEventListener('click',fullscreen);
$('#viewer-stage').addEventListener('click',e=>{if(e.target.closest('button'))return;$('#viewer').classList.toggle('hide-chrome');});
$('#viewer-stage').addEventListener('touchstart',e=>{if(e.touches.length===1&&!e.target.closest('button'))touchStart={x:e.touches[0].clientX,y:e.touches[0].clientY};else touchStart=null;},{passive:true});
$('#viewer-stage').addEventListener('touchend',e=>{if(!touchStart||!e.changedTouches.length)return;const dx=e.changedTouches[0].clientX-touchStart.x,dy=e.changedTouches[0].clientY-touchStart.y;touchStart=null;if(Math.abs(dx)>45&&Math.abs(dx)>Math.abs(dy)*1.5){showFrame(activeIndex+(dx<0?1:-1));}},{passive:true});
$('#film-files').addEventListener('change',e=>{selectedFiles=[...e.target.files].sort(naturalSort);renderOrder();});
$('#import-form').addEventListener('submit',importFilm);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&activeFilm)acquireWakeLock();});
document.addEventListener('keydown',e=>{
  if($('#info-dialog').open||$('#import-dialog').open)return;
  if(activeFilm){if(['ArrowRight',' ','ArrowLeft','Home','End'].includes(e.key)){e.preventDefault();showFrame(e.key==='Home'?0:e.key==='End'?activeFilm.count-1:activeIndex+(e.key==='ArrowLeft'?-1:1));}return;}
  if(e.key==='/'&&!e.target.matches('input,textarea')){e.preventDefault();$('#search').focus();}
});
for(const dialog of $$('.modal'))dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
if(['catalog','local','favorites'].includes(location.hash.slice(1)))tab=location.hash.slice(1);
async function init(){
  const results=await Promise.allSettled([fetch('catalog.json').then(r=>{if(!r.ok)throw new Error('catalog');return r.json();}),openDatabase()]);
  if(results[0].status==='fulfilled')sourceFilms=results[0].value.films.filter(f=>f.kind==='source'&&/^https:\/\/www\.hobobo\.ru\/diafilmy\//.test(f.url));
  if(results[1].status==='fulfilled'){db=results[1].value;try{await refreshLocal();}catch{db=null;}}
  renderGrid();if(results[0].status==='rejected'){$('#source-note p').textContent='Каталог не загрузился. Проверьте интернет и обновите страницу. Ваша коллекция доступна.';}
}
init();
