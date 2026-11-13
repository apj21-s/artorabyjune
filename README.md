# Artora by June

Storefront, custom-commission studio and admin for **Artora by June**, a studio selling hand-painted totes.

- **Shop:** ready-made totes with a cart, coupons, gift wrap, free-shipping threshold, and notify-me for sold-out items.
- **Commissions:** a 5-step "Dear June" letter. June sends a quote and sketch, the customer approves and pays a 50% deposit, then pays the balance before shipping.
- **Payments:** UPI straight to June's bank, no gateway. Checkout is three steps: details (email confirmed with a one-time code), pay by QR or UPI app, then send the 12-digit UTR and a screenshot. June matches each payment with her bank in **Admin → Payments** and approves or rejects it. Part payments, overpayments, refunds and interrupted approvals are handled.
- **Admin** at `/admin`: dashboard, orders and commissions, a payment review queue, products, coupons, reviews, site copy, messages, subscribers, admin access.
- **Shop extras:** search, saved totes (synced to the account), recently viewed, a photo lightbox, bundles, gift cards and store credit, and one abandoned-cart reminder (`server/services/reminders.js`).
- **Emails** through Gmail (free, no domain; swappable to any SMTP host or Resend by env vars), with an outbox log, duplicate protection and daily retries, **photo storage** through Cloudinary, optional Google sign-in and Plausible analytics.

The owner's guide (deploying, connecting services, daily use) is **[HANDOVER.md](HANDOVER.md)**.

## Stack

Plain HTML/CSS/ES modules with no build step, served by Node 20+ / Express 5 with MongoDB (Mongoose). Validation uses zod; security uses Helmet CSP, rate limits, same-origin checks, and httpOnly JWT cookies.

```
server/
  index.js          boot (validates env, connects Mongo, seeds default site copy)
  app.js            Express app: security headers, static /public, API, pages
  config.js         all env vars in one place; refuses weak secrets in production
  routes/           auth, me, public, orders (checkout/commissions/payments), admin, uploads, pages
  lib/              pricing (server-side only), money (what's due / paid), payments (UPI proof workflow),
                    email-code (checkout email codes), orders, stages/timeline, content defaults, page render
  models/           User, Product, Order, Coupon, GiftCard, CartDraft, Review, Content, Message, Subscriber, Counter,
                    PaymentRef (UTR reservations), ProofUpload, EmailCode
  services/         email (templates), cloudinary, upi (link + QR), maintenance (payment housekeeping), reminders
  scripts/          seed.js, create-admin.js, migrate-payments.js
views/              HTML pages + partials (header, footer, head), rendered with SEO meta
public/             the only folder served statically: css/, js/core, js/pages, assets/
tests/              node:test + supertest + in-memory MongoDB
tools/illustrations build.js: every SVG (artworks, tote mockups, animated spots, June, 404, favicon, textures, hero tote)
                    render-png.js: share images, email art, WebP texture (needs local Chrome)
```

### Look and illustrations
- `public/css/canvas.css` is the theme layer, loaded last: canvas weave, stitched seams, crumpled-paper letters, hang tags, receipts, labels and motion. It changes surfaces only, never behaviour.
- All artwork is generated. Edit `tools/illustrations/build.js`, then run `npm run illustrations` (SVGs, plus the hero tote injected between the `hero-tote` markers in `views/index.html`). Run `npm run illustrations:png` after changing anything that appears in a share image or email.
- Design rule from the client: no generic boxed tiles or label pills. Containers become studio objects (tags, labels, letters, polaroids, seams). A plain box is OK only when it holds a form.

`legacy-index.html` and `legacy-artorabyjune.js` are the original single-page version, kept for reference only. They are never served and can be deleted.

## Local development

```bash
npm install
cp .env.example .env          # set MONGODB_URI (local Mongo or Atlas) and JWT_SECRET
npm run seed                  # sample products, reviews and coupons
npm run create-admin -- you@example.com "a-strong-password" "June"
npm run dev                   # http://localhost:3000, restarts on change
npm test                      # API tests (downloads a MongoDB binary on first run)
```

Without email or Cloudinary keys the site still works locally. Emails are logged to the console, the checkout email code is skipped (set `REQUIRE_CHECKOUT_EMAIL_CODE=1` to test it; production always requires it), and uploads go to `./uploads` (payment screenshots to `./private_uploads`, never served).

`npm install` also copies the on-device screenshot reader (Tesseract.js, pinned in package.json) into `public/vendor/tesseract/` (`tools/vendor-tesseract.js`; not committed; Vercel runs it as the build step).

## Deploying

- **Render (recommended):** `render.yaml` is a Blueprint. See HANDOVER.md, step 2.
- **Docker / any VPS:** `docker build -t artora . && docker run -p 3000:3000 --env-file .env artora`. Put it behind HTTPS (Caddy, nginx or Cloudflare). For uploads on the server's disk instead of Cloudinary, set `ALLOW_LOCAL_UPLOADS=1` and mount `/app/uploads` as a volume.

Health check: `GET /api/health`.

## Notes for developers

- Prices are always computed on the server (`server/lib/pricing.js`). Client cart prices are display-only.
- Order numbers (`AJ-0001`) come from an atomic counter, so they stay unique under concurrent orders.
- Stock is checked at checkout and reduced when payment lands. If two people pay for the last item, the second order is flagged `OVERSOLD` in its internal notes and the admin gets an email.
- **UPI payments** (`server/lib/payments.js`, `server/lib/money.js`):
  - Order fulfilment stage (`order.status`), money state (`order.paymentStatus`, written only by `recomputeMoney`), each payment's review state (`pending → approving → paid | rejected`) and what's due (`amountDue`) are kept separate.
  - A UTR is reserved in `PaymentRef` (unique index) before the payment is saved, so the same transfer can't be attached to two orders even under concurrent requests. Rejecting frees it.
  - Approval is claim-then-finish. `finishApproval` is safe to repeat: stock (`Product.stockLedger`), coupon uses (`Coupon.usedByOrders`), gift card spends and issues (keyed on `GiftCard`) and emails (outbox keys) never happen twice. Stuck approvals show in the admin and are finished by the daily cron.
  - Screenshots are Cloudinary `authenticated` uploads into a server-chosen `public_id`; the server checks Cloudinary's upload-response signature and streams the image to admins only.
  - Checkout emails need a one-time code (`server/lib/email-code.js`): hashed, 10-minute expiry, 5 tries, 30 s resend wait, 5 per inbox and 20 per IP an hour, counted in Mongo.
  - Old Razorpay-era payment rows are kept and still display; `node server/scripts/migrate-payments.js --dry-run` recomputes money fields with the current rules.
- Admin can only edit whitelisted content keys (`EDITABLE_KEYS` in `server/lib/content.js`).
