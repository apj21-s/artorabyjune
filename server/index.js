const mongoose = require('mongoose');
const config = require('./config');
const { createApp } = require('./app');
const { seedContent } = require('./lib/content');

async function main() {
  const problems = config.validate();
  if (problems.length) {
    console.error('\nArtora by June cannot start:\n');
    problems.forEach((p) => console.error(`  • ${p}`));
    console.error('\nSee .env.example and HANDOVER.md.\n');
    process.exit(1);
  }

  await mongoose.connect(config.mongoUri);
  await seedContent();

  require('./services/reminders').startReminders();
  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`Artora by June is running at ${config.appUrl} (port ${config.port})`);
    const off = Object.entries(config.features).filter(([, on]) => !on).map(([name]) => name);
    if (off.length) console.log(`Not yet connected: ${off.join(', ')} — see HANDOVER.md`);
  });

  const shutdown = async () => {
    server.close();
    await mongoose.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
