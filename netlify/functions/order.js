// Приём заказа с сайта и отправка хозяйке: на почту, в Telegram и/или в Max.
// Что включено, определяют переменные окружения Netlify (Site configuration, Environment variables).
// Нужен хотя бы один способ:
//
//   Почта (Яндекс):  ORDER_SMTP_USER   = dari-krasivo.irk@yandex.ru
//                    ORDER_SMTP_PASS   = пароль приложения от Яндекс ID (не пароль от почты)
//                    ORDER_EMAIL_TO    = куда присылать (можно тот же адрес)
//   Telegram:        ORDER_TG_BOT_TOKEN, ORDER_TG_CHAT_ID
//   Max:             ORDER_MAX_TOKEN, а также ORDER_MAX_USER_ID или ORDER_MAX_CHAT_ID
//                    (отправка в Max написана по описанию API, на живом аккаунте не проверялась)
//
// Секреты хранятся только в переменных окружения, в коде страницы их нет.

'use strict';

const MAX_TEXT = 3500;

function reply(status, obj) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    body: JSON.stringify(obj),
  };
}

async function sendEmail(order) {
  const user = process.env.ORDER_SMTP_USER, pass = process.env.ORDER_SMTP_PASS;
  if (!user || !pass) return null;
  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    host: process.env.ORDER_SMTP_HOST || 'smtp.yandex.ru',
    port: Number(process.env.ORDER_SMTP_PORT || 465),
    secure: true,
    auth: { user, pass },
  });
  await transporter.sendMail({
    from: user,
    to: process.env.ORDER_EMAIL_TO || user,
    subject: 'Новый заказ с сайта: ' + order.name + ', ' + order.phone,
    text: order.text,
  });
  return { via: 'email', ok: true };
}

async function sendTelegram(order) {
  const token = process.env.ORDER_TG_BOT_TOKEN, chat = process.env.ORDER_TG_CHAT_ID;
  if (!token || !chat) return null;
  const r = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text: order.text, disable_web_page_preview: true }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.ok !== true) throw new Error('telegram ' + r.status);
  return { via: 'telegram', ok: true };
}

async function sendMax(order) {
  const token = process.env.ORDER_MAX_TOKEN;
  const user = process.env.ORDER_MAX_USER_ID, chat = process.env.ORDER_MAX_CHAT_ID;
  if (!token || !(user || chat)) return null;
  const qs = chat ? 'chat_id=' + encodeURIComponent(chat) : 'user_id=' + encodeURIComponent(user);
  const r = await fetch('https://platform-api.max.ru/messages?' + qs, {
    method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: order.text }),
  });
  if (!r.ok) throw new Error('max ' + r.status);
  return { via: 'max', ok: true };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return reply(405, { ok: false, error: 'method' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return reply(400, { ok: false, error: 'json' }); }

  // скрытое поле для роботов: человек его не заполняет
  if (body.website) return reply(200, { ok: true });

  const text = String(body.text || '').trim();
  const name = String(body.name || '').trim().slice(0, 80);
  const phone = String(body.phone || '').trim().slice(0, 40);
  if (text.length < 20 || text.length > MAX_TEXT || !name || phone.replace(/\D/g, '').length < 10) {
    return reply(400, { ok: false, error: 'bad data' });
  }

  const order = { text, name, phone };
  const jobs = [sendEmail, sendTelegram, sendMax].map((fn) => fn(order));
  const results = await Promise.allSettled(jobs);

  const configured = results.filter((r) => !(r.status === 'fulfilled' && r.value === null));
  if (!configured.length) return reply(500, { ok: false, error: 'not configured' });

  const delivered = results.filter((r) => r.status === 'fulfilled' && r.value && r.value.ok);
  results.forEach((r) => { if (r.status === 'rejected') console.error('order send failed:', String(r.reason && r.reason.message || r.reason)); });

  if (!delivered.length) return reply(502, { ok: false, error: 'send failed' });
  return reply(200, { ok: true, via: delivered.map((r) => r.value.via) });
};
