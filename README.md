# Kavanah Pouch

One-product ecommerce site for **KavanahPouch.com** — a signal-blocking phone pouch for focused davening.

**Stack:** Node.js · Express · PostgreSQL · Stripe Checkout · Vanilla JS frontend  
**Deploy:** Docker · Coolify · Hostinger KVM  
**Domain:** kavanahpouch.com (Porkbun DNS)

---

## Quick Start (local dev)

```bash
cp .env.example .env
# Fill in .env with your local Postgres URL and Stripe test keys

npm install
npm run migrate        # Run DB migrations
npm run seed-admin     # Create admin user from ADMIN_EMAIL + ADMIN_INITIAL_PASSWORD
npm run dev            # Start with nodemon on port 3000
```

Visit `http://localhost:3000` for the storefront, `http://localhost:3000/admin` for the dashboard.

---

## Environment Variables

See `.env.example` for the full list. Key variables:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | Long random string (64+ chars) |
| `STRIPE_SECRET_KEY` | Stripe secret key (`sk_test_…` or `sk_live_…`) |
| `STRIPE_WEBHOOK_SECRET` | From Stripe webhook dashboard (`whsec_…`) |
| `STRIPE_PRICE_SINGLE` | Stripe Price ID for 1-pouch product |
| `STRIPE_PRICE_TWO_PACK` | Stripe Price ID for 2-pack |
| `STRIPE_PRICE_THREE_PACK` | Stripe Price ID for 3-pack |
| `APP_BASE_URL` | Full public URL, e.g. `https://kavanahpouch.com` |
| `ADMIN_EMAIL` | Used by `npm run seed-admin` |
| `ADMIN_INITIAL_PASSWORD` | Used by `npm run seed-admin` — remove after first login |

SMTP variables (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, etc.) are optional. If not set, owner email notifications are silently skipped.

---

## NPM Scripts

| Script | Description |
|---|---|
| `npm start` | Production start |
| `npm run dev` | Dev with nodemon auto-reload |
| `npm run migrate` | Run all SQL migrations in `migrations/` |
| `npm run seed-admin` | Create/update admin user from env vars |

---

## Stripe Setup

1. Create three products in Stripe Dashboard (or Stripe CLI):
   - **1 Kavanah Pouch** — $14.99
   - **2-Pack Kavanah Pouch** — $24.99
   - **3-Pack Kavanah Pouch** — $34.99
2. Copy the **Price IDs** (`price_…`) into `.env`.
3. Create a webhook endpoint in Stripe pointing to `https://kavanahpouch.com/api/stripe/webhook`.
4. Enable event: `checkout.session.completed` (also optionally `charge.refunded`, `checkout.session.expired`).
5. Copy the **Webhook Secret** (`whsec_…`) into `.env`.

Use test keys (`sk_test_…`) until you have verified end-to-end checkout in test mode.

---

## Database Migrations

Migrations live in `migrations/`. Run manually:

```bash
npm run migrate
# or directly:
psql $DATABASE_URL -f migrations/001_initial_schema.sql
```

Run once on first deploy, or whenever you add new migration files.

---

## Admin Dashboard

- URL: `/admin/login`
- Create your first admin user: `npm run seed-admin`
- Remove `ADMIN_INITIAL_PASSWORD` from environment after first login
- Session expires after 8 hours

### Admin features
- Dashboard stats (orders, inventory, waitlist, inquiries)
- Orders list with filter by fulfillment status
- Order detail with tracking number entry and status updates
- **Pirate Ship CSV export** — `/admin/orders/export/pirate-ship.csv`
  - Exports all `paid + unfulfilled` orders
  - Automatically marks them `exported` after download
- Inventory management (set quantity, low-stock threshold)
- Waitlist signups
- Bulk inquiries with status workflow
- Support messages with status workflow
- Customer feedback

---

## Deployment on Coolify (Hostinger KVM)

### One-time setup

1. **Push this repo to GitHub** (already done if you're reading this).
2. In Coolify, create a **new application** from the GitHub repo.
3. Set build pack: **Dockerfile**.
4. Set port: **3000**.
5. Add a **PostgreSQL** database resource in the same Coolify project.
6. Copy the Coolify-generated `DATABASE_URL` into the app's environment variables.
7. Add all other required env vars (Stripe keys, session secret, etc.).
8. Set domains: `kavanahpouch.com` and `www.kavanahpouch.com`.
9. Enable **HTTPS / Let's Encrypt** in Coolify.
10. Deploy.

### After first deploy

```bash
# In the Coolify terminal for the app container:
npm run migrate
npm run seed-admin
```

### Redeploy

Push to the connected branch → Coolify auto-deploys.

---

## DNS Setup (Porkbun → Hostinger KVM)

In your Porkbun DNS panel, add:

| Type | Host | Value | TTL |
|---|---|---|---|
| A | `@` | `YOUR_HOSTINGER_KVM_IP` | 600 |
| CNAME | `www` | `kavanahpouch.com` | 600 |

After DNS propagates (up to 24h, usually minutes):
- Attach both domains in Coolify
- Enable HTTPS — Coolify issues a Let's Encrypt certificate automatically
- Canonical domain: `https://kavanahpouch.com` (www redirects to root)

### Stripe webhook URL (after DNS is live)
```
https://kavanahpouch.com/api/stripe/webhook
```

---

## Shipping Workflow

1. Admin logs in → views unfulfilled paid orders
2. Click **Export CSV (Pirate Ship)** → downloads `pirate-ship-*.csv`
3. Upload CSV to [Pirate Ship](https://www.pirateship.com) → buy USPS Ground Advantage labels
4. Print labels, ship packages
5. In admin order detail → enter tracking number → Save
6. Mark fulfillment status → **shipped**

---

## Package Defaults

Update after weighing your sample pouch in a poly mailer:

```env
DEFAULT_PACKAGE_WEIGHT_OZ=8
DEFAULT_PACKAGE_LENGTH_IN=13
DEFAULT_PACKAGE_WIDTH_IN=10
DEFAULT_PACKAGE_HEIGHT_IN=1
```

---

## Customer Email Flow

Three separate systems send email. Each handles a distinct role:

| Email | Sender | Trigger |
|---|---|---|
| Payment receipt | **Stripe** | Immediately after successful payment |
| Order confirmation | **Kavanah Pouch app** | After webhook verifies payment and saves order to DB |
| Shipping / tracking | **Pirate Ship** | After you purchase the postage label in Pirate Ship |

The app only sends the **order confirmation**. It does not duplicate the Stripe receipt or the Pirate Ship tracking email.

### Order Confirmation Email

Triggered in `webhookRoutes.js` after `createOrderFromStripe` succeeds. Idempotency is guaranteed because `createOrderFromStripe` returns `null` for duplicate webhook events — if the order already exists, no email is sent again.

Email status is tracked in the `orders` table:

| Column | Values |
|---|---|
| `order_confirmation_email_status` | `pending` · `sent` · `failed` |
| `order_confirmation_email_sent_at` | Timestamp of successful send |
| `order_confirmation_email_error` | Error message if send failed |

Email failures are logged and visible in the admin dashboard. They do not affect payment or fulfillment status.

The **Order Email** card in each admin order detail page shows current email status and a **Resend Confirmation Email** button (paid orders only).

### Email Provider Setup (Resend)

The app uses [Resend](https://resend.com) for transactional email.

1. Log into [resend.com](https://resend.com).
2. Generate an API key and set `RESEND_API_KEY` in your environment.
3. The default sending domain is `artcertify.store` (already verified on this account).
4. To send from `orders@kavanahpouch.com`:
   - Go to **Domains** in Resend → Add `kavanahpouch.com`.
   - Add the required DNS records (MX, SPF, DKIM) to your Porkbun DNS panel.
   - Once verified, set `FROM_EMAIL=orders@kavanahpouch.com` in Coolify.
5. Set `SUPPORT_EMAIL=support@kavanahpouch.com` so reply-to and footer links are correct.

---

## Stripe Email Setup

> Stripe sends the payment receipt. The Kavanah Pouch app sends the branded order confirmation. Pirate Ship sends the tracking email.

Manual steps in the Stripe Dashboard:

1. Log into the [Stripe Dashboard](https://dashboard.stripe.com).
2. Go to **Settings → Customer emails**.
3. Enable **Receipts** for successful payments.
4. Confirm the public business name is set to **Kavanah Pouch**.
5. Confirm the customer support email is correct.
6. Confirm the statement descriptor is set appropriately (e.g., `KAVANAH POUCH`).
7. Confirm Stripe Checkout is collecting customer email and shipping address.
8. Confirm the webhook endpoint is configured and points to:
   ```
   https://kavanahpouch.com/api/stripe/webhook
   ```
9. Confirm the webhook listens for `checkout.session.completed` (plus optionally `charge.refunded` and `checkout.session.expired`).
10. Test in Stripe test mode and confirm:
    - The Stripe payment receipt is sent automatically.
    - The Kavanah Pouch order confirmation is sent separately (check admin dashboard email status).
    - No duplicate emails.

---

## Pirate Ship Tracking Email Setup

> Pirate Ship sends the tracking email after you purchase a label. The Kavanah Pouch app does not send a separate shipping notification at launch.

Manual steps in Pirate Ship:

1. Log into [Pirate Ship](https://www.pirateship.com).
2. Confirm that customer email addresses are included in the CSV export from the Kavanah Pouch admin dashboard (the **Email** column is always exported).
3. When uploading a CSV batch to Pirate Ship, map the **Email** field to the customer email column.
4. In Pirate Ship account settings, confirm that **tracking notification emails to customers** are enabled.
5. If Pirate Ship allows a custom sender name, set it to **Kavanah Pouch**.
6. If custom tracking email wording is available, use:
   - **Subject:** `Your Kavanah Pouch order is on the way`
   - **Body:**
     ```
     Your Kavanah Pouch order is on the way.

     Tracking Number: [Tracking Number]
     Track your package: [Tracking Link]

     Thank you for your order.

     Kavanah Pouch
     Daven without distractions.
     KavanahPouch.com
     ```
7. Confirm the tracking email delay setting. Default may send immediately after label purchase.
8. Purchase a test label and confirm the customer receives the tracking email.
9. If using a custom sending domain in Pirate Ship, add any required DNS records (DKIM, SPF) in Porkbun.

---

## Go-Live Checklist

- [ ] Migrate DB on production (`npm run migrate` — includes migration 003 for email tracking)
- [ ] Seed admin user
- [ ] Set live Stripe keys (`sk_live_…`)
- [ ] Set live Stripe webhook secret
- [ ] Confirm `kavanahpouch.com` resolves and HTTPS works
- [ ] Set `RESEND_API_KEY` in Coolify env vars
- [ ] Verify sending domain in Resend and set `FROM_EMAIL` / `FROM_NAME` / `SUPPORT_EMAIL`
- [ ] Enable Stripe payment receipts in Stripe Dashboard (Settings → Customer emails)
- [ ] Confirm Stripe webhook points to `https://kavanahpouch.com/api/stripe/webhook`
- [ ] Place one test order end-to-end — verify Stripe receipt + Kavanah Pouch confirmation both arrive
- [ ] Confirm admin dashboard shows email status (`sent`) on the test order
- [ ] Test "Resend Confirmation Email" button in admin order detail
- [ ] Export CSV and verify Pirate Ship import (confirm Email column is present)
- [ ] Configure Pirate Ship tracking email sender name and wording
- [ ] Set actual inventory quantity in admin
- [ ] Add real product photos to `public/assets/`
- [ ] Update package weight/dimensions after measuring sample
- [ ] Remove `ADMIN_INITIAL_PASSWORD` from Coolify env vars
