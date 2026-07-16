# Veneer Suite — Concierge Booking Agent

A conversational agent embedded in the website, scoped to one job: arranging
private consultations. It converses naturally, collects name / contact / goal /
timeline / preferred window, hands the structured booking to the front desk via
webhook, and (optionally) shares a Stripe Payment Link to reserve with the
consultation fee.

## Architecture

- `concierge-widget.js` — front-end chat UI (brand-styled). Already included on
  index.html. If no backend is configured it gracefully falls back to scrolling
  visitors to the on-page intake form, so the site never breaks.
- `api/concierge.js` — serverless function (Vercel format). Holds the Anthropic
  API key server-side, enforces the consultation-only system prompt, forwards
  completed bookings to a webhook, appends the payment link.

## Deploy (about 30 minutes)

1. **Host the site on Vercel** (drag the veneer-suite folder into a Vercel
   project, or connect a git repo). The `agent/api/concierge.js` file must be
   moved to `/api/concierge.js` at the project root (Vercel convention).
2. **Environment variables** (Vercel → Settings → Environment Variables):
   - `ANTHROPIC_API_KEY` — create at console.anthropic.com
   - `BOOKING_WEBHOOK_URL` — optional. Create a Zapier/Make webhook that emails
     the front desk (and later posts to Open Dental / Archy).
   - `STRIPE_PAYMENT_LINK` — optional. Stripe Dashboard → Payment Links →
     create one for the consultation fee.
   - `CONSULT_FEE` — optional display string, e.g. `$150`.
3. **Point the widget at the endpoint**: in index.html the script tag is
   `<script src="agent/concierge-widget.js" data-endpoint="" defer>` — set
   `data-endpoint="/api/concierge"` once deployed.
4. Test: ask it something off-topic (it should decline politely), describe an
   emergency (it should route to the phone), and complete a booking (front desk
   should receive the webhook email).

## Booking hand-off today vs. later

- **Now:** webhook → Zapier → front-desk email. The team confirms the actual
  slot by phone/text. The agent never claims an appointment is confirmed.
- **Later (Open Dental):** Open Dental's API can receive appointments; point the
  webhook at a small integration instead of email.
- **If switching to Archy:** same webhook pattern; Archy is cloud-native with an
  API, so direct booking is straightforward. Nothing about the agent changes.

## Payments

- Launch with a **Stripe Payment Link** (no code, no PCI exposure; the agent just
  shares the link once details are collected). Fee is credited toward treatment —
  the agent says so.
- "Natural" (natural.co, agentic-payments infra) is interesting for a future
  phase where the agent itself executes/collects payments programmatically, but
  it's early-stage and B2B-embedded today. Revisit in 6–12 months.

## Compliance notes (read before launch)

- The system prompt restricts the agent to scheduling and forbids medical advice,
  diagnosis, and treatment pricing. Keep it that way.
- Conversations may contain patient-identifying information. Before production:
  either (a) confirm a BAA covering the LLM API traffic for HIPAA purposes, or
  (b) keep the agent strictly to name/contact/scheduling (as configured) and
  avoid inviting health details.
- The widget footer states it is not medical advice and routes urgent concerns
  to the phone. The backend prompt also routes emergencies to 817-926-1300 / 911.
- Add the agent to the practice's privacy policy (what's collected, why, vendor).

## Cost expectations

Consult conversations are short (10–20 turns, small context). At Sonnet pricing,
expect pennies per conversation — negligible next to a single consult's value.
