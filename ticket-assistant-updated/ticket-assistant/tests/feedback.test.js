const assert = require("assert");
const { isResolvedStatus, extractFeedbackRating } = require("../services/feedback");
const { findMoEngageFaq } = require("../services/moengageFaq");

assert.strictEqual(isResolvedStatus("Resolved"), true);
assert.strictEqual(isResolvedStatus("4"), true);
assert.strictEqual(isResolvedStatus("Open"), false);

assert.strictEqual(extractFeedbackRating("5 stars"), 5);
assert.strictEqual(extractFeedbackRating("I rate it 4/5"), 4);
assert.strictEqual(extractFeedbackRating("It was okay"), null);

const faq = findMoEngageFaq("what is mo engage do");
assert.ok(faq, "expected FAQ match for spaced Mo Engage question");
assert.match(faq.answer, /customer behavior|engagement/i);

const faq2 = findMoEngageFaq("yes tell me about mo engage");
assert.ok(faq2, "expected FAQ match for brief mo engage mention");

console.log("feedback parser checks passed");
