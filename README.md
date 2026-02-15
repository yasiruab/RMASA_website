# RMASA Website (Phase 1)

Custom website scaffold for Royal MAS Arena built from scratch with Next.js and TypeScript.

## Run locally

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start dev server:
   ```bash
   npm run dev
   ```
3. Open `http://localhost:3000`

## Current scope

- Public website pages
- Shared layout, nav, and footer
- Contact form with `/api/contact` submission endpoint
- Booking page prepared for calendar automation phase

## Contact submission behavior

- By default, the API logs enquiries to the server console (development mode).
- To forward enquiries to an external service, set:

```bash
CONTACT_WEBHOOK_URL=https://your-endpoint.example.com/contact
```

Then restart the server.
