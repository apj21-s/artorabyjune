# Artora by June: owner's guide

This guide covers putting the site online, connecting payments and emails, and running the studio day to day. No coding needed.

---

## 1. What you're getting

| Part | What it does |
|---|---|
| **Website** | Home, Shop, Commission ("Dear June" letter), Stories, Gifts, About, FAQ, Contact, Track order, and legal pages |
| **Customer accounts** | Customers see their orders, approve sketches, pay deposits and balances, and save addresses. Guests can order without an account. |
| **Admin** (`yoursite.com/admin`) | Orders and commissions, products, coupons, reviews, all site text and prices, messages, newsletter subscribers |
| **Emails** | Automatic emails for order received, quote ready, payment received, every stage update, shipped (with tracking) and review requests. You also get an alert for each new order. |
| **Shop extras** | Search (the magnifier, or press `/`), saved totes (the heart), recently viewed, a full-size photo viewer, "better together" bundles, gift cards, and one gentle reminder email for bags left at checkout |

**How a commission works:**
1. A customer writes to June → you get an email.
2. You open it in Admin → **Orders**, set a price, add a note and a sketch photo → **Send quote**.
3. The customer approves and pays a **50% deposit**. If they want changes, they ask for them on the same page before paying.
4. You move it through the stages (Painting → Sealing → Packing). The customer gets an email at each step.
5. Before shipping, the customer pays the **balance**. You add the courier tracking number and mark it **Shipped**.
6. When you mark it **Delivered**, the customer is asked for a review. Reviews appear on the site only after you approve them.

**Shop orders** are paid in full at checkout.

---

## 2. Putting it online (about 1 hour, once)

You need four free accounts. Keep each password somewhere safe.

### a. Database: MongoDB Atlas (free)
1. Sign up at **mongodb.com/atlas** → create a **free M0** cluster (choose Mumbai if offered).
2. **Database Access** → add a user with a password.
3. **Network Access** → add `0.0.0.0/0` (allow from anywhere; the password protects it).
4. **Connect → Drivers** → copy the connection string. Replace `<password>` with your password, and add `artora` before the `?`, like `...mongodb.net/artora?retryWrites=...`. This is your `MONGODB_URI`.

### b. Hosting: Render
1. Put this code in a GitHub repository (private is fine).
2. Sign up at **render.com** → **New → Blueprint** → choose the repository. Render reads `render.yaml` and asks for the settings below.
3. Fill in at least these:
   - `APP_URL`: your site address with `https://`. Use the Render address (e.g. `https://artora-by-june.onrender.com`) until you have a domain.
   - `MONGODB_URI`: from step a.
   - `INITIAL_ADMIN_EMAILS`: June's email. Signing up with this email makes the account an admin.
   - Leave the rest blank for now. `JWT_SECRET` is generated for you.
4. Click **Apply**. After a few minutes the site is live.
5. Open `APP_URL/login` → **Create account** with June's email. You're now an admin. Go to `/admin`.

> The **Starter** plan (about US$7/month) keeps the site awake. The free plan works but takes ~30 seconds to wake up after being idle, which isn't good for a shop.

### c. Emails: Gmail (free, no domain needed)
The site sends every email (enquiries, order and payment confirmations, stage updates, password resets, gift cards) from a Gmail account. Customers' replies land in that same inbox.
1. Sign in to the Gmail account the studio will use. Go to **myaccount.google.com/security** and turn on **2-Step Verification**.
2. Open **myaccount.google.com/apppasswords**, type a name such as `Artora website`, press **Create**, and copy the 16-letter password. (This password only lets the site send mail; your normal password stays private. Delete it there any time to cut access.)
3. In Vercel → Project → **Settings → Environment Variables**, add for Production:
   - `GMAIL_USER`: the Gmail address
   - `GMAIL_APP_PASSWORD`: the 16 letters
   - `ADMIN_NOTIFY_EMAIL`: where enquiries and order alerts should arrive (can be the same Gmail)
   - `SUPPORT_EMAIL`: the address shown on the contact page (usually the same Gmail)
4. Redeploy, then open Admin → **Messages** → **Send test email**.

Until this is connected, the site works and saves every enquiry in Admin → Messages, but **no emails are sent**.

**Good to know**
- Gmail allows about 500 emails a day, which is plenty for a small studio. Restock alerts beyond what fits are sent the next day.
- The first emails may land in Spam for some customers. Ask early customers to mark them "Not spam"; it improves quickly.
- Admin → Messages shows an **Email log**. Anything that failed is retried automatically once a day, or press **Retry**.
- Newsletters: the site collects newsletter sign-ups (Admin → Subscribers → CSV), but Gmail must not be used for bulk marketing. Import the CSV into a free newsletter tool (e.g. Brevo) if you want to send one.
- Later, with your own domain: set `RESEND_API_KEY` + `RESEND_FROM_EMAIL` (or `SMTP_*`) and the site switches over with no code change.

### d. Photo storage: Cloudinary (free tier)
Needed for customer reference photos, your sketches, and product photos.
1. Sign up at **cloudinary.com** → Dashboard shows **Cloud name**, **API key** and **API secret**.
2. Paste them into Render as `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`.

### e. Payments: UPI (no fees, no sign-up)
Customers pay straight into your bank through your **UPI ID**. There's nothing to sign up for and no fee per payment.

1. Admin → **Site content** → **Money & delivery** → **UPI ID customers pay** (e.g. `june@okhdfc`) and the **Name shown in the UPI app**. The site refuses anything that doesn't look like a UPI ID.
2. That's it. At checkout the customer sees a QR code and, on a phone, buttons that open Google Pay, PhonePe or Paytm with the amount and order number filled in.
3. After paying, the customer types the **12-digit UTR** (the UPI reference) and uploads a **screenshot**. The site can read the UTR off the screenshot for them, on their phone. They always check it before sending.
4. You get an email: **"Check UPI payment · AJ-0042 · ₹1,199"**. The order isn't confirmed until you approve it (see "Checking a UPI payment" below).

**Emails must be connected (section c).** Every checkout email is confirmed with a 6-digit code, so fake or mistyped addresses can't place orders. In production, if emails stop working, checkout pauses (customers see a message to contact you on Instagram/WhatsApp) instead of letting unconfirmed addresses through, and the Admin overview shows a red notice.

Screenshots are private: only admins can see them, through the admin. They're deleted automatically 180 days after an order is settled; the UTR and your bank-check notes stay on the order.

### f. Your own domain (optional, ~₹800–1,500/year)
Buy a domain (GoDaddy, Namecheap, Hostinger…). In Render → your service → **Settings → Custom Domains**, add it and follow the DNS steps. Then change `APP_URL` to the new `https://` address.

### g. Extras (optional)
- **Google sign-in:** `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` from console.cloud.google.com, with redirect URI `APP_URL/api/auth/google/callback`.
- **Visitor stats:** sign up at plausible.io and set `PLAUSIBLE_DOMAIN` to your domain.

After changing any setting in Render, it restarts the site by itself.

---

## 3. Before you launch

The **Before launch** card on the Admin overview tracks this list:

- [ ] Emails and photo storage connected (sections c–d above)
- [ ] **Commission prices and turnaround** set (Admin → Site content → Tiers)
- [ ] **Your UPI ID** added (Admin → Site content → Money & delivery)
- [ ] One real ₹1 test: buy something cheap (or make a ₹1 coupon), pay from your own phone, send the UTR and screenshot, and approve it in Admin → Payments. Do this on an Android phone and an iPhone if you can, and try the Google Pay, PhonePe and Paytm buttons.
- [ ] **Sample products** replaced with real ones and real photos (Admin → Products)
- [ ] **Sample reviews** replaced with real ones (Admin → Reviews)
- [ ] **Privacy, Terms, Shipping & Returns** pages read and adjusted for your business. Add your business address and GST number if you have one.
- [ ] Place one test order of each kind (shop and commission) and walk it through to "Delivered"

---

## 4. Everyday tasks

| I want to… | Go to |
|---|---|
| Reply to a new commission | Admin → **Orders** → open it → **Send quote** (price, note, sketch photo) |
| Move an order to the next stage | Open the order → pick the stage → **Update**. The customer is emailed automatically. Untick **Email the customer** to skip that. |
| Add shipping tracking | Open the order → fill in the courier, tracking number and tracking link → mark **Shipped** |
| Check a UPI payment | Admin → **Payments** (or the email link) → see "Checking a UPI payment" below |
| Record money paid another way (cash, a transfer they didn't send proof for) | Open the order → **Record UPI/cash payment** |
| Refund someone | Send the money back by UPI first, then open the order → **Record refund** (amount and a short note). The customer gets an email. |
| Add or edit a product | Admin → **Products** → **+ New**. The first photo is the cover. Stock 0 shows "Sold out". Raising stock emails everyone who asked to be notified. |
| Run a sale | Admin → **Coupons** → percent or flat amount, minimum order, expiry, usage limit |
| Pair two totes as a bundle | Admin → **Products** → open one → **Bundle with** (the other product's slug, e.g. `sunflower-pouch`) and **Bundle discount (₹)**. When both are in a bag, the discount comes off automatically. |
| Sell gift cards | Two are ready in Products (₹500 and ₹1,000). Add more with **+ New** and **Type: Gift card**. When one is paid, a code is emailed to the recipient automatically. |
| Give store credit (instead of a refund) | Admin → **Gift cards** → **+ New** → set the value. Leave the code empty and one is created. Send the customer the code. |
| Show a photo with a review | Admin → **Reviews** → open it → **Photo in the testimonials**: upload one, or tap one of your own totes or paintings |
| Turn cart reminders on or off | Admin → **Site content** → **Money & delivery** → "Email one reminder when someone leaves a bag at checkout". It sends at most one email, 6 hours later, with a one-click opt-out. |
| Change prices, FAQs, homepage text, shipping fee, gift wrap fee, deposit % | Admin → **Site content** |
| Approve a review | Admin → **Reviews** → tick **Approved** (and **Featured** to put it on the home page) |
| Read contact form messages | Admin → **Messages** |
| Download orders or subscribers | **Export CSV** button on Orders and Subscribers |
| Give someone else admin access | Admin → **Admin access** → add their email. They sign up with that email. |

### Checking a UPI payment
1. Open **Admin → Payments**. The oldest payment waiting is at the top; anything older than a day is in red.
2. Press **Review**. The screenshot is on the left (zoom with + and −, rotate, or open it full size). What the customer sent is on the right.
3. Open your bank or UPI app and **search for the UTR** (use the **copy** link). Check the money is really there.
4. Fill in **What your bank shows**: the amount received (already filled with the amount due), optionally the date and the sender's name, and tick **UTR matches my bank app**.
5. Press **Approve payment**. The customer gets a "Payment confirmed" email, stock is taken off, and the order moves to **Payment confirmed**.

**If the amount is different:** type what actually arrived. The site asks you to tick "My bank shows ₹…" to be sure.
- **Less** than due: it's recorded as a part payment, the order is not confirmed, and the customer is asked for the rest on their order page.
- **More** than due: the order is marked **Overpaid** and "What needs you today" reminds you to refund the extra. Send it back by UPI, then press **Record refund** on the order.

**If you can't find it:** pick a reason (Screenshot unclear, Amount doesn't match, UTR not found, Payment not received yet, or your own words) and press **Reject**. The customer gets an email with your note and can send a new UTR or screenshot from their order page. Their order stays saved. After 5 tries an order stops accepting proofs and you get an email to sort it out with them directly.

**If an approval was interrupted** (bad connection, the page closed): "What needs you today" shows it. Open it and press **Finish approval**. It's safe: stock, coupons, gift cards and emails are never done twice. The daily job also finishes any it finds.

**The same UTR can't be used twice**, on any order. If you reject a payment, its UTR is freed so the customer can resend it with a clearer screenshot. Cancelling an order also closes any payment still waiting.

**If something sells twice:** one-of-a-kind totes are reserved when payment arrives. If two people pay for the last one at the same moment, you get an email titled "Action needed", and the second order has an **OVERSOLD** note. Contact that customer to offer a repaint, a swap or a refund.

---

## 5. Monthly costs (approximate, check current prices)

| Service | Cost |
|---|---|
| Render Starter | ~US$7/month |
| MongoDB Atlas M0 | Free |
| Cloudinary | Free tier covers a small shop |
| Gmail (emails) | Free, about 500 emails/day |
| UPI payments | Free (straight to your bank) |
| Domain | ~₹800–1,500/year |

---

## 6. If something goes wrong

- **Site won't start:** Render → your service → **Logs**. The first lines say exactly which setting is missing (e.g. "JWT_SECRET must be…").
- **No emails arriving:** Admin → Messages → **Send test email**. "Login failed" means the App Password is wrong or was deleted: create a new one and update `GMAIL_APP_PASSWORD`. Otherwise check the Email log and the customer's spam folder.
- **Photo upload says it isn't set up:** add the three Cloudinary settings.
- **Customer says they paid but nothing is in Admin → Payments:** they haven't sent the UTR and screenshot yet. Send them their order link (open the order → **Copy customer link**) so they can do it from the order page. If they paid but can't send proof, check your bank and use **Record UPI/cash payment**.
- **Checkout says it's paused:** emails aren't working, so email codes can't be sent. Fix emails (Admin → Messages → **Send test email**); checkout reopens by itself.
- **Customer didn't get the email code:** it can take a minute, and it may be in spam. They can ask for a new one after 30 seconds (at most 5 an hour).
- **Forgot admin password:** use "Forgot your password?" on the login page (needs emails connected). A developer can also run `npm run create-admin -- email "new-password"`.
- **Backups:** MongoDB Atlas free tier has no automatic backups. Once a month, export orders as CSV from the admin, or upgrade Atlas for automatic backups.
