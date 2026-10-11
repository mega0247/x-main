const { loadConfig } = require('./_store');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const config = loadConfig();
  return res.status(200).json({
    Page_LicenseKey: config.Page_LicenseKey,
    telegramChatID: config.telegram_chat_id,
    systemValue: config.systemValue
  });
};
