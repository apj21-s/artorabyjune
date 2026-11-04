const crypto = require('crypto');
const config = require('../config');

// Signed direct-to-Cloudinary uploads: the browser uploads, the secret never leaves the server.
function signUpload(folder) {
  const timestamp = Math.round(Date.now() / 1000);
  const params = { folder, timestamp };
  const toSign = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
  const signature = crypto.createHash('sha1').update(toSign + config.cloudinary.apiSecret).digest('hex');
  return {
    provider: 'cloudinary',
    timestamp,
    signature,
    folder,
    apiKey: config.cloudinary.apiKey,
    cloudName: config.cloudinary.cloudName,
  };
}

module.exports = { signUpload };
