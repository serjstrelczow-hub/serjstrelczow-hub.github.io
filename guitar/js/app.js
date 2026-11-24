import { Chords, ChordText, Capo, Notes, Tunings, TunerLogic, InTuneTracker, ChordShapes, ScrollMath, RUSSIAN, INTERNATIONAL, AUTO, SHARPS, FLATS } from './music.js';
import { Sources, setProxies, songId, hasProxy } from './sources.js';
import { SongDb } from './db.js';
import { StringPlayer, TunerEngine, Metronome, audioCtx } from './audio.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const params = new URLSearchParams(location.search);
const TEST_TONE = parseFloat(params.get('testtone') || '0') || 0;

// ---------- Настройки
const DEFAULTS = { theme: 0, notation: RUSSIAN, accidentals: AUTO, fontSize: 16, scrollRate: 1, countdown: 3, a4: 440, instrumentId: 'guitar6',
  tuningName: 'Стандартный (E)', customTunings: [], keepScreenOn: true, srcAmdm: true, srcMychords: true, customProxy: '', repeat: false,
  metroBpm: 100, metroBeats: 4, metroAccent: true };
const S = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem('settings') || '{}'));
const saveS = () => localStorage.setItem('settings', JSON.stringify(S));
function applyTheme() { document.documentElement.dataset.theme = S.theme === 1 ? 'light' : S.theme === 2 ? 'dark' : ''; }
applyTheme();

let remoteProxies = [];
function updateProxies() { setProxies([S.customProxy.trim(), ...remoteProxies]); }
fetch('proxy.json', { cache: 'no-store' }).then(r => r.json()).then(j => { remoteProxies = j.proxies || []; localStorage.setItem('proxyCache', JSON.stringify(remoteProxies)); updateProxies(); })
  .catch(() => { remoteProxies = JSON.parse(localStorage.getItem('proxyCache') || '[]'); updateProxies(); });
updateProxies();

// ---------- Общие элементы
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200);
}
function modal(html, onClick) {
  const m = $('#modal'); m.innerHTML = `<div class="sheet">${html}</div>`; m.hidden = false;
  m.onclick = e => { if (e.target === m) closeModal(); else onClick?.(e); };
}
function closeModal() { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; }
function confirmBox(text, okLabel, ok) {
  modal(`<p class="dlg-text">${text}</p><div class="row end"><button class="btn" data-x="no">Отмена</button><button class="btn danger" data-x="ok">${okLabel}</button></div>`,
    e => { const x = e.target.closest('[data-x]')?.dataset.x; if (x === 'no') closeModal(); if (x === 'ok') { closeModal(); ok(); } });
}

let tab = 'search';
const tabs = [['search', '🔎', 'Поиск'], ['library', '📚', 'Мои песни'], ['fav', '★', 'Избранное'], ['tuner', '🎸', 'Тюнер'], ['metro', '⏱', 'Метроном']];
function renderTabs() {
  $('#tabs').innerHTML = tabs.map(([id, ic, label]) => `<button class="tab ${tab === id ? 'on' : ''}" data-tab="${id}"><span class="ic">${ic}</span><span>${label}</span></button>`).join('');
}
$('#tabs').onclick = e => { const b = e.target.closest('[data-tab]'); if (b) go(b.dataset.tab); };
function go(t) {
  if (tab === 'tuner' && t !== 'tuner') stopTuner();
  tab = t; renderTabs(); render();
}
function render() {
  const main = $('#main'); main.scrollTop = 0;
  ({ search: renderSearch, library: () => renderLibrary(false), fav: () => renderLibrary(true), tuner: renderTuner, metro: renderMetro, settings: renderSettings })[tab]();
}
const header = (title, extra = '') => `<header class="bar"><h1>${title}</h1><div class="bar-actions">${extra}<button class="icon" data-act="settings" aria-label="Настройки">⚙︎</button></div></header>`;
document.addEventListener('click', e => { if (e.target.closest('[data-act=settings]')) { prevTab = tab; tab = 'settings'; renderTabs(); render(); } });
let prevTab = 'search';

// ---------- Песни: сохранённые
let songsCache = [];
async function loadSongs() { songsCache = await SongDb.all(); return songsCache; }
const savedById = id => songsCache.find(s => s.id === id);
async function toggleFavorite(song) {
  let s = savedById(song.id);
  if (!s) { s = { ...song, transpose: 0, favorite: true, savedAt: Date.now() }; await SongDb.put(s); await loadSongs(); toast(`«${song.title}» сохранена в избранное`); return true; }
  s.favorite = !s.favorite; await SongDb.put(s); await loadSongs(); toast(s.favorite ? 'Добавлено в избранное' : 'Убрано из избранного'); return s.favorite;
}

// ---------- Поиск
let search = { q: '', results: null, loading: false, errors: [] };
function renderSearch() {
  const r = search.results;
  $('#main').innerHTML = header('Поиск аккордов') + `
  <form class="search" id="searchForm"><input id="q" type="search" enterkeyhint="search" placeholder="Исполнитель или название песни" value="${esc(search.q)}" autocomplete="off">
  <button class="btn primary" type="submit">Найти</button></form>
  <div class="list" id="results">${search.loading ? '<div class="spinner"></div>' :
    r == null ? `<p class="hint">Ищем на amdm.ru и mychords.net. Найденную песню можно сохранить — она будет доступна без интернета во вкладке «Мои песни».</p>` :
    (search.errors.map(e => `<p class="error">${esc(e)}</p>`).join('') + (r.length ? r.map(resultRow).join('') : '<p class="hint">Ничего не найдено. Попробуйте другое написание или только название песни.</p>'))}</div>`;
  $('#searchForm').onsubmit = e => { e.preventDefault(); doSearch($('#q').value); };
  $('#results').onclick = async e => {
    const star = e.target.closest('[data-star]'); const row = e.target.closest('[data-url]');
    if (!row) return; const item = search.results.find(x => x.url === row.dataset.url);
    if (star) {
      e.stopPropagation(); star.disabled = true;
      try {
        const saved = savedById(songId(item.url));
        const song = saved || await Sources.forUrl(item.url).fetchSong(item.url);
        await toggleFavorite(song); renderSearch();
      } catch (err) { toast('Не удалось сохранить: ' + err.message); star.disabled = false; }
      return;
    }
    openSong({ url: item.url, title: item.title, artist: item.artist });
  };
}
function resultRow(x) {
  const saved = savedById(songId(x.url));
  return `<div class="item" data-url="${esc(x.url)}"><div class="grow"><div class="t">${esc(x.title)}</div><div class="s">${esc(x.artist)} · ${esc(x.source)}${saved ? ' · сохранена' : ''}</div></div>
  <button class="star ${saved?.favorite ? 'on' : ''}" data-star aria-label="${saved?.favorite ? 'Убрать из избранного' : 'В избранное'}">${saved?.favorite ? '★' : '☆'}</button></div>`;
}
async function doSearch(q) {
  q = q.trim(); search.q = q;
  if (q.length < 2) { toast('Введите хотя бы 2 символа'); return; }
  if (!hasProxy()) {
    search.results = []; search.errors = ['Поиск в интернете ещё не подключён: для него нужен сервер-посредник (см. Настройки → «Сервер для поиска»). Тюнер, метроном и сохранённые песни работают и без него, а песню можно добавить вручную: «Мои песни» → ＋.'];
    renderSearch(); return;
  }
  search.loading = true; search.errors = []; renderSearch(); $('#q').blur();
  const srcs = Sources.all.filter(s => (s.id === 'amdm' ? S.srcAmdm : S.srcMychords));
  const res = await Promise.allSettled(srcs.map(s => s.search(q)));
  const lists = [];
  res.forEach((r, i) => { if (r.status === 'fulfilled') lists.push(r.value); else search.errors.push(`${srcs[i].title}: ${r.reason?.message || r.reason}`); });
  // чередуем результаты сайтов, чтобы были видны оба
  const out = []; for (let i = 0; i < Math.max(0, ...lists.map(l => l.length)); i++) lists.forEach(l => l[i] && out.push(l[i]));
  search.results = out; search.loading = false; if (tab === 'search') renderSearch();
}

// ---------- Библиотека / избранное
let libFilter = '';
async function renderLibrary(favOnly) {
  await loadSongs();
  const all = favOnly ? songsCache.filter(s => s.favorite) : songsCache;
  const f = libFilter.toLowerCase();
  const list = f ? all.filter(s => (s.artist + ' ' + s.title).toLowerCase().includes(f)) : all;
  const favCount = songsCache.filter(s => s.favorite).length;
  $('#main').innerHTML = header(favOnly ? `★ Избранное (${favCount})` : `Мои песни (${songsCache.length})`, favOnly ? '' : '<button class="icon" data-add aria-label="Добавить">＋</button>') + `
  ${all.length ? `<div class="search"><input id="flt" type="search" placeholder="Фильтр" value="${esc(libFilter)}"></div>` : ''}
  <div class="list" id="lib">${!all.length ? `<p class="hint">${favOnly ? 'В избранном пока пусто. Нажмите ☆ у песни — здесь, в поиске или на экране песни.' :
    'Здесь появятся сохранённые песни. Найдите песню во вкладке «Поиск» и нажмите ☆ или «Сохранить», или добавьте свою кнопкой ＋.'}</p>` :
    !list.length ? '<p class="hint">Нет песен по выбранному фильтру.</p>' :
    list.map(s => `<div class="item" data-id="${esc(s.id)}"><div class="grow"><div class="t">${esc(s.title)}</div><div class="s">${esc(s.artist || 'Без исполнителя')}${s.url ? '' : ' · своя'}${s.transpose ? ` · тон ${s.transpose > 0 ? '+' : ''}${s.transpose}` : ''}</div></div>
    <button class="star ${s.favorite ? 'on' : ''}" data-star>${s.favorite ? '★' : '☆'}</button><button class="icon del" data-del aria-label="Удалить">🗑</button></div>`).join('')}</div>`;
  const flt = $('#flt'); if (flt) flt.oninput = () => { libFilter = flt.value; const pos = flt.selectionStart; renderLibrary(favOnly).then(() => { const n = $('#flt'); n.focus(); n.setSelectionRange(pos, pos); }); };
  $('[data-add]')?.addEventListener('click', addOwnSong);
  $('#lib').onclick = async e => {
    const row = e.target.closest('[data-id]'); if (!row) return; const s = savedById(row.dataset.id);
    if (e.target.closest('[data-star]')) { await toggleFavorite(s); renderLibrary(favOnly); return; }
    if (e.target.closest('[data-del]')) { confirmBox(`«${esc(s.artist)} — ${esc(s.title)}» будет удалена из памяти телефона.`, 'Удалить', async () => { await SongDb.remove(s.id); renderLibrary(favOnly); }); return; }
    openSong(s);
  };
}
function addOwnSong() {
  modal(`<h2>Своя песня</h2><input id="oa" placeholder="Исполнитель"><input id="ot" placeholder="Название"><textarea id="ox" rows="10" placeholder="Текст с аккордами"></textarea>
  <p class="small">Строки, состоящие только из аккордов (Am  F  C  G), распознаются автоматически</p>
  <div class="row end"><button class="btn" data-x="no">Отмена</button><button class="btn primary" data-x="ok">Сохранить</button></div>`, async e => {
    const x = e.target.closest('[data-x]')?.dataset.x; if (x === 'no') closeModal();
    if (x === 'ok') {
      const title = $('#ot').value.trim() || 'Без названия', text = ChordText.autoMark($('#ox').value);
      const notation = Chords.inferNotation(ChordText.uniqueChords(text), S.notation);
      await SongDb.put({ id: 'own-' + Date.now(), artist: $('#oa').value.trim(), title, url: '', source: 'своя', text, notation, transpose: 0, favorite: false, savedAt: Date.now() });
      closeModal(); renderLibrary(false);
    }
  });
}

// ---------- Экран песни
let cur = null; // { song, saved, shift, rate, playing, hideKeys }
let scrollRaf = 0, lastTs = 0, countdownTimer = 0, wakeLock = null, scrollAcc = 0;
async function openSong(ref) {
  await loadSongs();
  const scr = $('#song'); scr.hidden = false; document.body.classList.add('song-open');
  scr.innerHTML = `<header class="bar"><button class="icon" data-s="back" aria-label="Назад">‹</button><h1 class="small-title">${esc(ref.title || '')}<span>${esc(ref.artist || '')}</span></h1></header><div class="spinner"></div>`;
  scr.onclick = e => { if (e.target.closest('[data-s=back]')) closeSong(); };
  let song = ref.id ? savedById(ref.id) : savedById(songId(ref.url));
  if (!song) {
    try { song = await Sources.forUrl(ref.url).fetchSong(ref.url); }
    catch (e) { scr.innerHTML += `<p class="error pad">Не удалось разобрать страницу: ${esc(e.message)}</p>`; return; }
  }
  cur = { song, shift: song.transpose || 0, rate: song.scrollRate || S.scrollRate, playing: false, hideKeys: false };
  renderSong(); requestWake();
}
function closeSong() { stopScroll(); releaseWake(); $('#song').hidden = true; $('#song').innerHTML = ''; document.body.classList.remove('song-open'); cur = null; render(); }
async function persistCur(extra = {}) {
  const saved = savedById(cur.song.id); if (!saved) return;
  Object.assign(saved, { transpose: cur.shift, scrollRate: cur.rate }, extra); await SongDb.put(saved);
}
function songTextHtml() {
  const { song, shift } = cur; const out = S.notation;
  return song.text.split('\n').map(line => ChordText.renderLine(line, shift, song.notation, S.accidentals, out)
    .map(p => p.text != null ? esc(p.text) : `<b class="ch" data-ch="${esc(p.shown)}">${esc(p.shown)}</b>`).join('')).join('\n');
}
function keyBarHtml() {
  const { song, shift } = cur; const chords = ChordText.uniqueChords(song.text);
  const sug = Capo.suggest(chords, shift, song.notation);
  let capo = '';
  if (sug && sug.capo > 0) {
    const shown = chords.slice(0, 5).map(c => Chords.transpose(c, sug.shift, song.notation, S.accidentals, S.notation)).join(' ');
    capo = `<div class="capo">💡 Капо ${sug.capo}: ${esc(shown)} <button class="link" data-s="capo" data-capo="${sug.capo}">Применить</button></div>`;
  }
  const chips = chords.map(c => Chords.transpose(c, shift, song.notation, S.accidentals, S.notation)).filter((v, i, a) => a.indexOf(v) === i)
    .map(c => `<b class="chip ch" data-ch="${esc(c)}">${esc(c)}</b>`).join('');
  return `<div class="keys"><span>Тон:</span><button class="btn sm" data-s="down" aria-label="Ниже на полтона">−½</button><b class="shift">${shift > 0 ? '+' : ''}${shift}</b>
    <button class="btn sm" data-s="up" aria-label="Выше на полтона">+½</button><button class="btn sm ghost" data-s="reset">Сброс</button>
    <span class="grow"></span><button class="btn sm ghost" data-s="fontm">A−</button><button class="btn sm ghost" data-s="fontp">A+</button></div>${capo}<div class="chips">${chips}</div>`;
}
function renderSong() {
  const { song } = cur; const saved = savedById(song.id);
  const scr = $('#song');
  scr.innerHTML = `<header class="bar"><button class="icon" data-s="back" aria-label="Назад">‹</button><h1 class="small-title">${esc(song.title)}<span>${esc(song.artist)}${song.source ? ' · ' + esc(song.source) : ''}</span></h1>
    <div class="bar-actions"><button class="icon" data-s="copy" aria-label="Копировать">📋</button>${saved ? '' : '<button class="icon" data-s="save" aria-label="Сохранить">💾</button>'}
    <button class="star big ${saved?.favorite ? 'on' : ''}" data-s="fav" aria-label="${saved?.favorite ? 'Убрать из избранного' : 'В избранное'}">${saved?.favorite ? '★' : '☆'}</button></div></header>
  <div id="keybar" ${cur.hideKeys ? 'hidden' : ''}>${keyBarHtml()}</div>
  <div id="songBody" class="songbody"><pre id="songText" style="font-size:${S.fontSize}px">${songTextHtml()}</pre><div class="endpad"></div></div>
  <button id="playBtn" class="fab" data-s="play" aria-label="Запустить прокрутку">▶</button>
  <div id="countdown" hidden></div>
  <div class="speedbar"><button class="btn sm" data-s="slower" aria-label="Медленнее">−</button>
    <input id="rate" type="range" min="0.25" max="3" step="0.05" value="${cur.rate}"><button class="btn sm" data-s="faster" aria-label="Быстрее">+</button>
    <span id="rateLbl" class="rate">${ScrollMath.label(cur.rate)}</span><button class="icon" data-s="keys" aria-label="${cur.hideKeys ? 'Показать панель тональности' : 'Скрыть панель тональности'}">⛶</button></div>
  <div id="remain" class="remain"></div>`;
  scr.onclick = onSongClick;
  $('#rate').oninput = e => setRate(parseFloat(e.target.value));
  $('#songBody').addEventListener('scroll', updateRemain, { passive: true });
  updatePlayBtn(); updateRemain();
}
function setRate(v) { cur.rate = ScrollMath.clamp(v); $('#rate').value = cur.rate; $('#rateLbl').textContent = ScrollMath.label(cur.rate); updateRemain(); clearTimeout(setRate.t); setRate.t = setTimeout(() => persistCur(), 400); }
async function onSongClick(e) {
  const a = e.target.closest('[data-s]')?.dataset.s;
  const ch = e.target.closest('[data-ch]');
  if (ch) { showChord(ch.dataset.ch); return; }
  if (!a) { if (e.target.closest('#songBody')) togglePlay(); return; }
  const { song } = cur;
  switch (a) {
    case 'back': closeSong(); break;
    case 'up': case 'down': cur.shift = Math.max(-11, Math.min(11, cur.shift + (a === 'up' ? 1 : -1))); refreshText(); persistCur(); break;
    case 'reset': cur.shift = 0; refreshText(); persistCur(); break;
    case 'capo': cur.shift = cur.shift - parseInt(e.target.dataset.capo); refreshText(); persistCur(); toast(`Наденьте каподастр на ${e.target.dataset.capo} лад`); break;
    case 'fontm': case 'fontp': S.fontSize = Math.max(11, Math.min(30, S.fontSize + (a === 'fontp' ? 1 : -1))); saveS(); $('#songText').style.fontSize = S.fontSize + 'px'; updateRemain(); break;
    case 'save': await SongDb.put({ ...song, transpose: cur.shift, scrollRate: cur.rate, favorite: false, savedAt: Date.now() }); await loadSongs(); toast('Песня сохранена в «Мои песни»'); renderSongKeep(); break;
    case 'fav': {
      const had = savedById(song.id); const on = await toggleFavorite(song);
      if (!had) { await persistCur(); toast('Сохранено и добавлено в избранное'); }
      renderSongKeep(); break;
    }
    case 'copy': {
      const txt = `${song.artist} — ${song.title}\n\n` + ChordText.transposeText(song.text, cur.shift, song.notation, S.accidentals, S.notation);
      try { await navigator.clipboard.writeText(txt); toast('Текст с аккордами скопирован'); } catch { toast('Не удалось скопировать'); } break;
    }
    case 'play': togglePlay(); break;
    case 'slower': setRate(ScrollMath.minus(cur.rate)); break;
    case 'faster': setRate(ScrollMath.plus(cur.rate)); break;
    case 'keys': cur.hideKeys = !cur.hideKeys; $('#keybar').hidden = cur.hideKeys; break;
  }
}
function renderSongKeep() { const top = $('#songBody').scrollTop; const playing = cur.playing; renderSong(); $('#songBody').scrollTop = top; if (playing) updatePlayBtn(); }
function refreshText() { $('#songText').innerHTML = songTextHtml(); $('#keybar').innerHTML = keyBarHtml(); }
function lineHeightPx() { return parseFloat(getComputedStyle($('#songText')).lineHeight) || S.fontSize * 1.35; }
function pxPerSec() { return lineHeightPx() * ScrollMath.LINES_PER_SEC * cur.rate; }
function updateRemain() {
  if (!cur || !$('#songBody')) return; const b = $('#songBody');
  const rem = Math.max(0, b.scrollHeight - b.clientHeight - b.scrollTop);
  $('#remain').textContent = (cur.playing ? 'идёт • ' : '') + '≈ ' + ScrollMath.mmss(Math.round(rem / pxPerSec())) + ' до конца';
}
function updatePlayBtn() { const b = $('#playBtn'); if (!b) return; b.textContent = cur.playing || countdownTimer ? '⏸' : '▶'; b.classList.toggle('on', cur.playing); b.setAttribute('aria-label', cur.playing ? 'Пауза' : 'Запустить прокрутку'); }
function togglePlay() {
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = 0; $('#countdown').hidden = true; updatePlayBtn(); return; }
  if (cur.playing) { stopScroll(); return; }
  const b = $('#songBody'); if (b.scrollTop >= b.scrollHeight - b.clientHeight - 2) b.scrollTop = 0;
  let n = S.countdown;
  if (n <= 0) return startScroll();
  const cd = $('#countdown'); cd.hidden = false; cd.textContent = n; updatePlayBtn();
  countdownTimer = setInterval(() => {
    n--; if (n > 0) { cd.textContent = n; return; }
    clearInterval(countdownTimer); countdownTimer = 0; cd.hidden = true; startScroll();
  }, 1000);
  countdownTimer = countdownTimer || 1; updatePlayBtn();
}
function startScroll() {
  cur.playing = true; updatePlayBtn(); lastTs = 0; scrollAcc = 0;
  const step = ts => {
    if (!cur?.playing) return;
    const b = $('#songBody');
    if (lastTs) {
      scrollAcc += pxPerSec() * Math.min(0.1, (ts - lastTs) / 1000);
      if (scrollAcc >= 1) { const whole = Math.floor(scrollAcc); b.scrollTop += whole; scrollAcc -= whole; }
      if (b.scrollTop >= b.scrollHeight - b.clientHeight - 1) { stopScroll(); return; }
    }
    lastTs = ts; scrollRaf = requestAnimationFrame(step);
  };
  scrollRaf = requestAnimationFrame(step);
  updateRemain();
}
function stopScroll() { if (cur) cur.playing = false; cancelAnimationFrame(scrollRaf); clearInterval(countdownTimer); countdownTimer = 0; const cd = $('#countdown'); if (cd) cd.hidden = true; updatePlayBtn(); updateRemain(); }
async function requestWake() { if (!S.keepScreenOn || !navigator.wakeLock) return; try { wakeLock = await navigator.wakeLock.request('screen'); } catch {} }
function releaseWake() { try { wakeLock?.release(); } catch {} wakeLock = null; }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && cur) requestWake(); });

// Схема аккорда
function showChord(name) {
  const p = Chords.parse(name, S.notation) || Chords.parse(name, RUSSIAN);
  const shape = p && ChordShapes.find(p.root, p.suffix);
  modal(`<h2 class="center">${esc(name)}</h2>${shape ? chordSvg(shape.frets) + (shape.simplified ? `<p class="small center">Упрощённая схема (${esc(Notes.pitchClassName(p.root, S.notation) + shape.baseSuffix)})</p>` : '') : '<p class="hint center">Схема для этого аккорда не найдена</p>'}
    <div class="row center"><button class="btn" data-x="no">Закрыть</button></div>`, e => { if (e.target.closest('[data-x]')) closeModal(); });
}
function chordSvg(frets) {
  const played = frets.filter(f => f > 0); const max = Math.max(0, ...played), min = played.length ? Math.min(...played) : 1;
  const base = max <= 4 ? 1 : min; const rows = 5, W = 200, H = 230, x0 = 30, y0 = 40, dx = 28, dy = 34;
  let s = `<svg class="chord" viewBox="0 0 ${W} ${H}" width="200" height="230">`;
  s += base === 1 ? `<rect x="${x0}" y="${y0 - 4}" width="${dx * 5}" height="5" fill="currentColor"/>` : `<text x="${x0 - 8}" y="${y0 + dy / 2 + 5}" text-anchor="end" font-size="14" fill="currentColor">${base}</text>`;
  for (let r = 0; r <= rows; r++) s += `<line x1="${x0}" y1="${y0 + r * dy}" x2="${x0 + dx * 5}" y2="${y0 + r * dy}" stroke="currentColor" stroke-opacity=".5"/>`;
  for (let i = 0; i < 6; i++) {
    const x = x0 + i * dx; s += `<line x1="${x}" y1="${y0}" x2="${x}" y2="${y0 + rows * dy}" stroke="currentColor" stroke-width="${1 + (5 - i) * 0.3}"/>`;
    const f = frets[i];
    if (f < 0) s += `<text x="${x}" y="${y0 - 12}" text-anchor="middle" font-size="16" fill="currentColor">×</text>`;
    else if (f === 0) s += `<circle cx="${x}" cy="${y0 - 17}" r="6" fill="none" stroke="currentColor" stroke-width="1.6"/>`;
    else s += `<circle cx="${x}" cy="${y0 + (f - base + 0.5) * dy}" r="10" fill="var(--accent)"/>`;
  }
  return s + '</svg>';
}

// ---------- Тюнер
const player = new StringPlayer();
const tracker = new InTuneTracker();
let tuner = null, tunerState = { freq: -1, manual: -1, auto: true, error: '' };
function currentTuning() {
  const inst = Tunings.instrument(S.instrumentId);
  const list = inst.tunings.concat(S.customTunings.filter(t => t.instrumentId === inst.id));
  return { inst, list, tuning: list.find(t => t.name === S.tuningName) || list[0] };
}
function renderTuner() {
  const { inst, list, tuning } = currentTuning();
  $('#main').innerHTML = header('Тюнер') + `<div class="pad tuner">
    <div class="row two"><select id="inst" aria-label="Инструмент">${Tunings.instruments.map(i => `<option value="${i.id}" ${i.id === inst.id ? 'selected' : ''}>${esc(i.name)}</option>`).join('')}</select>
      <select id="tun" aria-label="Строй">${list.map(t => `<option ${t.name === tuning.name ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>
    ${TEST_TONE ? `<p class="small test">Тестовый режим: синтетический тон ${TunerLogic.hz(TEST_TONE)}</p>` : ''}
    <div id="micGate" ${tuner ? 'hidden' : ''}><p class="hint">Тюнеру нужен доступ к микрофону, чтобы слышать струну. Звук никуда не записывается и не отправляется.</p>
      <button class="btn primary wide" id="micBtn">🎤 Включить тюнер</button><p class="error" id="micErr">${esc(tunerState.error)}</p></div>
    <div id="tLabel" class="tlabel">—</div>
    <div id="tSub" class="tsub">Дёрните любую струну</div>
    <svg id="gauge" viewBox="0 0 300 160" class="gauge"><path d="M30 150 A120 120 0 0 1 270 150" fill="none" stroke="var(--line)" stroke-width="10" stroke-linecap="round"/>
      <path d="M139.6 30.4 A120 120 0 0 1 160.4 30.4" fill="none" stroke="var(--ok)" stroke-width="12"/>
      ${[-50, -25, 0, 25, 50].map(c => { const a = (c / 50) * 75 * Math.PI / 180; return `<text x="${150 + 138 * Math.sin(a)}" y="${150 - 138 * Math.cos(a) + 4}" font-size="11" text-anchor="middle" fill="var(--muted)">${c > 0 ? '+' + c : c}</text>`; }).join('')}
      <line id="needle" x1="150" y1="150" x2="150" y2="40" stroke="var(--muted)" stroke-width="4" stroke-linecap="round"/><circle cx="150" cy="150" r="8" fill="var(--fg)"/></svg>
    <div id="tHint" class="thint"></div>
    <div class="row"><b id="tunedCount" class="grow"></b><button class="btn sm ghost" id="resetTuned">Сбросить</button></div>
    <div id="board" class="board"></div>
    <p class="small">Нажмите на струну: она станет выбранной и прозвучит эталон.</p>
    <div class="row center"><div class="seg"><button data-mode="auto" class="${tunerState.auto ? 'on' : ''}">Авто</button><button data-mode="manual" class="${tunerState.auto ? '' : 'on'}">Вручную</button></div></div>
    <p class="small center" id="modeHint">${tunerState.auto ? 'Авто: тюнер сам определит струну' : 'Выбрана вручную — дёрните эту струну'}</p>
    <div class="row"><button class="btn" id="listen">🔊 Послушать</button><label class="switch"><input type="checkbox" id="rep" ${S.repeat ? 'checked' : ''}> Повторять</label><button class="btn ghost" id="stopTone">Стоп</button></div>
    <div class="row a4"><span>Ля первой октавы (A4): <b id="a4v">${S.a4}</b> Гц</span><button class="btn sm" id="a4m">−</button><button class="btn sm" id="a4p">+</button></div>
    <button class="btn wide ghost" id="addTun">＋ Свой строй</button>
  </div>`;
  $('#inst').onchange = e => { S.instrumentId = e.target.value; S.tuningName = Tunings.instrument(S.instrumentId).tunings[0].name; saveS(); tracker.reset(); tunerState.manual = -1; renderTuner(); };
  $('#tun').onchange = e => { S.tuningName = e.target.value; saveS(); tracker.reset(); renderTuner(); };
  $('#addTun').onclick = addCustomTuning;
  $('#micBtn').onclick = startTuner;
  $('#resetTuned').onclick = () => { tracker.reset(); drawTuner(); };
  document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { tunerState.auto = b.dataset.mode === 'auto'; if (!tunerState.auto && tunerState.manual < 0) tunerState.manual = 0; renderTuner(); });
  $('#board').onclick = e => { const r = e.target.closest('[data-i]'); if (!r) return; const i = +r.dataset.i; tunerState.manual = i; tunerState.auto = false; playString(i); renderTuner(); };
  $('#listen').onclick = () => playString(tunerState.manual >= 0 ? tunerState.manual : 0);
  $('#rep').onchange = e => { S.repeat = e.target.checked; saveS(); };
  $('#stopTone').onclick = () => player.stop();
  $('#a4m').onclick = () => { S.a4 = Math.max(432, S.a4 - 1); saveS(); $('#a4v').textContent = S.a4; drawTuner(); };
  $('#a4p').onclick = () => { S.a4 = Math.min(446, S.a4 + 1); saveS(); $('#a4v').textContent = S.a4; drawTuner(); };
  drawTuner();
}
function playString(i) {
  const { tuning } = currentTuning(); const midis = Tunings.midis(tuning);
  audioCtx(); player.play(midis[i], Notes.freq(midis[i], S.a4), S.repeat);
}
player.onChange = () => { if (tuner) tuner.muted = player.playing; if (tab === 'tuner') drawTuner(); };
async function startTuner() {
  if (tuner) return;
  tunerState.error = '';
  try { tuner = new TunerEngine(f => { tunerState.freq = f; if (tab === 'tuner') drawTuner(); }); await tuner.start(TEST_TONE); $('#micGate').hidden = true; }
  catch (e) {
    tuner = null;
    tunerState.error = e.name === 'NotAllowedError' ? 'Доступ к микрофону запрещён. Разрешите: Настройки iPhone → Safari → Микрофон (или нажмите «aA» в адресной строке → Настройки веб-сайта).' : 'Не удалось открыть микрофон: ' + (e.message || e.name);
    const el = $('#micErr'); if (el) el.textContent = tunerState.error;
  }
}
function stopTuner() { tuner?.stop(); tuner = null; player.stop(false); }
function drawTuner() {
  const board = $('#board'); if (!board) return;
  const { inst, tuning } = currentTuning(); const targets = Tunings.midis(tuning); const paired = inst.id === 'guitar12';
  const f = player.playing ? -1 : tunerState.freq;
  let idx = tunerState.auto ? TunerLogic.nearestString(f, targets, S.a4) : tunerState.manual;
  if (idx >= targets.length) idx = -1;
  const shownIdx = idx >= 0 ? idx : (tunerState.auto ? -1 : tunerState.manual);
  let cents = null;
  if (f > 0 && idx >= 0) { cents = Notes.centsBetween(f, targets[idx], S.a4); if (Math.abs(cents) > 600) cents = null; }
  if (tracker.update(idx, cents, performance.now())) {}
  $('#tLabel').textContent = player.playing ? `Звучит эталон ${Notes.name(player.playingMidi, S.notation)}` : shownIdx >= 0 ? TunerLogic.label(shownIdx, targets, paired, S.a4, S.notation) : '—';
  $('#tSub').textContent = player.playing ? 'Звучит эталон — тюнер не слушает' : f > 0 ? `Слышу ${TunerLogic.hz(f)}${cents != null ? ' · ' + TunerLogic.cents(cents) : ''}` : (tuner ? 'Дёрните любую струну' : 'Тюнер выключен');
  const dir = cents != null ? TunerLogic.direction(cents) : null;
  const h = $('#tHint'); h.textContent = cents != null ? TunerLogic.hint(cents) : ''; h.className = 'thint ' + (dir || '').toLowerCase();
  const c = cents == null ? 0 : Math.max(-50, Math.min(50, cents)); const a = (c / 50) * 75 * Math.PI / 180;
  const n = $('#needle'); n.setAttribute('x2', 150 + 110 * Math.sin(a)); n.setAttribute('y2', 150 - 110 * Math.cos(a));
  n.setAttribute('stroke', dir === 'OK' ? 'var(--ok)' : dir === 'UP' ? 'var(--up)' : dir === 'DOWN' ? 'var(--down)' : 'var(--muted)');
  const total = targets.length; const tunedN = tracker.tuned.size;
  $('#tunedCount').textContent = `Струны (${tunedN} из ${total} в строе)`;
  // гриф: сверху самая тонкая струна
  const rows = [];
  if (paired) { for (let p = total / 2 - 1; p >= 0; p--) rows.push([2 * p, 2 * p + 1]); }
  else for (let i = total - 1; i >= 0; i--) rows.push([i]);
  const maxM = Math.max(...targets), minM = Math.min(...targets);
  board.innerHTML = rows.map(ids => {
    const i = ids[0]; const active = ids.includes(shownIdx); const tuned = ids.every(k => tracker.tuned.has(k));
    const thick = ids.map(k => 1 + 4 * (maxM - targets[k]) / Math.max(1, maxM - minM));
    const prog = active ? tracker.progress(shownIdx, performance.now()) : 0;
    return `<div class="srow ${active ? 'active' : ''} ${tuned ? 'tuned' : ''}" data-i="${active ? shownIdx : i}">
      <span class="snum">${TunerLogic.stringNumber(i, total, paired)}</span>
      <span class="snote">${ids.map(k => Notes.name(targets[k], S.notation)).join(' / ')}</span>
      <span class="sline">${thick.map(t => `<i style="height:${t.toFixed(1)}px"></i>`).join('')}${prog > 0 && !tuned ? `<em style="width:${prog * 100}%"></em>` : ''}</span>
      <span class="scheck">${tuned ? '✓' : ''}</span></div>`;
  }).join('');
}
function addCustomTuning() {
  const { inst, tuning } = currentTuning();
  modal(`<h2>Свой строй — ${esc(inst.name)}</h2><input id="ctn" placeholder="Название" value="Мой строй ${S.customTunings.length + 1}">
    <label>Ноты от толстой струны к тонкой<input id="ctx" value="${esc(tuning.notes.join(' '))}"></label><p class="small">Например: D2 A2 D3 G3 B3 E4 (H или B — си)</p>
    ${S.customTunings.length ? `<p class="small">Мои строи: ${S.customTunings.map((t, i) => `${esc(t.name)} <button class="link" data-del="${i}">Удалить</button>`).join(' · ')}</p>` : ''}
    <div class="row end"><button class="btn" data-x="no">Отмена</button><button class="btn primary" data-x="ok">Сохранить</button></div>`, e => {
    const d = e.target.closest('[data-del]'); if (d) { S.customTunings.splice(+d.dataset.del, 1); saveS(); closeModal(); renderTuner(); return; }
    const x = e.target.closest('[data-x]')?.dataset.x; if (x === 'no') closeModal();
    if (x === 'ok') {
      const notes = $('#ctx').value.trim().split(/[\s,]+/).map(n => n.replace(/^h/i, 'B').replace(/^([a-g])/, m => m.toUpperCase()));
      if (!notes.length || notes.length > 12 || notes.some(n => Notes.parse(n) == null)) { toast('Проверьте ноты: формат E2, F#3, Bb1 (1–12 струн)'); return; }
      const name = $('#ctn').value.trim() || 'Мой строй';
      S.customTunings.push({ name, notes, custom: true, instrumentId: inst.id }); S.tuningName = name; saveS(); closeModal(); renderTuner();
    }
  });
}

// ---------- Метроном
const metro = new Metronome(b => { document.querySelectorAll('.dot').forEach((d, i) => d.classList.toggle('on', i === b)); });
let taps = [];
function renderMetro() {
  metro.bpm = S.metroBpm; metro.beats = S.metroBeats; metro.accent = S.metroAccent;
  $('#main').innerHTML = header('Метроном') + `<div class="pad metro">
    <div class="bpm"><button class="btn round" data-m="-5">−5</button><button class="btn round" data-m="-1">−1</button><div><b id="bpm">${S.metroBpm}</b><span>ударов в минуту</span></div><button class="btn round" data-m="1">+1</button><button class="btn round" data-m="5">+5</button></div>
    <input type="range" id="bpmR" min="30" max="250" value="${S.metroBpm}">
    <div class="dots">${Array.from({ length: S.metroBeats }, (_, i) => `<span class="dot ${i === 0 && S.metroAccent ? 'acc' : ''}"></span>`).join('')}</div>
    <div class="row center"><button class="btn sm" data-b="-1" aria-label="Меньше долей">−</button><span>Долей в такте: <b>${S.metroBeats}</b></span><button class="btn sm" data-b="1" aria-label="Больше долей">+</button></div>
    <label class="switch center"><input type="checkbox" id="acc" ${S.metroAccent ? 'checked' : ''}> Акцент на первую долю</label>
    <button class="btn primary wide big" id="mStart">${metro.running ? 'Стоп' : 'Старт'}</button>
    <button class="btn wide" id="tap">Простучать темп (Tap)</button></div>`;
  const setBpm = v => { S.metroBpm = Math.max(30, Math.min(250, Math.round(v))); metro.bpm = S.metroBpm; saveS(); $('#bpm').textContent = S.metroBpm; $('#bpmR').value = S.metroBpm; };
  document.querySelectorAll('[data-m]').forEach(b => b.onclick = () => setBpm(S.metroBpm + +b.dataset.m));
  $('#bpmR').oninput = e => setBpm(+e.target.value);
  document.querySelectorAll('[data-b]').forEach(b => b.onclick = () => { S.metroBeats = Math.max(1, Math.min(12, S.metroBeats + +b.dataset.b)); saveS(); renderMetro(); });
  $('#acc').onchange = e => { S.metroAccent = e.target.checked; saveS(); renderMetro(); };
  $('#mStart').onclick = () => { if (metro.running) metro.stop(); else { audioCtx(); metro.start(); } $('#mStart').textContent = metro.running ? 'Стоп' : 'Старт'; };
  $('#tap').onclick = () => { const now = performance.now(); taps = taps.filter(t => now - t < 3000); taps.push(now);
    if (taps.length >= 2) { const iv = (taps[taps.length - 1] - taps[0]) / (taps.length - 1); setBpm(60000 / iv); } };
}

// ---------- Настройки
function renderSettings() {
  const opt = (name, val, label) => `<label class="radio"><input type="radio" name="${name}" value="${val}" ${String(S[name]) === String(val) ? 'checked' : ''}> ${label}</label>`;
  $('#main').innerHTML = `<header class="bar"><button class="icon" id="sBack" aria-label="Назад">‹</button><h1>Настройки</h1></header><div class="pad settings">
    <h3>Тема оформления</h3>${opt('theme', 0, 'Как в системе')}${opt('theme', 1, 'Светлая')}${opt('theme', 2, 'Тёмная')}
    <h3>Запись ноты «си»</h3>${opt('notation', RUSSIAN, 'Русская: H = си, B = си♭')}${opt('notation', INTERNATIONAL, 'Международная: B = си')}
    <h3>Знаки при смене тональности</h3>${opt('accidentals', AUTO, 'Автоматически')}${opt('accidentals', SHARPS, 'Диезы (C#, F#)')}${opt('accidentals', FLATS, 'Бемоли (Db, Gb)')}
    <h3>Отсчёт перед автопрокруткой</h3>${opt('countdown', 0, 'Без отсчёта')}${opt('countdown', 3, '3 секунды')}${opt('countdown', 5, '5 секунд')}
    <h3>Экран</h3><label class="switch"><input type="checkbox" data-b="keepScreenOn" ${S.keepScreenOn ? 'checked' : ''}> Не выключать экран при просмотре песни</label>
    <p>Размер шрифта песни: <b id="fs">${S.fontSize}</b> <button class="btn sm" data-fs="-1">A−</button> <button class="btn sm" data-fs="1">A+</button></p>
    <h3>Источники аккордов</h3><label class="switch"><input type="checkbox" data-b="srcAmdm" ${S.srcAmdm ? 'checked' : ''}> amdm.ru</label>
    <label class="switch"><input type="checkbox" data-b="srcMychords" ${S.srcMychords ? 'checked' : ''}> mychords.net</label>
    <p class="small">Поиск идёт по открытым сайтам amdm.ru и mychords.net. Тексты и аккорды принадлежат их авторам и сайтам. Если сайт изменит вёрстку, поиск по нему может временно перестать работать — сохранённые песни при этом останутся.</p>
    <h3>Сервер для поиска (прокси)</h3><p class="small">Браузер не может читать сайты с аккордами напрямую, поэтому запросы идут через сервер-посредник. Обычно ничего менять не нужно. Свой адрес (например, Cloudflare Worker) имеет приоритет.</p>
    <input id="proxy" placeholder="https://…workers.dev" value="${esc(S.customProxy)}"><div class="row"><button class="btn sm" id="proxySave">Сохранить</button><button class="btn sm ghost" id="proxyTest">Проверить</button><span id="proxyRes" class="small"></span></div>
    <h3>Резервная копия песен</h3><p class="small">iPhone может очистить данные сайта, если приложением долго не пользоваться. Сохраните копию в «Файлы».</p>
    <div class="row"><button class="btn sm" id="exp">Экспорт</button><label class="btn sm">Импорт<input type="file" id="imp" accept=".json,application/json" hidden></label></div>
    <p class="small muted">Версия 1.2 (iPhone, веб-приложение)</p></div>`;
  $('#sBack').onclick = () => go(prevTab);
  document.querySelectorAll('input[type=radio]').forEach(r => r.onchange = () => { S[r.name] = ['theme', 'countdown'].includes(r.name) ? +r.value : r.value; saveS(); applyTheme(); });
  document.querySelectorAll('[data-b]').forEach(c => c.onchange = () => { S[c.dataset.b] = c.checked; saveS(); });
  document.querySelectorAll('[data-fs]').forEach(b => b.onclick = () => { S.fontSize = Math.max(11, Math.min(30, S.fontSize + +b.dataset.fs)); saveS(); $('#fs').textContent = S.fontSize; });
  $('#proxySave').onclick = () => { S.customProxy = $('#proxy').value.trim(); saveS(); updateProxies(); toast('Сохранено'); };
  $('#proxyTest').onclick = async () => {
    const res = $('#proxyRes'); res.textContent = 'Проверяю…';
    try { const r = await Sources.all[1].search('кино'); res.textContent = `Работает ✓ (найдено ${r.length})`; } catch (e) { res.textContent = 'Ошибка: ' + e.message; }
  };
  $('#exp').onclick = async () => {
    const data = JSON.stringify({ app: 'guitar-pwa', version: 1, songs: await SongDb.all() }, null, 1);
    const file = new File([data], 'gitara-pesni.json', { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file] }); return; } catch {} }
    const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click();
  };
  $('#imp').onchange = async e => {
    try { const j = JSON.parse(await e.target.files[0].text()); for (const s of j.songs || []) await SongDb.put(s); toast(`Импортировано песен: ${(j.songs || []).length}`); }
    catch { toast('Не удалось прочитать файл'); }
  };
}

// ---------- Старт
window.addEventListener('pagehide', () => { stopTuner(); metro.stop(); });
renderTabs();
loadSongs().then(() => { if (params.get('tab')) tab = params.get('tab'); renderTabs(); render(); });
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
window.__app = { doSearch, openSong, go, S, startTuner };
