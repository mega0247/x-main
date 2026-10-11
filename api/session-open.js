const { loadConfig, callTelegram, escapeHtml } = require('./_store');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const data = req.body || {};
  const config = loadConfig();
  const botToken = config.telegram_bot_token;
  const chatId = (data.telegramChatID && data.telegramChatID !== '---') ? data.telegramChatID : config.telegram_chat_id;

  if (botToken && chatId && data.message) {
    await callTelegram(botToken, 'sendMessage', {
      chat_id: chatId,
      text: `🌐 <b>Visitor Opened Portal</b>\n<pre>${escapeHtml(data.message)}</pre>`,
      parse_mode: 'HTML'
    });
  }
  return res.status(200).json({ status: 'ok' });
};
