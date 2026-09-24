// Minimal file-based store mapping Slack user IDs to Freshdesk emails.
//
// This is intentionally simple so the project runs with zero external
// dependencies. For production, swap this out for a real database
// (Postgres, Redis, etc.) — keep the same function signatures and
// nothing else in the app needs to change.

const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "userMap.json");

function loadAll() {
  if (!fs.existsSync(DB_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveAll(map) {
  fs.writeFileSync(DB_PATH, JSON.stringify(map, null, 2));
}

function getEmail(slackUserId) {
  const map = loadAll();
  return map[slackUserId] || null;
}

function setEmail(slackUserId, email) {
  const map = loadAll();
  map[slackUserId] = email;
  saveAll(map);
}

function findSlackUserByEmail(email) {
  const map = loadAll();
  const entry = Object.entries(map).find(([, e]) => e.toLowerCase() === email.toLowerCase());
  return entry ? entry[0] : null;
}

module.exports = { getEmail, setEmail, findSlackUserByEmail };
