// Каталог из фотоальбомов группы ВК «Дари красиво».
// В подписи фото: цена и, если хозяйка пишет, название перед ценой («Нежность, 1500₽»). Без названия товар называется «Арт. 123456».
// Скрыть товар: добавить в подпись «#нет» или «нет в наличии».
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

// ---------- Разбор подписи к фото ----------
// Формат подписи, который понимает сайт (достаточно такого):
//   Букет из белых хризантем и зелени в коробочке
//   900 руб.
//   к1844
// Название стоит перед ценой, цена с «руб.», «р.» или «₽», артикул вида «к1844».
// Скрыть товар: добавить в подпись «#нет» или «нет в наличии».
const MIN_PRICE = 50, MAX_PRICE = 300000;
const NUM = '(\\d{1,3}(?:[ \\u00a0]\\d{3})+|\\d+)';
const PRICE_WITH_CUR = new RegExp(NUM + '\\s*(?:₽|руб[а-яё]*\\.?|р(?![а-яё]))', 'i');
const SKU_K = /(^|[\s(])([кk]\s?\d{3,6})(?![0-9A-Za-zА-Яа-яЁё])/i;
const SKU_ART = /(^|[\s(])арт(?:икул)?\.?\s*[№#]?\s*([0-9A-Za-zА-Яа-я-]{2,12})/i;
const HIDE_RE = /(#нет|#скрыть|нет в наличии)/i;

function toNumber(str) { return Number(String(str).replace(/[ \u00a0]/g, '')); }

function cleanName(before) {
  const t = String(before || '')
    .replace(/#\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[\s,;:.\-–—«»"'|/\\]+$/g, '')
    .replace(/^[\s,;:.\-–—«»"'|/\\]+/g, '')
    .trim();
  if (t.length < 3 || t.length > 80 || !/[А-Яа-яA-Za-z]/.test(t)) return '';
  if (/^(цена|стоимость|цена актуальна.*)$/i.test(t)) return '';
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// Возвращает {price, name, sku, hidden}. price = null, если цены в подписи нет.
function parseCaption(text) {
  const out = { price: null, name: '', sku: '', hidden: false };
  let work = String(text || '').replace(/\u00a0/g, ' ');
  if (!work.trim()) return out;
  out.hidden = HIDE_RE.test(work);
  work = work.replace(HIDE_RE, ' ');

  // артикул вырезаем, чтобы его цифры не приняли за цену
  let m = work.match(SKU_K);
  if (m) { out.sku = m[2].replace(/\s/g, '').toLowerCase(); work = work.replace(m[0], m[1] + ' '); }
  else {
    m = work.match(SKU_ART);
    if (m) { out.sku = m[2]; work = work.replace(m[0], m[1] + ' '); }
  }

  // цена: число рядом с ₽ / руб. / р., иначе последнее подходящее число
  let priceIdx = -1;
  m = work.match(PRICE_WITH_CUR);
  if (m && toNumber(m[1]) >= MIN_PRICE && toNumber(m[1]) <= MAX_PRICE) {
    out.price = toNumber(m[1]); priceIdx = m.index;
  } else {
    const re = new RegExp(NUM, 'g'); let last = null, x;
    while ((x = re.exec(work)) !== null) {
      const n = toNumber(x[1]);
      if (n >= MIN_PRICE && n <= MAX_PRICE) last = { n, index: x.index };
    }
    if (last) { out.price = last.n; priceIdx = last.index; }
  }
  if (priceIdx >= 0) out.name = cleanName(work.slice(0, priceIdx));
  return out;
}

function parsePrice(text) { return parseCaption(text).price; }
function parseName(text) { return parseCaption(text).name; }
function isHidden(text) { return HIDE_RE.test(String(text || '')); }

function pickBig(sizes) {
  const by = {}; (sizes || []).forEach(s => { by[s.type] = s.url; });
  return by.z || by.y || by.x || by.r || '';
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
    let hidden = 0;
    for (const a of albums) {
      for (let offset = 0; offset < 3000; offset += 1000) {
        const r = await call('photos.get', { owner_id: owner, album_id: a.id, count: 1000, offset, rev: 1 });
        for (const ph of r.items || []) {
          const cap = parseCaption(ph.text);
          if (cap.hidden) { hidden++; continue; } // хозяйка скрыла товар пометкой в подписи
          if (cap.price === null) { skipped++; continue; } // без цены в подписи не показываем
          products.push({
            id: 'p' + ph.id,
            name: cap.name || ('Арт. ' + (cap.sku || String(ph.id).slice(-6))),
            sku: cap.name && cap.sku ? cap.sku : '',
            price: cap.price,
            cat: a.title,
            img: pickImg(ph.sizes),
            big: pickBig(ph.sizes),
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
      body: JSON.stringify({ products, albums: albums.map(a => a.title), total: products.length, skippedNoPrice: skipped, hiddenByMark: hidden })
    };
  } catch (e) {
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: e.message, vk: e.vk || null }) };
  }
};
exports.parseCaption = parseCaption;
exports.parsePrice = parsePrice;
exports.parseName = parseName;
exports.isHidden = isHidden;
