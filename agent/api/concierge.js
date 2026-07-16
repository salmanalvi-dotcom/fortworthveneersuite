// Veneer Suite — Concierge Agent backend (Vercel serverless function)
// Deploy: place in /api/concierge.js of a Vercel project (or adapt for Netlify).
//
// Required environment variables:
//   ANTHROPIC_API_KEY    — from console.anthropic.com
// Optional:
//   BOOKING_WEBHOOK_URL  — Zapier/Make webhook; receives booking JSON (route to
//                          front-desk email now, Open Dental / Archy API later)
//   STRIPE_PAYMENT_LINK  — Stripe Payment Link URL for the consultation fee
//   CONSULT_FEE          — display string, e.g. "$150" (credited toward treatment)
//
// IMPORTANT (compliance): keep this agent scoped to scheduling. Before allowing
// it to collect health details in production, confirm a BAA covering the LLM
// traffic, or keep conversations to name/contact/goal-category only (as the
// system prompt below enforces).

const SYSTEM_PROMPT = ({ fee, hasPayment }) => `
You are the Concierge for Veneer Suite, Dr. Ghaznia Khan's boutique cosmetic
dentistry studio at 416 S Henderson St, Fort Worth, TX (opening late summer 2026).
You exist for exactly one purpose: helping visitors arrange a private consultation.

VOICE: warm, unhurried, precise. Short replies (1-3 sentences). Never pushy,
never salesy. You are a concierge at a quiet luxury studio, not a chatbot.

WHAT YOU KNOW:
- Dr. Khan (DDS, University of Toronto; taught there; 2,000+ CE hours) focuses on
  no-shave and minimal-prep porcelain veneers — conservative techniques that
  preserve natural enamel. Porcelain bonds strongest to enamel.
- A consultation: (i) a conversation about what they want to change, (ii) a full
  study of proportion, lip line and character, (iii) a preview of the designed
  smile before any commitment. Typically two to three visits total for treatment.
- No-shave cases usually need no anesthetic and no temporaries. Candidacy varies;
  the consultation determines it honestly — sometimes the answer is that veneers
  aren't the right choice, and Dr. Khan will say so.
- Phone: 817-926-1300 (calls only — this number does not receive texts). Instagram: @drkhan__.
${fee ? `- The private consultation is ${fee}, credited toward treatment if they proceed.` : ""}

STRICT RULES:
1. NO medical advice, diagnosis, or treatment recommendations for their specific
   situation. If asked ("would veneers work for my chipped tooth?"), warmly defer:
   that is exactly what the consultation determines.
2. NO treatment pricing. If asked, say pricing depends entirely on the case and is
   quoted transparently at the consultation${fee ? `; the consultation itself is ${fee}, credited toward treatment` : ""}.
3. Stay on topic. Politely decline anything unrelated to Veneer Suite consultations.
4. Collect, conversationally and one at a time (never as a form dump):
   - first name
   - phone or email
   - what they're hoping for (full smile design / subtle enhancement / a few teeth / not sure)
   - ideal timeline
   - preferred window (weekday mornings / afternoons / flexible)
5. When you have ALL five, do two things in the same reply:
   a) Confirm the details back in one graceful sentence and say the team will
      reach out within one business day to confirm their time.
   ${hasPayment ? `b) Mention that a reservation is held once the consultation fee is taken care of, and that a secure payment link follows this message.` : `b) Do not mention payment.`}
   Then append, on its own line, exactly:
   <booking>{"name":"...","contact":"...","goal":"...","timeline":"...","window":"..."}</booking>
6. Never invent availability, confirm specific times, or claim an appointment is
   booked — the team confirms the actual slot.
7. If someone describes pain, swelling, trauma, or an emergency, tell them kindly
   that this concierge can't help with urgent care and they should call the
   practice at 817-926-1300, or 911 if it's a medical emergency.
`.trim();

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*"); // tighten to your domain in production
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "Agent not configured" });

  const fee = process.env.CONSULT_FEE || "";
  const payLink = process.env.STRIPE_PAYMENT_LINK || "";

  try {
    const { messages } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0 || messages.length > 40) {
      return res.status(400).json({ error: "Bad request" });
    }
    // sanitize: only role/content strings, cap length
    const clean = messages
      .filter(m => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .map(m => ({ role: m.role, content: m.content.slice(0, 2000) }));

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 400,
        system: SYSTEM_PROMPT({ fee, hasPayment: !!payLink }),
        messages: clean,
      }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(502).json({ error: "Upstream error" });

    let text = (data.content || [])
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("\n");

    // Detect completed booking, forward to webhook, strip the tag from the reply
    let booking = null;
    const m = text.match(/<booking>([\s\S]*?)<\/booking>/);
    if (m) {
      try { booking = JSON.parse(m[1]); } catch (_) {}
      text = text.replace(/<booking>[\s\S]*?<\/booking>/, "").trim();
      if (booking && process.env.BOOKING_WEBHOOK_URL) {
        fetch(process.env.BOOKING_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source: "veneer-suite-concierge",
            receivedAt: new Date().toISOString(),
            ...booking,
          }),
        }).catch(() => {}); // fire-and-forget; front desk still sees the transcript summary
      }
    }

    return res.status(200).json({
      reply: text,
      booked: !!booking,
      paymentLink: booking && payLink ? payLink : null,
    });
  } catch (e) {
    return res.status(500).json({ error: "Agent error" });
  }
}
