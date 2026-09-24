function isResolvedStatus(status) {
  if (status === undefined || status === null) return false;

  const normalized = String(status).trim().toLowerCase();
  if (!normalized) return false;

  return (
    normalized === "resolved" ||
    normalized === "closed" ||
    normalized === "4" ||
    normalized === "5" ||
    normalized === "resolved ticket" ||
    normalized === "closed ticket"
  );
}

function extractFeedbackRating(text) {
  if (!text) return null;

  const cleaned = String(text).trim().toLowerCase();
  const starMatch = cleaned.match(/(?:\b(\d)\s*\/\s*5\b|\b(\d)\s*stars?\b|\bstar\s*(\d)\b)/i);
  if (starMatch) {
    const value = [starMatch[1], starMatch[2], starMatch[3]].find((n) => n !== undefined);
    const rating = Number(value);
    if (rating >= 1 && rating <= 5) return rating;
  }

  const directMatch = cleaned.match(/\b([1-5])\b/);
  if (!directMatch) return null;

  const rating = Number(directMatch[1]);
  return rating >= 1 && rating <= 5 ? rating : null;
}

module.exports = { isResolvedStatus, extractFeedbackRating };
