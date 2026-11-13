// Vercel scheduled job (see "crons" in vercel.json): sends the abandoned-cart reminder emails,
// then retries any email that failed and sends queued bulk emails (restock alerts). It also does
// the payment housekeeping in server/services/maintenance.js.
// On a normal server these run on a 30-minute timer instead (server/services/reminders.js).
const { connect } = require('../../server/serverless');
const { runCartReminders } = require('../../server/services/reminders');
const { processOutbox } = require('../../server/services/email');
const { runPaymentMaintenance } = require('../../server/services/maintenance');

module.exports = async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    res.statusCode = 401;
    return res.end('Unauthorized');
  }
  try {
    await connect();
    // Payments first: interrupted approvals and their receipt emails matter most.
    const payments = await runPaymentMaintenance({ deadline: Date.now() + 15_000 });
    const sent = await runCartReminders();
    const outbox = await processOutbox({ deadline: Date.now() + 35_000 });
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ ok: true, payments, sent, outbox }));
  } catch (error) {
    console.error('[cron reminders]', error);
    res.statusCode = 500;
    return res.end(JSON.stringify({ ok: false }));
  }
};
