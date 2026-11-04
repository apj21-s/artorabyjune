const fs = require('fs');
const path = require('path');
const express = require('express');
const config = require('../config');
const { Product } = require('../models');
const { getContent } = require('../lib/content');
const { render } = require('../lib/render');

const router = express.Router();

const PAGES = {
  '/': { template: 'index.html', page: 'home', jsonldKey: 'home' },
  '/shop': { template: 'shop.html', page: 'shop', title: 'Shop ready-made totes', description: 'One-of-one hand-painted totes, ready to carry. Limited drops painted by June, shipped pan-India.' },
  '/commission': { template: 'commission.html', page: 'commission', title: 'Commission a custom tote', description: 'Write June a note about your memory. Get a sketch and quote, approve it, and she’ll hand-paint it onto your tote.' },
  '/stories': { template: 'stories.html', page: 'stories', title: 'Stories we’ve painted', description: 'Movie nights, pets, couples, skylines — a board of memories June has painted onto canvas.' },
  '/about': { template: 'about.html', page: 'about', title: 'About June & the studio', description: 'Every Artora tote is sketched, mixed, painted and sealed by hand by June.' },
  '/gifts': { template: 'gifts.html', page: 'gifts', title: 'Gifting guide', description: 'Hand-painted gifts for birthdays, couples, pet parents, farewells and festivals — with a delivery-date planner.' },
  '/faq': { template: 'faq.html', page: 'faq', title: 'Questions, answered', description: 'How commissions, payments, shipping and paint care work at Artora by June.' },
  '/contact': { template: 'contact.html', page: 'contact', title: 'Contact the studio', description: 'Write to June about commissions, bulk gifting or an existing order.' },
  '/track': { template: 'track.html', page: 'track', title: 'Track your order', description: 'See where your story is, from sketch to doorstep.' },
  '/checkout': { template: 'checkout.html', page: 'checkout', title: 'Checkout', noindex: true },
  '/login': { template: 'login.html', page: 'login', title: 'Sign in', noindex: true },
  '/reset-password': { template: 'reset.html', page: 'reset', title: 'Reset password', noindex: true },
  '/account': { template: 'account.html', page: 'account', title: 'Your studio', noindex: true },
  '/admin': { template: 'admin.html', page: 'admin', title: 'Studio admin', noindex: true, bodyClass: 'is-admin' },
  '/privacy': { template: 'legal/privacy.html', page: 'legal', title: 'Privacy policy' },
  '/terms': { template: 'legal/terms.html', page: 'legal', title: 'Terms of service' },
  '/shipping-returns': { template: 'legal/shipping-returns.html', page: 'legal', title: 'Shipping, returns & refunds' },
};

const SITEMAP_PATHS = ['/', '/shop', '/commission', '/stories', '/about', '/gifts', '/faq', '/contact', '/track', '/privacy', '/terms', '/shipping-returns'];

function send(res, template, meta) {
  res.set('Cache-Control', 'no-cache');
  res.type('html').send(render(template, meta));
}

for (const [route, meta] of Object.entries(PAGES)) {
  router.get(route, async (_req, res) => {
    const extra = {};
    if (meta.jsonldKey === 'home') {
      extra.jsonld = [{
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: config.brand.name,
        url: config.appUrl,
      }];
    }
    if (route === '/faq') {
      const faqs = await getContent('faqs');
      extra.jsonld = [{
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.question, acceptedAnswer: { '@type': 'Answer', text: f.answer } })),
      }];
    }
    send(res, meta.template, { ...meta, ...extra, path: route });
  });
}

router.get('/shop/:slug', async (req, res, next) => {
  const product = await Product.findOne({ slug: req.params.slug, status: 'live' }).lean();
  if (!product) return next();
  send(res, 'product.html', {
    page: 'product',
    path: `/shop/${product.slug}`,
    title: product.title,
    description: product.summary || product.description?.slice(0, 160) || undefined,
    // Social networks can't show SVG; use the rendered share image when there is one.
    ogImage: fs.existsSync(path.join(__dirname, '..', '..', 'public', 'assets', 'og', `${product.slug}.png`)) ? `/assets/og/${product.slug}.png` : (product.images?.[0]?.endsWith('.svg') ? undefined : product.images?.[0]),
    ogType: 'product',
    jsonld: [{
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: product.title,
      description: product.summary || product.description || '',
      image: (product.images || []).map((i) => (i.startsWith('http') ? i : `${config.appUrl}${i}`)),
      brand: { '@type': 'Brand', name: config.brand.name },
      offers: {
        '@type': 'Offer',
        priceCurrency: 'INR',
        price: product.price,
        availability: product.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        url: `${config.appUrl}/shop/${product.slug}`,
      },
    }, {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${config.appUrl}/` },
        { '@type': 'ListItem', position: 2, name: 'Shop', item: `${config.appUrl}/shop` },
        { '@type': 'ListItem', position: 3, name: product.title, item: `${config.appUrl}/shop/${product.slug}` },
      ],
    }],
  });
});

router.get('/stories/:slug', async (req, res, next) => {
  const items = await getContent('portfolio');
  const story = items.find((i) => i.slug === req.params.slug);
  if (!story) return next();
  send(res, 'story.html', {
    page: 'story',
    path: `/stories/${story.slug}`,
    title: story.title,
    description: story.memory,
    ogImage: story.image && !story.image.endsWith('.svg') ? story.image : undefined,
    jsonld: [{
      '@context': 'https://schema.org',
      '@type': 'CreativeWork',
      name: story.title,
      abstract: story.memory,
      genre: story.category,
      creator: { '@type': 'Person', name: 'June', affiliation: config.brand.name },
      url: `${config.appUrl}/stories/${story.slug}`,
    }],
  });
});

router.get('/order/:number', (req, res) => {
  send(res, 'order.html', { page: 'order', path: `/order/${encodeURIComponent(req.params.number)}`, title: `Order ${req.params.number}`, noindex: true });
});

router.get('/robots.txt', (_req, res) => {
  res.type('text/plain').send([
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    'Disallow: /account',
    'Disallow: /checkout',
    'Disallow: /order/',
    'Disallow: /api/',
    `Sitemap: ${config.appUrl}/sitemap.xml`,
  ].join('\n'));
});

router.get('/sitemap.xml', async (_req, res) => {
  const [products, portfolio] = await Promise.all([
    Product.find({ status: 'live' }).select('slug updatedAt').lean(),
    getContent('portfolio'),
  ]);
  const urls = [
    ...SITEMAP_PATHS.map((p) => ({ loc: `${config.appUrl}${p}` })),
    ...products.map((p) => ({ loc: `${config.appUrl}/shop/${p.slug}`, lastmod: p.updatedAt?.toISOString().slice(0, 10) })),
    ...portfolio.map((s) => ({ loc: `${config.appUrl}/stories/${s.slug}` })),
  ];
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n')}
</urlset>`);
});

function notFoundPage(_req, res) {
  res.status(404).type('html').send(render('404.html', { page: 'notfound', title: 'Page not found', noindex: true }));
}

module.exports = { router, notFoundPage, PAGES };
