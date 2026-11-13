const QRCode = require('qrcode');

// A UPI ID looks like name@bank. Checked when June saves it, and again before it's put in a link.
const UPI_ID_RE = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/;

function isValidUpiId(value) {
  return UPI_ID_RE.test(String(value || ''));
}

// Standard UPI deep link (NPCI "upi://pay"). Every part is encoded.
function upiUri({ upiId, upiName, amount, note }) {
  const params = [
    ['pa', upiId],
    ['pn', upiName || 'Artora by June'],
    ['am', Number(amount).toFixed(2)],
    ['cu', 'INR'],
    ['tn', note],
  ];
  return `upi://pay?${params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
}

// The QR is drawn on the server (nothing is sent to a QR website) and returned as SVG markup,
// which the page shows as an <img src="data:…">, never as live HTML.
async function qrSvg(text) {
  return QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#221D19', light: '#FBF8F1' } });
}

module.exports = { UPI_ID_RE, isValidUpiId, upiUri, qrSvg };
