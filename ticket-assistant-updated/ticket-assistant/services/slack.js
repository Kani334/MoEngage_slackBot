const axios = require("axios");

const client = axios.create({
  baseURL: "https://slack.com/api",
  headers: { Authorization: `Bearer ${process.env.SLACK_USER_TOKEN}` },
});

let _markSent = () => {};
function setMarkSent(fn) { _markSent = fn; }

async function postMessage(channel, text, blocks = []) {
  const payload = { channel, text };
  if (blocks && blocks.length) payload.blocks = blocks;

  const { data } = await client.post("/chat.postMessage", payload);
  if (!data.ok) throw new Error(`Slack API error: ${data.error}`);
  if (data.ts) _markSent(data.ts);
  return data;
}

async function getUserEmail(userId) {
  const { data } = await client.get("/users.info", { params: { user: userId } });
  if (!data.ok) return null;
  return data.user?.profile?.email || null;
}

async function openDm(userId) {
  const { data } = await client.post("/conversations.open", { users: userId });
  if (!data.ok) throw new Error(`Slack API error: ${data.error}`);
  return data.channel.id;
}

module.exports = { postMessage, getUserEmail, openDm, setMarkSent };
