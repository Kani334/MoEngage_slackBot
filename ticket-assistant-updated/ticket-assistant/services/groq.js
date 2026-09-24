const Groq = require("groq-sdk");

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODEL = process.env.GROQ_MODEL || "groq/compound-mini";

async function withRetry(fn, retries = 2, delayMs = 500) {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); }
    catch (err) {
      if (i === retries - 1 || !String(err).includes("429")) throw err;
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

/**
 * Parse a free-text Slack message into a structured intent.
 * Returns: { intent: "create_ticket" | "check_status" | "unknown",
 *            ticket_id, subject, description }
 */
async function parseIntent(userText) {
  const systemPrompt = `You are an intent parser for a support-ticket Slack assistant.
Given a user's message, respond with ONLY a JSON object, no other text, matching:
{
  "intent": "create_ticket" | "check_status" | "unknown",
  "ticket_id": string or null,
  "subject": string or null,
  "description": string or null
}
Rules:
- "create_ticket" when the user describes a problem or asks to open/log/raise a ticket.
- "check_status" when the user asks about an existing ticket, mentions a ticket number, or asks "what's the status of...".
- If creating a ticket, write a short "subject" (under 10 words) summarizing the issue, and put the user's full message in "description".
- If checking status, extract the ticket number into "ticket_id" (digits only). If no number is given, set it to null.
- Use "unknown" if the message is unrelated to tickets (e.g. greetings, small talk).`;

  const completion = await withRetry(() => groq.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userText },
    ],
    response_format: { type: "json_object" },
    temperature: 0,
  }));

  try {
    return JSON.parse(completion.choices[0].message.content);
  } catch (err) {
    return { intent: "unknown", ticket_id: null, subject: null, description: null };
  }
}

/**
 * Turn structured data (a ticket object, error, etc.) into a short,
 * friendly Slack message.
 */
async function formatReply(context, data) {
  const systemPrompt = `You are a concise, friendly support assistant replying in Slack.
Turn the given context and data into a short message (2-4 sentences max).
Use Slack-flavored markdown sparingly (bold with *asterisks*, not headers).
Do not invent information that isn't in the data. Do not use emoji excessively (0-1 max).`;

  const completion = await withRetry(() => groq.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Context: ${context}\n\nData: ${JSON.stringify(data)}`,
      },
    ],
    temperature: 0.4,
  }));

  return completion.choices[0].message.content.trim();
}

async function classifyFaqQuestion(userText, faqCatalog = []) {
  if (!process.env.GROQ_API_KEY || !Array.isArray(faqCatalog) || faqCatalog.length === 0) {
    return null;
  }

  const systemPrompt = `You are a FAQ matcher for a support bot.
Determine whether the user's message is asking about one of the FAQ entries below.
If it is, return ONLY valid JSON in the form:
{"matched": true, "faq": "exact FAQ question text"}
If it is not a FAQ question, return:
{"matched": false, "faq": null}
Use the exact FAQ question text from the list when matching.
Keep the meaning faithful; rephrased questions should still match the correct FAQ.`;

  const completion = await withRetry(() => groq.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `User message: ${userText}\n\nFAQ list:\n${faqCatalog.map((faq) => `- ${faq.question}`).join("\n")}`,
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0,
  }));

  try {
    const parsed = JSON.parse(completion.choices[0].message.content);
    if (parsed && parsed.matched && parsed.faq) return parsed;
  } catch (err) {
    console.warn("FAQ classification parsing failed:", err.message || err);
  }

  return null;
}

async function rephraseFaqAnswer(question, answer) {
  if (!process.env.GROQ_API_KEY || !question || !answer) return answer;

  const systemPrompt = `You are a support assistant. Rephrase the FAQ answer in a natural way for Slack.
Rules:
- Preserve the exact meaning and factual content.
- Keep it concise and helpful.
- Do not add new claims or invent details.
- Return only the rewritten answer text.`;

  const completion = await withRetry(() => groq.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Question: ${question}\n\nAnswer: ${answer}`,
      },
    ],
    temperature: 0.4,
  }));

  return completion.choices[0].message.content.trim() || answer;
}

module.exports = { parseIntent, formatReply, classifyFaqQuestion, rephraseFaqAnswer };
