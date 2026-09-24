const axios = require("axios");

const FRESHDESK_DOMAIN = (process.env.FRESHDESK_DOMAIN || "").replace(/\.freshdesk\.com$/i, "").trim();
const FRESHDESK_API_KEY = process.env.FRESHDESK_API_KEY;

const client = axios.create({
  baseURL: `https://${FRESHDESK_DOMAIN}.freshdesk.com/api/v2`,
  auth: { username: FRESHDESK_API_KEY, password: "X" },
  headers: { "Content-Type": "application/json" },
});

const STATUS_MAP = {
  2: "Open",
  3: "Pending",
  4: "Resolved",
  5: "Closed",
};

const PRIORITY_MAP = {
  1: "Low",
  2: "Medium",
  3: "High",
  4: "Urgent",
};

async function createTicket({ subject, description, email }) {
  const { data } = await client.post("/tickets", {
    subject: subject?.slice(0, 100) || "New ticket from Slack",
    description: (description || subject || "No description provided").slice(0, 2000),
    email,
    priority: 1,
    status: 2,
    source: 100,
  });
  return normalizeTicket(data);
}

async function getTicket(ticketId) {
  const { data } = await client.get(`/tickets/${ticketId}`);
  return normalizeTicket(data);
}

async function addPrivateNote(ticketId, body) {
  const { data } = await client.post(`/tickets/${ticketId}/notes`, {
    body,
    private: true,
  });
  return data;
}

async function createFeedback({ name, ticket_id, rating_given, contact_email, source = "Slack" }) {
  const schemaId = process.env.FRESHDESK_FEEDBACK_SCHEMA_ID || "8797869";
  const recordsPath = `/custom_objects/schemas/${schemaId}/records`;
  const recordName = String(name || `ticket-${ticket_id || contact_email || "feedback"}`);
  const payload = {
    data: {
      name: recordName,
      ticket_id_1: ticket_id == null || ticket_id === "" ? "" : Number(ticket_id),
      rating_given: String(rating_given),
      ticket_id: recordName,
      contact_email: contact_email || "",
      source,
    },
  };

  const { data: responseData } = await client.get(recordsPath);
  const records = Array.isArray(responseData)
    ? responseData
    : responseData?.records || responseData?.data || [];
  const existingRecord = records.find((record) =>
    (record.data?.name || record.name) === recordName
  );

  if (existingRecord) {
    const recordId = existingRecord.display_id || existingRecord.id;
    const { data } = await client.put(`${recordsPath}/${recordId}`, {
      ...payload,
      version: existingRecord.version,
    });
    await updateTicketCsatRating(ticket_id, rating_given);
    return data;
  }

  const { data } = await client.post(recordsPath, payload);
  await updateTicketCsatRating(ticket_id, rating_given);
  return data;
}

async function updateTicketCsatRating(ticketId, rating) {
  if (ticketId == null || ticketId === "") return;

  await client.put(`/tickets/${ticketId}`, {
    custom_fields: {
      cf_csat_rating: String(rating),
    },
  });
}

function normalizeTicket(raw) {
  return {
    id: raw.id,
    subject: raw.subject,
    description_text: raw.description_text,
    status: STATUS_MAP[raw.status] || "Unknown",
    priority: PRIORITY_MAP[raw.priority] || "Unknown",
    created_at: raw.created_at,
    updated_at: raw.updated_at,
  };
}

module.exports = { createTicket, getTicket, addPrivateNote, createFeedback };
