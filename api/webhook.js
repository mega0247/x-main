const { loadConfig, handleCallbackQuery } = require('./_store');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const update = req.body || {};
  const config = loadConfig();

  if (update.callback_query && config.telegram_bot_token) {
    try {
      await handleCallbackQuery(update.callback_query, config.telegram_bot_token);
    } catch (e) {}
  }

  return res.status(200).json({ ok: true });
};
