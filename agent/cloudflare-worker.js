// Fort Worth Veneer Suite — Concierge Agent (Cloudflare Worker, agentic)
// Deploy: Cloudflare dashboard → Workers & Pages → Create Worker → paste this file.
// Secrets (Worker → Settings → Variables):
//   ANTHROPIC_API_KEY   (required)
//   FORMSPREE_ID        (optional — same form as the site intake; agent submits bookings to it)
//   BOOKING_WEBHOOK_URL (optional — alternative/additional booking destination)
//   STRIPE_PAYMENT_LINK (optional)
//   CONSULT_FEE         (optional display string, e.g. "$150")
//   SMILEVIZ_URL        (optional override; defaults to Dr. Khan's SmileViz consult link)
// Then set the widget: <script src="agent/concierge-widget.js" data-endpoint="https://<worker>.workers.dev">
//
// What makes this version agentic: the model has a real tool, submit_consult_request.
// It converses, decides when it has enough, CALLS the tool (the Worker executes the
// submission), sees the result, and reports back — instead of emitting text for a
// human to act on.

const MODEL = "claude-sonnet-4-6";

const SMILEVIZ_DEFAULT = "https://app.smileviz.com/consult/drkhanveneers";

const buildSystem = (env) => `
You are the Concierge for Fort Worth Veneer Suite, Dr. Ghaznia Khan's boutique
cosmetic dentistry studio at 416 S Henderson St, Fort Worth, TX (opening late
summer 2026). Your sole purpose: helping visitors arrange a private consultation.

VOICE: warm, unhurried, precise. 1-3 sentences per reply. A concierge at a quiet
luxury studio, never a salesy chatbot.

KNOWLEDGE:
- Dr. Khan (DDS, University of Toronto; taught there; 2,000+ CE hours) focuses on
  minimal prep porcelain veneers — conservative techniques preserving
  natural enamel. Porcelain bonds strongest to enamel.
- Consultation: (i) conversation about goals, (ii) full study of proportion, lip
  line, character, (iii) preview of the designed smile before any commitment.
- Minimal prep cases usually need no anesthetic and no temporaries. Candidacy varies
  and the consultation determines it honestly.
- DESTINATION PATIENTS: many patients travel or fly in for treatment. The
  cosmetic concierge arranges flights, hotel, and airport shuttle, and the
  Veneer Lounge is available between appointments. The virtual consult is the
  right first step for anyone out of town — case review and estimate before
  booking travel.
- FINANCING: available; discussed during the virtual consultation.
- Phone: 817-926-1300 (calls only — no texts). Instagram: @drkhan__.
- VIRTUAL CONSULT (the preferred first step): at
  ${env.SMILEVIZ_URL || SMILEVIZ_DEFAULT} the visitor sends two photos of their
  smile (front-facing and profile). Dr. Khan personally reviews the case and
  replies with a personalized video covering what's possible and the treatment
  options — plus a custom estimate with transparent pricing tailored to their
  goals. No office visit, no obligation. When someone asks about cost, this is
  the honest route to a real number: you never quote prices in chat, but the
  virtual consult includes a written custom estimate.
${env.CONSULT_FEE ? `- The private consultation is ${env.CONSULT_FEE}, credited toward treatment.` : ""}

RULES:
1. NO medical advice, diagnosis, or case-specific treatment opinions — defer
   warmly to the consultation.
2. NO treatment pricing${env.CONSULT_FEE ? ` beyond the consultation fee` : ""}.
3. Stay on topic; decline unrelated requests politely.
4. FLOW — SmileViz first, details second:
   a. Once you understand what they're hoping for, OFFER the smile preview link
      as the recommended first step: they upload photos of their smile and
      Dr. Khan personally reviews what's possible — before any visit. Share the
      link on its own line.
   b. If they take the link: ask if they'd ALSO like to leave a name and phone
      or email so the team can follow up. If yes, collect those two and CALL
      submit_consult_request with what you have (use "(via SmileViz)" for any
      fields not collected, and set notes to "Started SmileViz smile preview").
      If no, warmly close — the preview link is a complete next step.
   c. If they'd rather not upload photos or prefer to talk: collect
      conversationally, ONE question at a time: first name; phone or email;
      goal (full smile design / subtle enhancement / a few teeth / not sure);
      timeline; preferred window (weekday mornings / afternoons / flexible).
5. In path (c), when you have all five, CALL the submit_consult_request tool. After the tool
   result: confirm details in one graceful sentence, say the team will reach out
   within one business day to confirm the time${env.STRIPE_PAYMENT_LINK ? `, and mention a secure link to reserve with the consultation fee follows this message` : ""}.
6. Never invent availability or claim an appointment is confirmed.
7. Pain, swelling, trauma, or emergency → kindly direct to 817-926-1300, or 911
   for medical emergencies. Do not continue booking.
`.trim();

const TOOLS = [{
  name: "submit_consult_request",
  description: "Submit a completed consultation request to the practice front desk. Call exactly once, only when name, contact, goal, timeline, and preferred window are all collected.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string" },
      contact: { type: "string", description: "phone or email" },
      goal: { type: "string" },
      timeline: { type: "string" },
      window: { type: "string" },
      notes: { type: "string", description: "optional context, e.g. Started SmileViz smile preview" },
    },
    required: ["name", "contact", "goal", "timeline", "window"],
  },
}];

async function submitBooking(input, env) {
  const record = {
    source: "veneer-suite-concierge-agent",
    receivedAt: new Date().toISOString(),
    ...input,
    _subject: "Concierge booking — Fort Worth Veneer Suite",
  };
  const results = [];
  if (env.FORMSPREE_ID) {
    const r = await fetch(`https://formspree.io/f/${env.FORMSPREE_ID}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(record),
    }).catch(() => null);
    results.push(r && r.ok ? "formspree:ok" : "formspree:failed");
  }
  if (env.BOOKING_WEBHOOK_URL) {
    const r = await fetch(env.BOOKING_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(record),
    }).catch(() => null);
    results.push(r && r.ok ? "webhook:ok" : "webhook:failed");
  }
  const ok = results.some(x => x.endsWith(":ok"));
  return {
    status: ok ? "submitted" : (results.length ? "delivery_failed" : "no_destination_configured"),
    detail: results.join(",") || "no FORMSPREE_ID or BOOKING_WEBHOOK_URL set",
  };
}

async function callClaude(messages, env) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 500,
      system: buildSystem(env),
      tools: TOOLS,
      messages,
    }),
  });
  if (!r.ok) throw new Error("upstream " + r.status);
  return r.json();
}


// ── conversation logging (Cloudflare KV, optional) ──────────────
// Bind a KV namespace as CHATLOG and set secret LOG_TOKEN to enable.
async function logConversation(env, cid, messages, reply, booked) {
  if (!env.CHATLOG || !cid) return;
  try {
    const day = new Date().toISOString().slice(0, 10);
    const key = "conv:" + day + ":" + cid;
    const transcript = messages.concat([{ role: "assistant", content: reply }]);
    await env.CHATLOG.put(key, JSON.stringify({ updated: Date.now(), booked, transcript }), {
      expirationTtl: 7776000, // 90 days
      metadata: { booked: booked, msgs: transcript.length, t: Date.now() }
    });
  } catch (e) {}
}

async function handleAdmin(request, env, cors) {
  const url = new URL(request.url);
  if (!env.LOG_TOKEN || url.searchParams.get("token") !== env.LOG_TOKEN) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
  }
  if (!env.CHATLOG) {
    return new Response(JSON.stringify({ error: "CHATLOG KV not bound" }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
  if (url.pathname === "/stats") {
    const days = parseInt(url.searchParams.get("days") || "14", 10);
    const out = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      let convos = 0, booked = 0, msgs = 0, cursor;
      do {
        const page = await env.CHATLOG.list({ prefix: "conv:" + d + ":", cursor });
        convos += page.keys.length;
        for (const k of page.keys) {
          if (k.metadata && k.metadata.booked) booked++;
          if (k.metadata && k.metadata.msgs) msgs += k.metadata.msgs;
        }
        cursor = page.list_complete ? null : page.cursor;
      } while (cursor);
      out.push({ day: d, conversations: convos, booked: booked, avg_messages: convos ? Math.round(msgs / convos * 10) / 10 : 0 });
    }
    return new Response(JSON.stringify(out, null, 2), { headers: { ...cors, "Content-Type": "application/json" } });
  }
  if (url.pathname === "/transcripts") {
    const day = url.searchParams.get("day") || new Date().toISOString().slice(0, 10);
    const list = await env.CHATLOG.list({ prefix: "conv:" + day + ":" });
    const out = [];
    for (const k of list.keys.slice(0, 50)) {
      const v = await env.CHATLOG.get(k.name, "json");
      if (v) out.push({ id: k.name.split(":")[2], booked: v.booked, transcript: v.transcript });
    }
    return new Response(JSON.stringify(out, null, 2), { headers: { ...cors, "Content-Type": "application/json" } });
  }
  return new Response(JSON.stringify({ endpoints: ["/stats?days=14", "/transcripts?day=YYYY-MM-DD"] }), { headers: { ...cors, "Content-Type": "application/json" } });
}

export default {
  async fetch(request, env) {
    const _u = new URL(request.url);
    const _cors2 = { "Access-Control-Allow-Origin": "*" };
    if (request.method === "GET" && (_u.pathname === "/stats" || _u.pathname === "/transcripts")) {
      return handleAdmin(request, env, _cors2);
    }
    const cors = {
      "Access-Control-Allow-Origin": "https://fortworthveneersuite.com",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "POST")
      return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers: { ...cors, "Content-Type": "application/json" } });
    if (!env.ANTHROPIC_API_KEY)
      return new Response(JSON.stringify({ error: "not configured" }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });

    try {
      const { messages, cid } = await request.json();
      if (!Array.isArray(messages) || !messages.length || messages.length > 40)
        return new Response(JSON.stringify({ error: "bad request" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });

      let convo = messages
        .filter(m => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
        .map(m => ({ role: m.role, content: m.content.slice(0, 2000) }));

      let booked = false;
      let reply = "";

      // Agentic loop: converse → tool call → execute → feed result back → final reply
      for (let hop = 0; hop < 3; hop++) {
        const data = await callClaude(convo, env);
        const toolUse = (data.content || []).find(b => b.type === "tool_use");
        const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n").trim();

        if (!toolUse) { reply = text; break; }

        // Execute the tool for real
        const result = await submitBooking(toolUse.input, env);
        booked = result.status === "submitted";

        convo = convo.concat([
          { role: "assistant", content: data.content },
          { role: "user", content: [{ type: "tool_result", tool_use_id: toolUse.id, content: JSON.stringify(result) }] },
        ]);
      }

      if (!reply) reply = "Thank you — the team will reach out within one business day. If anything is urgent, please call 817-926-1300.";

      await logConversation(env, cid, messages, reply, booked);
      return new Response(JSON.stringify({
        reply,
        booked,
        paymentLink: booked && env.STRIPE_PAYMENT_LINK ? env.STRIPE_PAYMENT_LINK : null,
      }), { headers: { ...cors, "Content-Type": "application/json" } });
    } catch (e) {
      return new Response(JSON.stringify({ error: "agent error" }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
    }
  },
};
