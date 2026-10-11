const { loadConfig, handleCallbackQuery } = require('./_store');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let update = req.body || {};
  if (typeof update === 'string') {
    try {
      update = JSON.parse(update);
    } catch (e) {}
  }

  if (!update || Object.keys(update).length === 0) {
    try {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      if (chunks.length > 0) {
        const raw = Buffer.concat(chunks).toString('utf8');
        update = JSON.parse(raw);
      }
    } catch (e) {}
  }

  const config = loadConfig();

  if (update && update.callback_query) {
    try {
      await handleCallbackQuery(update.callback_query, config.telegram_bot_token);
    } catch (e) {
      console.error('Error handling webhook callback query:', e);
    }
  }

  return res.status(200).json({ ok: true });
};
