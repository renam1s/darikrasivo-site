// Каталог из фотоальбомов группы ВК «Дари красиво».
// Название товара в подписях не пишется, там только цена, поэтому товар = фото + цена + раздел (альбом).
// Переменные Netlify: VK_TOKEN (сервисный ключ приложения), VK_GROUP_ID (число, без минуса).
const API = 'https://api.vk.com/method/';
const V = '5.199';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Запасной список альбомов (по сохранённой странице группы), если photos.getAlbums не ответит.
const FALLBACK_ALBUMS = [
  { id: 279663956, title: 'Воздушные шары (фольга)' },
  { id: 284771723, title: 'До 1000' },
  { id: 304847057, title: 'Букеты, композиции 1000-1500 руб.' },
  { id: 284771721, title: '1500-2000' },
  { id: 308469010, title: 'Светящиеся букеты (букеты-ночники)' },
  { id: 308353798, title: 'Букеты, композиции из гипсофилы' },
  { id: 284771720, title: '2000-3000' },
  { id: 284771716, title: '3000-4000' },
  { id: 284771955, title: 'Свыше 4000' }
];

async function call(method, params, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const url = new URL(API + method);
    url.search = new URLSearchParams({ ...params, access_token: process.env.VK_TOKEN, v: V }).toString();
    const j = await (await fetch(url)).json();
    if (j.error && j.error.error_code === 6 && i < tries - 1) { await sleep(600); continue; } // слишком часто
    if (j.error) { const e = new Error(j.error.error_msg); e.vk = j.error; throw e; }
    return j.response;
  }
}

// Цена: первое число в подписи (подпись пишет человек: «900₽», «850», «1300 руб. к1930 ...»).
function parsePrice(text) {
  if (!text) return null;
  const m = String(text).match(/(\d{1,3}(?:[ \u00a0]\d{3})+|\d+)/);
  if (!m) return null;
  const n = Number(m[1].replace(/[ \u00a0]/g, ''));
  return n >= 50 && n <= 200000 ? n : null;
}

function pickImg(sizes) {
  const by = {}; (sizes || []).forEach(s => { by[s.type] = s.url; });
  return by.x || by.r || by.y || by.z || by.base || (sizes && sizes.length ? sizes[sizes.length - 1].url : '');
}

exports.handler = async () => {
  try {
    if (!process.env.VK_TOKEN || !process.env.VK_GROUP_ID) throw new Error('Не заданы VK_TOKEN или VK_GROUP_ID');
    const owner = -Math.abs(Number(process.env.VK_GROUP_ID));
    const group = Math.abs(owner);

    let albums;
    try {
      const r = await call('photos.getAlbums', { owner_id: owner, need_system: 0 });
      albums = (r.items || []).filter(a => a.size > 0).map(a => ({ id: a.id, title: a.title }));
      await sleep(350);
    } catch (e) { albums = FALLBACK_ALBUMS; }
    if (!albums.length) albums = FALLBACK_ALBUMS;

    const products = [];
    let skipped = 0;
    for (const a of albums) {
      for (let offset = 0; offset < 3000; offset += 1000) {
        const r = await call('photos.get', { owner_id: owner, album_id: a.id, count: 1000, offset, rev: 1 });
        for (const ph of r.items || []) {
          const price = parsePrice(ph.text);
          if (price === null) { skipped++; continue; } // без цены в подписи не показываем
          products.push({
            id: 'p' + ph.id,
            name: 'Арт. ' + String(ph.id).slice(-6),
            price,
            cat: a.title,
            img: pickImg(ph.sizes),
            link: 'https://vk.ru/photo-' + group + '_' + ph.id
          });
        }
        if (!r.items || r.items.length < 1000) break;
        await sleep(350);
      }
      await sleep(350);
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60',
        'Netlify-CDN-Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600'
      },
      body: JSON.stringify({ products, albums: albums.map(a => a.title), total: products.length, skippedNoPrice: skipped })
    };
  } catch (e) {
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: e.message, vk: e.vk || null }) };
  }
};
exports.parsePrice = parsePrice;
