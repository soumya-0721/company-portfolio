# NEXT360 Corporate Portfolio

A multi-page corporate website for **NEXT360 Organic Products Pvt. Ltd.**, covering the organic products and IT services divisions. Built as static HTML, CSS and JavaScript with a small zero-dependency Node server for the enquiry API.

## Run locally

Requires Node.js 18.17 or newer.

```bash
npm start
```

Open `http://localhost:3000`.

There is no build step and no npm dependency install required. The server also loads a local `.env` file if one exists.

Copy `.env.example` to `.env` when deploying or when testing the enquiry API:

```bash
copy .env.example .env
```

## Pages

| Page | File | Purpose |
| --- | --- | --- |
| Home | `index.html` | Company overview, divisions, products, services and enquiry |
| About | `about.html` | Vision, mission, approach and company story |
| Organic | `organic.html` | Product categories, ordering process, marketplace and enquiry |
| IT Services | `it-services.html` | Websites, mobile apps, custom systems and project enquiry |
| Projects | `projects.html` | Transparent project portfolio with status labels |
| Partnerships | `partnerships.html` | Collaboration models and partnership enquiry |
| Contact | `contact.html` | Contact details, map, general enquiry and FAQs |
| Not found | `404.html` | Custom error page served by the Node server |

## Configure before launch

All public contact details and links live in `assets/js/config.js`:

```js
contact.email
contact.phone
contact.whatsapp
contact.whatsappUrl
contact.addressLine
contact.mapEmbedUrl
links.officialWebsite
links.companyProfile
links.ceoPortfolio
links.ceoLinkedIn
links.marketplace
links.social.linkedin
links.social.instagram
links.social.facebook
links.social.youtube
analytics.gaMeasurementId
```

The official values are configured: `office@next360.in`, `+91 9989163332`,
`https://wa.me/919989163332`, `https://next360.in` for the Official Company
Profile and `https://samhithreddysangam.next360.in/` for the CEO Portfolio.

Empty values are handled deliberately:

- Missing contact fields show **To be confirmed**.
- WhatsApp buttons stay hidden until a number is supplied.
- Marketplace links stay hidden until a URL is supplied.
- Social links stay hidden until URLs are supplied.
- The map placeholder stays visible until `mapEmbedUrl` is supplied.
- Google Analytics is not loaded until `gaMeasurementId` is supplied.

### Official logo

This build uses a placeholder brand mark in the header, footer, `assets/img/logo.svg` and `assets/img/favicon.svg`. Replace these with the official NEXT360 logo when supplied. If the official logo includes the company name, update the inline brand markup across all HTML pages rather than only replacing the SVG file.

Do not redesign an approved logo without permission.

## Enquiry API

Forms post JSON to `/api/enquiry`. The server:

- Accepts only `POST` with `Content-Type: application/json`.
- Limits request bodies to 64 KB.
- Accepts text fields only, strips control characters and enforces length limits.
- Validates name, message, consent, email, phone, website and form-specific fields.
- Uses a hidden `_gotcha` field to silently discard basic bot submissions.
- Rate-limits each client IP to 5 enquiries per 10 minutes.
- Treats an identical repeat submission within 5 minutes as the same enquiry.
- Stores accepted enquiries in Redis when configured, otherwise in `data/leads.jsonl`.
- Stores an anonymised IP hash, not the raw IP address.
- Sends an internal email notification to `office@next360.in` when SMTP is configured.
- Optionally forwards each enquiry to `ENQUIRY_WEBHOOK_URL`.

### Lead storage

Local development uses `data/leads.jsonl` by default. This file is excluded from
Git and is not served by the website.

Vercel functions do not have a persistent writable filesystem, so production
enquiries require a managed Redis database. The implementation supports both
Vercel KV and Upstash Redis through their REST APIs:

```bash
KV_REST_API_URL=replace-with-redis-rest-url
KV_REST_API_TOKEN=replace-with-redis-rest-token
LEADS_STORAGE_KEY=next360:leads
```

The direct Upstash variable names `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN` are also supported. When either pair is configured,
new enquiries are appended to a Redis list and the local file is only used as a
fallback. Do not commit these values.

In the Vercel dashboard, open **Storage**, create an Upstash Redis (or Vercel KV)
database, connect it to this project, and redeploy. The required environment
variables are added by the integration. Without Redis, the live API cannot
store enquiries reliably and will return an error rather than pretend the
enquiry was saved.

Existing local enquiries are not migrated automatically. Back them up before
any migration, and do not delete or move them without approval.

### Email notifications

The server includes a zero-dependency SMTP client. Configure these values in
`.env` locally or in the hosting platform to deliver every new enquiry to the
internal inbox:

```bash
ENQUIRY_NOTIFICATION_EMAIL=office@next360.in
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=0
SMTP_USER=office@next360.in
SMTP_PASS=replace-with-mail-password
SMTP_FROM=office@next360.in
```

Use the SMTP host, port and credentials supplied by the mailbox provider for
`office@next360.in`. `SMTP_FROM` must be an address the provider allows you to
send from. Use `SMTP_SECURE=1` for an implicit TLS port such as 465. When
`SMTP_HOST` is empty, notifications are disabled and enquiries are still
stored. SMTP failures never discard a stored enquiry.

Never put an SMTP password in source code, `README.md`, Git, browser JavaScript
or a public file. Keep it in `.env` locally and in the hosting platform's
encrypted environment-variable settings in production.

This project does not include an admin dashboard. Review stored enquiries with
`npm run export:leads` or the Redis console. Automated WhatsApp notifications
are not sent; WhatsApp links open a normal chat with the number configured in
`assets/js/config.js`.

### Optional webhook

Set these values in `.env` to forward enquiries to a CRM, automation tool or email relay:

```bash
ENQUIRY_WEBHOOK_URL=https://example.com/hooks/next360
ENQUIRY_WEBHOOK_SECRET=replace-with-a-secret
```

The webhook receives the full enquiry object as JSON and an `X-NEXT360-Secret` header when a secret is configured. A webhook failure does not discard the stored enquiry.

### Export leads

```powershell
npm run export:leads -- ..\next360-leads\leads.csv
```

The export includes a UTF-8 BOM so it opens correctly in Excel. It refuses to
write inside the website directory, creates private parent folders, and sets
the output file to owner-only permissions where supported. CSV formula
injection is mitigated. Treat exported files as personal data and delete them
when no longer needed.

When Redis is configured, the export reads from Redis. To export production
enquiries locally, pull the same Redis environment variables into `.env` (or
`.env.local`) first:

```powershell
vercel env pull .env.local
```

## Project structure

```text
.
├─ assets/
│  ├─ css/styles.css
│  ├─ img/                 Local WebP photography, logo and favicon
│  └─ js/
│     ├─ head.js           Adds the js class before render
│     ├─ config.js         Contact details, links and analytics
│     └─ main.js           Navigation, filtering, forms and UI behaviour
├─ data/                   Local lead storage (not committed)
├─ lib/lead-store.js       Local/Redis lead storage adapter
├─ scripts/export-leads.js CSV export utility
├─ server.js               Static server and enquiry API
├─ vercel.json             Vercel build configuration
├─ package.json
├─ sitemap.xml
├─ robots.txt
└─ *.html
```

## Deployment

### Vercel

This project is deployed on Vercel. `vercel.json` routes the site through the
Node server and explicitly includes `assets/**`, all HTML pages, `robots.txt`
and `sitemap.xml` in the deployment bundle. Without that inclusion Vercel only
bundles files detected by static analysis, which caused the CSS and images to
return `404`.

1. Push the repository to the connected Git branch.
2. In **Project Settings → Environment Variables**, add `IP_HASH_SALT` for
   Production, Preview and Development.
3. Add the SMTP variables for `office@next360.in`.
4. Connect an Upstash Redis or Vercel KV database and confirm its REST URL and
   token variables are present.
5. Redeploy so the new environment variables and `vercel.json` take effect.
6. Check the deployment logs for `Lead storage: Redis (persistent)` and
   `Enquiry email notifications: office@next360.in`.
7. Open `/api/health`, confirm `{"ok":true}`.
8. Confirm `/assets/css/styles.css` returns `200` with
   `Content-Type: text/css`.
9. Submit a clearly labelled test enquiry. Confirm the `201` response, the
   inbox notification, the Redis record and the exported row.
10. Redeploy or restart and export again to confirm the test enquiry persists.
11. Remove the test record only after confirming it is not a genuine enquiry.

Do not claim production email or persistent storage is working until those
checks pass with real credentials.

### Self-hosted Node

1. Copy the project files to the server. Do not copy `.env` into a public repository.
2. Install Node.js 18.17 or newer.
3. Create `.env` from `.env.example`, set a strong `IP_HASH_SALT`, add the SMTP credentials for `office@next360.in` when email notifications are required, and optionally configure Redis.
4. Run `npm start`.
5. Put the Node process behind a reverse proxy such as Nginx or Caddy for HTTPS.
6. Set `TRUST_PROXY=1` only when a trusted proxy forwards client IPs.
7. Confirm that `data/` is writable by the Node process and not publicly served.
8. Update the canonical URLs, Open Graph URLs and `sitemap.xml` if the final domain differs from `profile.next360.in`.

The server sets a Content Security Policy, HSTS when served over HTTPS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` and `Permissions-Policy`. It blocks direct access to `data/`, `scripts/`, dotfiles, server configuration and lead-export formats such as `.csv` and `.jsonl`.

## Analytics

Add a GA4 measurement ID in `assets/js/config.js`. The site does not load Google Analytics when the field is empty. The Content Security Policy already permits Google Tag Manager and Google Analytics connections.

## Before launch checklist

- [ ] Replace the placeholder logo and favicon with approved brand assets.
- [x] Add the confirmed email and WhatsApp number.
- [ ] Add the confirmed office address and Google Maps embed URL.
- [x] Add the approved Official Company Profile and CEO Portfolio links.
- [x] Add the approved marketplace URL.
- [ ] Add approved social profile URLs.
- [ ] Add the GA4 measurement ID if analytics is required.
- [ ] Confirm the domain in canonical tags, Open Graph tags and `sitemap.xml`.
- [ ] Review all product and service descriptions for accuracy.
- [ ] Publish Ayurvena details and imagery only after approval.
- [x] Test every enquiry form locally and confirm `data/leads.jsonl` is created.
- [ ] Confirm Vercel serves CSS, JavaScript, images and every HTML page.
- [ ] Configure Upstash Redis or Vercel KV so enquiries persist on Vercel.
- [ ] Configure SMTP credentials so enquiries reach `office@next360.in`.
- [ ] Send a real production test enquiry and confirm email delivery.
- [ ] Confirmation that a production enquiry survives a redeploy.
- [ ] Test across mobile, tablet and desktop.
- [ ] Review privacy wording and consent language with the company.

## Content notes

- No certifications, awards, client names, testimonials, revenue figures, partner logos or performance claims have been invented.
- Project statuses are labelled as active, in development or pending approval.
- The Ayurvena project intentionally shows a placeholder until details and visuals are approved.
- Confirmed contact details are used; only the office address and map remain pending.
