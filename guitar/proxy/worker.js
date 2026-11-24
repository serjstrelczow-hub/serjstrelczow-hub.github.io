// Тот же прокси для Cloudflare Workers (бесплатно, нужен аккаунт Cloudflare).
// dash.cloudflare.com → Workers & Pages → Create → Hello World → вставить этот код → Deploy.
// Полученный адрес *.workers.dev вписать в приложении: Настройки → «Свой прокси».
const ALLOW = /^https:\/\/(www\.)?(amdm\.ru|mychords\.net)\//;
const UA = 'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
export default {
  async fetch(req) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const u = new URL(req.url);
    if (u.pathname === '/health') return new Response('ok', { headers: cors });
    const target = u.searchParams.get('url') || '';
    if (!ALLOW.test(target)) return new Response('Разрешены только amdm.ru и mychords.net', { status: 403, headers: cors });
    const headers = { 'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9' };
    if (u.searchParams.get('ajax') === '1') headers['X-Requested-With'] = 'XMLHttpRequest';
    const r = await fetch(target, { headers, redirect: 'follow', cf: { cacheTtl: 600 } });
    return new Response(r.body, { status: r.status, headers: { ...cors, 'Content-Type': r.headers.get('content-type') || 'text/html; charset=utf-8' } });
  }
};
