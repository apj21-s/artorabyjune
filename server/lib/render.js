const fs = require('fs');
const path = require('path');
const config = require('../config');
const { escapeHtml } = require('./util');

const VIEWS = path.join(__dirname, '..', '..', 'views');
const cache = new Map();

function read(file) {
  if (config.isProd && cache.has(file)) return cache.get(file);
  const text = fs.readFileSync(path.join(VIEWS, file), 'utf8');
  if (config.isProd) cache.set(file, text);
  return text;
}

const DEFAULT_DESCRIPTION = 'Hand-painted custom tote bags by June. Send a memory, approve a sketch, and carry a one-of-one canvas story. Ready-made totes and custom commissions, shipped pan-India.';

function analyticsTag() {
  if (!config.plausibleDomain) return '';
  return `<script defer data-domain="${escapeHtml(config.plausibleDomain)}" src="https://plausible.io/js/script.js"></script>`;
}

function organizationJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: config.brand.name,
    url: config.appUrl,
    logo: `${config.appUrl}/assets/icon-512.png`,
    sameAs: [`https://instagram.com/${config.brand.instagram}`],
  };
}

// Renders views/<template> with shared partials and per-page meta.
function render(template, meta = {}) {
  const pagePath = meta.path || '/';
  const title = meta.title ? `${meta.title} · Artora by June` : 'Artora by June — Hand-Painted Custom Totes';
  const jsonld = [organizationJsonLd(), ...(meta.jsonld || [])]
    .map((obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`)
    .join('\n');
  const vars = {
    title: escapeHtml(title),
    description: escapeHtml(meta.description || DEFAULT_DESCRIPTION),
    canonical: escapeHtml(`${config.appUrl}${pagePath}`),
    ogImage: escapeHtml(meta.ogImage ? (meta.ogImage.startsWith('http') ? meta.ogImage : `${config.appUrl}${meta.ogImage}`) : `${config.appUrl}/assets/og-image.png`),
    ogType: meta.ogType || 'website',
    robots: meta.noindex ? 'noindex, nofollow' : 'index, follow',
    bodyClass: escapeHtml(meta.bodyClass || ''),
    page: escapeHtml(meta.page || ''),
    jsonld,
    analytics: analyticsTag(),
    year: String(new Date().getFullYear()),
    instagram: escapeHtml(config.brand.instagram),
  };
  let html = read(template);
  html = html.replace(/\{\{>\s*([\w-]+)\s*\}\}/g, (_, name) => read(`partials/${name}.html`));
  // Partials can use variables too, so replace after including.
  html = html.replace(/\{\{>\s*([\w-]+)\s*\}\}/g, (_, name) => read(`partials/${name}.html`));
  html = html.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => (key in vars ? vars[key] : match));
  return html;
}

module.exports = { render, VIEWS };
