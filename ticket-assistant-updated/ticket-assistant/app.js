require("dotenv").config();
const express = require("express");
const crypto = require("crypto");

const { parseIntent, formatReply } = require("./services/groq");
const { findMoEngageFaq } = require("./services/moengageFaq");
const { createTicket, getTicket, addPrivateNote, createFeedback } = require("./services/freshdesk");
const { isResolvedStatus, extractFeedbackRating } = require("./services/feedback");
const slack = require("./services/slack");
const userMap = require("./store/userMap");

const MY_USER_ID = process.env.MY_SLACK_USER_ID;
const NOTIFICATION_CHANNEL_ID = process.env.NOTIFICATION_CHANNEL_ID || "C0C2MRJK83H";
const app = express();

// Capture the raw request body — needed to verify Slack's signature
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(
  express.urlencoded({
    extended: true,
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

function verifySlackSignature(req) {
  const timestamp = req.headers["x-slack-request-timestamp"];
  if (!timestamp || Math.abs(Date.now() / 1000 - timestamp) > 60 * 5) return false;

  const sigBase = `v0:${timestamp}:${req.rawBody}`;
  const mySignature =
    "v0=" +
    crypto.createHmac("sha256", process.env.SLACK_SIGNING_SECRET).update(sigBase).digest("hex");

  const slackSignature = req.headers["x-slack-signature"] || "";
  try {
    return crypto.timingSafeEqual(Buffer.from(mySignature), Buffer.from(slackSignature));
  } catch {
    return false; // lengths differ, etc.
  }
}

// ---------- Slack events endpoint ----------
// Deduplicate on event.ts (message timestamp — stable across Slack retries)
const seenMsgTs = new Map();
function isDuplicate(key) {
  const now = Date.now();
  for (const [k, t] of seenMsgTs) if (now - t > 600_000) seenMsgTs.delete(k);
  if (seenMsgTs.has(key)) return true;
  seenMsgTs.set(key, now);
  return false;
}

// Track ts of messages we sent so we don't react to our own replies
const sentByUs = new Set();
function markSent(ts) { sentByUs.add(ts); setTimeout(() => sentByUs.delete(ts), 60_000); }
slack.setMarkSent(markSent);

app.post("/slack/events", async (req, res) => {
  if (!verifySlackSignature(req)) {
    return res.status(401).send("invalid signature");
  }

  const body = req.body;

  // One-time URL verification handshake when you save the Request URL in Slack
  if (body.type === "url_verification") {
    return res.json({ challenge: body.challenge });
  }

  const event = body.event;

  // Deduplicate on channel+ts — stable key across all Slack retries of the same message
  const dedupKey = event ? `${event.channel}:${event.ts}` : null;
  if (!event || !dedupKey || isDuplicate(dedupKey) || sentByUs.has(event.ts)) {
    return res.status(200).send();
  }

  // Ack immediately — Slack requires a response within 3 seconds
  res.status(200).send();

  handleMessageEvent(event).catch((err) => {
    console.error("Error handling event:", err.response?.data || err.message || err);
  });
});

// Multi-step conversation state: channel -> { step, subject, email }
const pendingTickets = new Map();
const pendingFeedback = new Map();

function getNotificationTicketId(payload) {
  const ticketId = payload.ticket_id || payload.ticketId || payload.id || payload.ticket?.id;
  if (ticketId) return String(ticketId);

  const message = payload.message || payload.text || "";
  const match = String(message).match(/\bticket\s*#?\s*(\d+)\b/i);
  return match ? match[1] : null;
}

async function handleMessageEvent(event) {
  if (event.type !== "message") { console.log("[skip] not a message"); return; }
  if (event.channel_type !== "im") { console.log("[skip] not a DM"); return; }
  if (event.subtype) { console.log("[skip] subtype:", event.subtype); return; }
  if (event.user === MY_USER_ID) { console.log("[skip] own message"); return; }
  if (event.bot_id || event.app_id) { console.log("[skip] bot/app message"); return; }
  console.log("[handle] processing message from", event.user, ":", event.text);

  const senderId = event.user;
  const text = (event.text || "").trim();
  if (!text) return;

  let email = userMap.getEmail(senderId);
  if (!email) {
    email = await slack.getUserEmail(senderId);
    if (email) userMap.setEmail(senderId, email);
  }

  if (!email) {
    await slack.postMessage(event.channel, "I couldn't find an email on file for you. Please contact your admin.");
    return;
  }

  const feedbackRequest = pendingFeedback.get(event.channel);
  if (feedbackRequest) {
    const rating = extractFeedbackRating(text);
    if (!rating) {
      await slack.postMessage(event.channel, "Please reply with a score from 1 to 5 stars, for example: *5 stars*.");
      return;
    }

    try {
      await createFeedback({
        name: feedbackRequest.ticket_id ? `ticket-${feedbackRequest.ticket_id}` : feedbackRequest.email,
        ticket_id: feedbackRequest.ticket_id,
        rating_given: rating,
        contact_email: feedbackRequest.email,
      });
      await slack.postMessage(event.channel, `Thanks! Your rating of *${rating} / 5* has been recorded.`);
    } catch (err) {
      console.error("Error saving feedback:", err.response?.data || err.message || err);
      await slack.postMessage(event.channel, "I couldn't save your rating right now. Please try again in a moment.");
    }

    pendingFeedback.delete(event.channel);
    return;
  }

  // --- Multi-step ticket creation flow ---
  const pending = pendingTickets.get(event.channel);

  if (pending?.step === "awaiting_subject") {
    pendingTickets.set(event.channel, { step: "awaiting_description", subject: text, email });
    await slack.postMessage(event.channel, "Got it. Now please describe the issue in detail:");
    return;
  }

  if (pending?.step === "awaiting_description") {
    pendingTickets.delete(event.channel);
    try {
      const ticket = await createTicket({ subject: pending.subject, description: text, email: pending.email });
      await slack.postMessage(event.channel, `Your ticket *#${ticket.id}* has been created — *${ticket.subject}*. We'll keep you updated on any progress.`);
    } catch (err) {
      console.error("Error creating ticket:", err.response?.data || err.message || err);
      await slack.postMessage(event.channel, "Something went wrong creating the ticket. Please try again.");
    }
    return;
  }

  const moengageFaq = await findMoEngageFaq(text);
  if (moengageFaq) {
    await slack.postMessage(event.channel, moengageFaq.answer);
    return;
  }

  // --- Normal intent parsing ---
  try {
    const parsed = await parseIntent(text);

    if (parsed.intent === "create_ticket") {
      pendingTickets.set(event.channel, { step: "awaiting_subject", email });
      await slack.postMessage(event.channel, "Sure! What's the subject of your ticket? (a short summary of the issue)");
    } else if (parsed.intent === "check_status") {
      if (!parsed.ticket_id) {
        await slack.postMessage(event.channel, "Which ticket number would you like me to check? e.g. *12345*");
        return;
      }
      try {
        const ticket = await getTicket(parsed.ticket_id);
        const reply = await formatReply("The user asked for the status of this ticket.", ticket);
        await slack.postMessage(event.channel, reply);
      } catch {
        await slack.postMessage(event.channel, `I couldn't find ticket #${parsed.ticket_id}. Double-check the number and try again.`);
      }
    } else {
      const reply = await formatReply(
        "The user sent a general message to a support assistant. Respond helpfully and let them know they can create a ticket or check a ticket status.",
        { message: text }
      );
      await slack.postMessage(event.channel, reply);
    }
  } catch (err) {
    console.error("Error processing message:", err.response?.data || err.message || err);
    await slack.postMessage(event.channel, "Something went wrong on my end. Please try again in a moment.");
  }
}

// ---------- External webhook for proactive notifications ----------
app.post("/webhook/notify", async (req, res) => {
  if (req.headers["x-webhook-secret"] !== process.env.WEBHOOK_SECRET) {
    console.log("webhook secret mismatch", { expected: !!process.env.WEBHOOK_SECRET, received: req.headers["x-webhook-secret"] });
    return res.status(401).json({ error: "unauthorized" });
  }

  const payload = req.body || {};
  console.log("webhook payload:", payload);

  const email = payload.email || payload.contact_email;
  if (!email) return res.status(400).json({ error: "email is required to route the notification" });

  const slackUserId = userMap.findSlackUserByEmail(email);
  if (!slackUserId) {
    console.log(`No Slack user found for ${email} in userMap`);
    return res.status(404).json({ error: `no Slack user found for ${email}` });
  }

  try {
    const ticketId = getNotificationTicketId(payload);
    const channelId = NOTIFICATION_CHANNEL_ID;

    if (isResolvedStatus(payload.status)) {
      const feedbackChannelId = await slack.openDm(slackUserId);
      pendingFeedback.set(feedbackChannelId, { email, ticket_id: ticketId || null });
      const blocks = [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "We’d love to know how helpful this response was.\nHow would you rate the support you received?",
          },
        },
        {
          type: "actions",
          elements: [1, 2, 3, 4, 5].map((value) => ({
            type: "button",
            action_id: `feedback_rating_${value}`,
            text: {
              type: "plain_text",
              text: "★",
              emoji: true,
            },
            value: JSON.stringify({ ticket_id: String(ticketId || ""), email, rating: String(value) }),
          })),
        },
      ];
      if (ticketId) {
        blocks.push({
          type: "actions",
          elements: [
            {
              type: "button",
              action_id: "acknowledge_ticket",
              text: { type: "plain_text", text: "Acknowledge", emoji: true },
              value: JSON.stringify({ ticket_id: String(ticketId) }),
            },
          ],
        });
      }
      const text = "We’d love to know how helpful this response was.\nHow would you rate the support you received?";
      await slack.postMessage(feedbackChannelId, text, blocks);
      return res.json({ status: "sent", slack_user: slackUserId, feedback_requested: true });
    }

    const text = payload.message || (await formatReply("Notify the user of an update to their ticket.", payload));
    const blocks = channelId === NOTIFICATION_CHANNEL_ID && ticketId
      ? [
          { type: "section", text: { type: "mrkdwn", text } },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                action_id: "acknowledge_ticket",
                text: { type: "plain_text", text: "Acknowledge", emoji: true },
                value: JSON.stringify({ ticket_id: String(ticketId) }),
              },
            ],
          },
        ]
      : [];
    await slack.postMessage(channelId, text, blocks);
    res.json({ status: "sent", slack_user: slackUserId });
  } catch (err) {
    console.error("webhook notify error:", err.response?.data || err.message || err);
    res.status(500).json({ error: "failed to send notification" });
  }
});

app.post("/slack/actions", async (req, res) => {
  const payload = req.body && req.body.payload ? JSON.parse(req.body.payload) : null;
  if (!payload || !payload.actions || !payload.actions.length) {
    return res.status(200).send();
  }

  const action = payload.actions[0];
  if (action.action_id === "acknowledge_ticket") {
    let acknowledgeValue;
    try {
      acknowledgeValue = JSON.parse(action.value || "{}");
    } catch {
      return res.status(200).send();
    }

    const ticketId = acknowledgeValue.ticket_id;
    if (!ticketId || payload.channel?.id !== NOTIFICATION_CHANNEL_ID) {
      return res.status(200).send();
    }

    try {
      await addPrivateNote(ticketId, "This ticket has been escalated. Please take action on it.");
      await slack.postMessage(payload.channel.id, `Acknowledged ticket #${ticketId}. A private note was added.`);
      return res.status(200).send();
    } catch (err) {
      console.error("Slack acknowledge error:", err.response?.data || err.message || err);
      return res.status(500).send();
    }
  }

  const ratingValue = action.value ? JSON.parse(action.value) : null;
  const rating = Number((ratingValue && ratingValue.rating) || action.value || 0);
  const email = ratingValue && ratingValue.email ? ratingValue.email : payload.user?.email || null;
  const ticketId = ratingValue && ratingValue.ticket_id ? ratingValue.ticket_id : null;

  if (!email || !rating || rating < 1 || rating > 5) {
    return res.status(200).send();
  }

  try {
    await createFeedback({
      name: ticketId ? `ticket-${ticketId}` : email,
      ticket_id: ticketId,
      rating_given: rating,
      contact_email: email,
    });
    await slack.postMessage(payload.channel.id, `Thanks! Your rating of ${rating} / 5 has been saved.`);
    res.status(200).send();
  } catch (err) {
    console.error("Slack action feedback error:", err.response?.data || err.message || err);
    res.status(500).send();
  }
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`⚡ Auto-responder running on port ${PORT} — replying as user ${MY_USER_ID}`);
  console.log(`   Slack events:      POST /slack/events`);
  console.log(`   External webhook:  POST /webhook/notify`);
});
