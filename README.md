# RMASA Website (Royal MAS Arena)

Booking and information website for the Royal MAS Arena, the indoor sports complex of Royal College Colombo.  
The arena was originally donated to the school and is now managed by the college and the Old Boys’ Union.  
This site exists to promote impact sports (boxing, karate, etc.) and to **rent out unused timeslots** so the arena can generate income to cover maintenance costs.

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
