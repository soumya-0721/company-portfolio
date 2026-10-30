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
contact.addressLine
contact.mapEmbedUrl
links.marketplace
links.social.linkedin
links.social.instagram
links.social.facebook
links.social.youtube
analytics.gaMeasurementId
```

Empty values are handled deliberately:

- Email, phone and address show **To be confirmed**.
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
- Validates name, message, consent, email and phone.
- Uses a hidden `_gotcha` field to silently discard basic bot submissions.
- Rate-limits each connection to 5 enquiries per 10 minutes.
- Stores accepted enquiries in `data/leads.jsonl`.
- Stores an anonymised IP hash, not the raw IP address.
- Optionally forwards each enquiry to `ENQUIRY_WEBHOOK_URL`.

Accepted enquiries are appended as one JSON object per line. The data directory and lead file are excluded from Git.

### Optional webhook

Set these values in `.env` to forward enquiries to a CRM, automation tool or email relay:

```bash
ENQUIRY_WEBHOOK_URL=https://example.com/hooks/next360
ENQUIRY_WEBHOOK_SECRET=replace-with-a-secret
```

The webhook receives the full enquiry object as JSON and an `X-NEXT360-Secret` header when a secret is configured. A webhook failure does not discard the locally stored enquiry.

### Export leads

```bash
npm run export:leads -- leads.csv
```

The export includes a UTF-8 BOM so it opens correctly in Excel. Treat exported files as personal data and delete them when no longer needed.

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
├─ scripts/export-leads.js CSV export utility
├─ server.js               Static server and enquiry API
├─ package.json
├─ sitemap.xml
├─ robots.txt
└─ *.html
```

## Deployment

1. Copy the project files to the server. Do not copy `.env` into a public repository.
2. Install Node.js 18.17 or newer.
3. Create `.env` from `.env.example` and set a strong `IP_HASH_SALT`.
4. Run `npm start`.
5. Put the Node process behind a reverse proxy such as Nginx or Caddy for HTTPS.
6. Set `TRUST_PROXY=1` only when a trusted proxy forwards client IPs.
7. Confirm that `data/` is writable by the Node process and not publicly served.
8. Update the canonical URLs, Open Graph URLs and `sitemap.xml` if the final domain differs from `profile.next360.in`.

The server sets a Content Security Policy, HSTS when served over HTTPS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` and `Permissions-Policy`. It blocks direct access to `data/`, `scripts/`, dotfiles and server configuration.

## Analytics

Add a GA4 measurement ID in `assets/js/config.js`. The site does not load Google Analytics when the field is empty. The Content Security Policy already permits Google Tag Manager and Google Analytics connections.

## Before launch checklist

- [ ] Replace the placeholder logo and favicon with approved brand assets.
- [ ] Add the confirmed email, phone, WhatsApp number and office address.
- [ ] Add the confirmed Google Maps embed URL.
- [ ] Add the approved marketplace URL.
- [ ] Add approved social profile URLs.
- [ ] Add the GA4 measurement ID if analytics is required.
- [ ] Confirm the domain in canonical tags, Open Graph tags and `sitemap.xml`.
- [ ] Review all product and service descriptions for accuracy.
- [ ] Publish Ayurvena details and imagery only after approval.
- [ ] Test every enquiry form and confirm `data/leads.jsonl` is created.
- [ ] Configure a webhook or notification route so enquiries are seen promptly.
- [ ] Test across mobile, tablet and desktop.
- [ ] Review privacy wording and consent language with the company.

## Content notes

- No certifications, awards, client names, testimonials, revenue figures, partner logos or performance claims have been invented.
- Project statuses are labelled as active, in development or pending approval.
- The Ayurvena project intentionally shows a placeholder until details and visuals are approved.
- Contact details are marked as pending rather than guessed.
