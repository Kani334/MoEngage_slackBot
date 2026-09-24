process.env.GROQ_API_KEY = "";

const assert = require("assert");
const { isResolvedStatus, extractFeedbackRating } = require("../services/feedback");
const { findMoEngageFaq } = require("../services/moengageFaq");
const { getGroqModelCandidates } = require("../services/groq");

(async () => {
	assert.strictEqual(isResolvedStatus("Resolved"), true);
	assert.strictEqual(isResolvedStatus("4"), true);
	assert.strictEqual(isResolvedStatus("Open"), false);

	assert.strictEqual(extractFeedbackRating("5 stars"), 5);
	assert.strictEqual(extractFeedbackRating("I rate it 4/5"), 4);
	assert.strictEqual(extractFeedbackRating("It was okay"), null);

	const faq = await findMoEngageFaq("what is mo engage do");
	assert.ok(faq, "expected FAQ match for spaced Mo Engage question");
	assert.match(faq.answer, /customer behavior|engagement/i);

	const faq2 = await findMoEngageFaq("yes tell me about mo engage");
	assert.ok(faq2, "expected FAQ match for brief mo engage mention");

	process.env.GROQ_MODEL = "groq/compound-mini";
	const candidates = getGroqModelCandidates();
	assert.ok(candidates.includes("llama-3.3-70b-versatile"), "expected fallback model to be present");
	assert.ok(!candidates.includes("groq/compound-mini"), "expected groq/ prefix to be stripped");

	console.log("feedback parser checks passed");
})().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
