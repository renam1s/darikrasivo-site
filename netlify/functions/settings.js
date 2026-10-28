// Настройки сайта, которые хозяйка меняет в кабинете (/admin): цены доставки, объявление,
// пауза приёма заказов, тексты «О магазине», «Доставка», «Оплата».
// GET  — отдаёт сохранённые настройки всем (их читает сам сайт).
// POST — сохраняет настройки, только с правильным паролем.
// Переменная Netlify: ADMIN_PASSWORD (пароль кабинета, придумайте длинный).
// Хранилище: Netlify Blobs (подключается само, ключей не нужно).

'use strict';

const crypto = require('crypto');

const ZONES = ['okt', 'sver', 'len', 'kui', 'irk'];
const MAX_BODY = 40000;
const MAX_TEXT = 2500;
const MAX_NOTICE = 400;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Как получить хранилище. В тестах подменяется через __setStoreFactory.
let storeFactory = async (event) => {
  const blobs = await import('@netlify/blobs');
  blobs.connectLambda(event);
  return blobs.getStore('site-settings');
};

function reply(status, obj, headers) {
  return {
    statusCode: status,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, headers || { 'Cache-Control': 'no-store' }),
    body: JSON.stringify(obj),
  };
}

function passwordOk(given) {
  const real = process.env.ADMIN_PASSWORD;
  if (!real) return null; // не настроен
  const a = crypto.createHash('sha256').update(String(given || '')).digest();
  const b = crypto.createHash('sha256').update(String(real)).digest();
  return crypto.timingSafeEqual(a, b);
}

function cleanText(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/\r\n?/g, '\n').trim().slice(0, max);
}

// Приводит присланные настройки к безопасному виду. Лишнее выбрасывается.
function sanitize(input) {
  const s = input && typeof input === 'object' ? input : {};
  const out = { notice: { on: false, text: '' }, paused: false, delivery: {}, texts: { about: '', delivery: '', payment: '' } };

  if (s.notice && typeof s.notice === 'object') {
    out.notice.text = cleanText(s.notice.text, MAX_NOTICE);
    out.notice.on = !!s.notice.on && out.notice.text.length > 0;
  }
  out.paused = !!s.paused;

  if (s.delivery && typeof s.delivery === 'object') {
    ZONES.forEach((id) => {
      const z = s.delivery[id];
      if (!z || typeof z !== 'object') return;
      const raw = z.price;
      if (raw === null || raw === undefined || raw === '') { out.delivery[id] = { price: null, from: false }; return; }
      const n = Number(raw);
      if (!isFinite(n) || n < 0 || n > 100000) return;
      out.delivery[id] = { price: Math.round(n), from: !!z.from };
    });
  }

  if (s.texts && typeof s.texts === 'object') {
    out.texts.about = cleanText(s.texts.about, MAX_TEXT);
    out.texts.delivery = cleanText(s.texts.delivery, MAX_TEXT);
    out.texts.payment = cleanText(s.texts.payment, MAX_TEXT);
  }
  out.updated = new Date().toISOString();
  return out;
}

exports.handler = async (event) => {
  const method = event.httpMethod;

  if (method === 'GET') {
    try {
      const store = await storeFactory(event);
      const data = await store.get('settings', { type: 'json' });
      return reply(200, { ok: true, settings: data || {} }, {
        'Cache-Control': 'public, max-age=20',
        'Netlify-CDN-Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
      });
    } catch (e) {
      console.error('settings read failed:', String((e && e.message) || e));
      // сайт в этом случае просто покажет исходные значения
      return reply(200, { ok: false, settings: {} });
    }
  }

  if (method !== 'POST') return reply(405, { ok: false, error: 'method' });

  if ((event.body || '').length > MAX_BODY) return reply(413, { ok: false, error: 'too big' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return reply(400, { ok: false, error: 'json' }); }

  const okPass = passwordOk(body.password);
  if (okPass === null) return reply(500, { ok: false, error: 'not configured' });
  if (!okPass) { await sleep(900); return reply(401, { ok: false, error: 'password' }); }

  if (body.action === 'login') return reply(200, { ok: true });

  try {
    const store = await storeFactory(event);
    const clean = sanitize(body.settings);
    await store.setJSON('settings', clean);
    return reply(200, { ok: true, settings: clean });
  } catch (e) {
    console.error('settings save failed:', String((e && e.message) || e));
    return reply(500, { ok: false, error: 'save failed' });
  }
};

exports.__setStoreFactory = (fn) => { storeFactory = fn; };
exports.__sanitize = sanitize;
