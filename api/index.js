// Vercel entry: every page and API request is routed here (see vercel.json).
const { createApp } = require('../server/app');
const { connect, startupFailed } = require('../server/serverless');

const app = createApp();

module.exports = async (req, res) => {
  try {
    await connect();
  } catch (error) {
    return startupFailed(res, error);
  }
  return app(req, res);
};
