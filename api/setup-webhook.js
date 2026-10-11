const { loadConfig, callTelegram } = require('./_store');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const config = loadConfig();
  const botToken = config.telegram_bot_token;

  if (!botToken) {
    return res.status(400).json({ error: 'No bot token configured' });
  }

  const action = req.query.action || 'info';
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const defaultWebhookUrl = `${protocol}://${host}/api/webhook`;

  if (action === 'set') {
    const url = req.query.url || defaultWebhookUrl;
    const setRes = await callTelegram(botToken, 'setWebhook', {
      url,
      allowed_updates: ['message', 'callback_query']
    });
    return res.status(200).json({ action: 'setWebhook', url, result: setRes });
  }

  if (action === 'delete') {
    const delRes = await callTelegram(botToken, 'deleteWebhook', { drop_pending_updates: false });
    return res.status(200).json({ action: 'deleteWebhook', result: delRes });
  }

  const infoRes = await callTelegram(botToken, 'getWebhookInfo');
  return res.status(200).json({
    action: 'getWebhookInfo',
    defaultWebhookUrl,
    webhookInfo: infoRes.result || infoRes,
    instructions: {
      to_set_webhook: `${protocol}://${host}/api/setup-webhook?action=set`,
      to_delete_webhook: `${protocol}://${host}/api/setup-webhook?action=delete`
    }
  });
};
