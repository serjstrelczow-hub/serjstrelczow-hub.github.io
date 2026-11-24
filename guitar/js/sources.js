// Поиск и загрузка песен (порт Sources.kt). Сайты не отдают CORS, поэтому запросы идут через прокси.
import { Chords, ChordText, RUSSIAN, INTERNATIONAL } from './music.js';

export class SourceError extends Error {}

function javaHash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0; return (h >>> 0).toString(16); }
export const songId = url => javaHash(url) + '-' + url.length;

let proxyList = null;
export function setProxies(list) { proxyList = list; }
export const hasProxy = () => (proxyList || []).some(Boolean);

async function proxyFetch(url, ajax = false) {
  const list = (proxyList || []).filter(Boolean);
  if (!list.length) throw new SourceError('Не настроен прокси для поиска (Настройки → Прокси)');
  let lastErr = null;
  for (const p of list) {
    const full = p.includes('{url}') ? p.replace('{url}', encodeURIComponent(url)).replace('{ajax}', ajax ? '1' : '0')
      : p.replace(/\/?$/, '/') + '?url=' + encodeURIComponent(url) + (ajax ? '&ajax=1' : '');
    try {
      const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 15000);
      const r = await fetch(full, { signal: ctl.signal, cache: 'no-store' }); clearTimeout(tm);
      if (!r.ok) { lastErr = new SourceError('Сайт ответил ошибкой ' + r.status); if (r.status === 404 || r.status === 410) throw lastErr; continue; }
      return await r.text();
    } catch (e) {
      if (e instanceof SourceError && /40[4]|410/.test(e.message)) throw e;
      lastErr = e.name === 'AbortError' ? new SourceError('Сайт не отвечает (таймаут)') : (e instanceof SourceError ? e : new SourceError(navigator.onLine === false ? 'Нет подключения к интернету' : 'Сервер поиска недоступен'));
    }
  }
  throw lastErr || new SourceError('Ошибка сети');
}

const parseHtml = (html, base) => { const d = new DOMParser().parseFromString(html, 'text/html'); const b = d.createElement('base'); b.href = base; d.head.prepend(b); return d; };
function markChords(root, selector, chordOf) {
  for (const el of root.querySelectorAll(selector)) {
    const name = (chordOf(el) || '').trim();
    if (!name) el.remove(); else el.replaceWith(root.ownerDocument.createTextNode(ChordText.mark(name)));
  }
}
function cleanText(s) {
  const raw = s.replace(/\u00A0/g, ' ').replace(/\r/g, '').split('\n').map(l => l.trimEnd()).join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');
  return ChordText.unmarkTabLines(raw);
}

export const Amdm = {
  id: 'amdm', title: 'amdm.ru',
  handles: u => u.includes('amdm.ru'),
  async search(q) { return Amdm.parseSearch(await proxyFetch('https://amdm.ru/search/?q=' + encodeURIComponent(q))); },
  async fetchSong(url) { return Amdm.parseSong(await proxyFetch(url), url); },
  parseSearch(html) {
    const doc = parseHtml(html, 'https://amdm.ru/'); const seen = new Set(); const out = [];
    for (const td of doc.querySelectorAll('table.items td.artist_name')) {
      const links = td.querySelectorAll('a.artist'); if (links.length < 2) continue;
      const href = links[1].href; if (!href.includes('/akkordi/') || seen.has(href)) continue;
      seen.add(href); out.push({ artist: links[0].textContent.trim(), title: links[1].textContent.trim(), url: href, source: Amdm.title });
    }
    return out;
  },
  parseSong(html, url) {
    const doc = parseHtml(html, url);
    const pre = doc.querySelector('pre[itemprop=chordsBlock]') || doc.querySelector('pre.podbor__text');
    if (!pre) throw new SourceError('На странице не найден текст с аккордами (возможно, сайт изменил вёрстку)');
    markChords(pre, 'div.podbor__chord, span.podbor__chord', el => el.getAttribute('data-chord') || el.textContent);
    const text = cleanText(pre.textContent);
    const artist = doc.querySelector('[itemprop=byArtist]')?.textContent.trim() || '';
    const name = doc.querySelector('h1 [itemprop=name], span[itemprop=name]')?.textContent.trim() || doc.title.split(',')[0].split(' - ').slice(1).join(' - ').trim();
    const notation = Chords.inferNotation(ChordText.uniqueChords(text), RUSSIAN); // amdm: H = си, B = си♭
    return { id: songId(url), artist: artist || doc.title.split(' - ')[0].trim(), title: name, url, source: Amdm.title, text, notation };
  }
};

export const MyChords = {
  id: 'mychords', title: 'mychords.net',
  handles: u => u.includes('mychords.net'),
  async search(q) { return MyChords.parseSearch(await proxyFetch('https://mychords.net/ru/ajax/autocomplete?q=' + encodeURIComponent(q), true)); },
  async fetchSong(url) { return MyChords.parseSong(await proxyFetch(url), url); },
  parseSearch(body) {
    let root; try { root = JSON.parse(body); } catch { throw new SourceError('Неожиданный ответ mychords.net'); }
    const seen = new Set(); const out = [];
    for (const o of root.suggestions || []) {
      const value = o.value, path = o.data?.url; if (!value || !path || !path.endsWith('.html')) continue;
      const url = 'https://mychords.net' + path; if (seen.has(url)) continue; seen.add(url);
      const i = value.indexOf(' - ');
      out.push({ artist: i >= 0 ? value.slice(0, i).trim() : value.trim(), title: i >= 0 ? value.slice(i + 3).trim() : value, url, source: MyChords.title });
    }
    return out;
  },
  parseSong(html, url) {
    const doc = parseHtml(html, url);
    const box = doc.querySelector('div.w-words__text');
    if (!box) throw new SourceError('На странице не найден текст с аккордами (возможно, сайт изменил вёрстку)');
    markChords(box, 'span.b-accord__symbol', el => el.textContent);
    box.querySelectorAll('br').forEach(b => b.replaceWith(doc.createTextNode('\n')));
    let sb = '';
    for (const child of box.children) {
      if (child.classList.contains('pline')) {
        const sub = child.querySelectorAll('span.subline');
        if (!sub.length) sb += child.textContent + '\n'; else sub.forEach(s => sb += s.textContent + '\n');
      } else sb += child.textContent + '\n';
    }
    if (!box.children.length) sb += box.textContent;
    const full = doc.querySelector('meta[itemprop=name]')?.getAttribute('content')?.trim() || doc.title.split(',')[0].trim();
    const i = full.indexOf(' - ');
    const text = cleanText(sb);
    const notation = Chords.inferNotation(ChordText.uniqueChords(text), INTERNATIONAL); // mychords: B = си
    return { id: songId(url), artist: i >= 0 ? full.slice(0, i).trim() : full, title: i >= 0 ? full.slice(i + 3).trim() : full, url, source: MyChords.title, text, notation };
  }
};

export const Sources = { all: [Amdm, MyChords], forUrl: u => [Amdm, MyChords].find(s => s.handles(u)) };
