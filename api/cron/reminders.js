// Vercel scheduled job (see "crons" in vercel.json): sends the abandoned-cart reminder emails.
// On a normal server these run on a 30-minute timer instead (server/services/reminders.js).
const { connect } = require('../../server/serverless');
const { runCartReminders } = require('../../server/services/reminders');

module.exports = async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    res.statusCode = 401;
    return res.end('Unauthorized');
  }
  try {
    await connect();
    const sent = await runCartReminders();
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ ok: true, sent }));
  } catch (error) {
    console.error('[cron reminders]', error);
    res.statusCode = 500;
    return res.end(JSON.stringify({ ok: false }));
  }
};
