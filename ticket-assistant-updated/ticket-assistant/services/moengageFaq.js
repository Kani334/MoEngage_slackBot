const { classifyFaqQuestion, rephraseFaqAnswer } = require("./groq");

const faqs = [
  ["What does MoEngage do?", "MoEngage helps businesses analyze customer behavior, create personalized experiences, run campaigns, and automate customer engagement.", ["what does moengage do", "moengage do", "what is moengage do", "what is mo engage do", "tell me about moengage", "tell me about mo engage", "about mo engage", "mo engage"]],
  ["What is MoEngage?", "MoEngage is an Agentic Customer Engagement Platform that helps businesses understand customers, personalize experiences, and engage them across multiple channels.", ["what is moengage", "what is mo engage"]],
  ["Who can use MoEngage?", "MoEngage can be used by businesses across industries that want to understand and engage their customers through digital channels.", ["who can use moengage", "use moengage"]],
  ["What are the main features of MoEngage?", "Key capabilities include customer analytics, segmentation, personalization, cross-channel engagement, campaign automation, and AI-powered customer engagement.", ["main features", "features of moengage", "moengage features"]],
  ["How does MoEngage help improve customer engagement?", "MoEngage uses customer data and behavioral insights to help businesses deliver relevant messages and personalized experiences at the right time.", ["improve customer engagement", "customer engagement"]],
  ["What is customer analytics in MoEngage?", "Customer analytics helps businesses understand user behavior, engagement patterns, conversion journeys, retention, and other customer insights.", ["customer analytics", "analytics in moengage"]],
  ["What is User Analysis?", "User Analysis helps businesses understand individual customer behavior and interactions across their digital experiences.", ["user analysis", "user behaviour analysis", "user behavior analysis"]],
  ["What is Funnel Analysis?", "Funnel Analysis helps identify how customers move through different stages of a journey and where they drop off.", ["funnel analysis", "customer funnel"]],
  ["What is Retention Analysis?", "Retention Analysis helps businesses understand how effectively they retain customers over time.", ["retention analysis", "customer retention analysis"]],
  ["Can MoEngage analyze customer behavior?", "Yes. MoEngage can analyze customer interactions and behavioral data to provide insights that can be used for engagement and personalization.", ["analyze customer behavior", "analyse customer behavior", "customer behavior"]],
  ["What are RFM Segments?", "RFM segmentation categorizes customers based on Recency, Frequency, and Monetary value to help businesses identify different customer groups.", ["rfm segments", "rfm segmentation", "recency frequency monetary"]],
  ["What are Affinity Segments?", "Affinity Segments help identify customers based on their interests or preferences inferred from their interactions and behavior.", ["affinity segments", "affinity segmentation"]],
  ["Does MoEngage support customer segmentation?", "Yes. MoEngage provides segmentation capabilities that allow businesses to create targeted customer groups based on attributes and behavior.", ["customer segmentation", "segment customers"]],
  ["Can MoEngage identify customer drop-offs?", "Yes. Funnel and behavioral analytics can help businesses identify stages where customers drop off during their journeys.", ["customer drop offs", "customer drop-offs", "identify drop offs"]],
  ["Can MoEngage help reduce app uninstalls?", "Yes. MoEngage provides analytics and engagement capabilities that can help businesses understand uninstall behavior and create targeted retention campaigns.", ["reduce app uninstalls", "app uninstalls", "uninstall behavior"]],
  ["What communication channels does MoEngage support?", "MoEngage supports multiple customer engagement channels, including email, mobile push notifications, SMS, WhatsApp, and other digital engagement channels.", ["communication channels", "channels does moengage support", "moengage channels"]],
  ["Can I send email campaigns through MoEngage?", "Yes. MoEngage provides tools for creating and delivering personalized email campaigns.", ["email campaigns", "send email campaigns"]],
  ["Can MoEngage send push notifications?", "Yes. Businesses can use MoEngage to create and send personalized mobile push notifications.", ["push notifications", "send push"]],
  ["Does MoEngage support WhatsApp engagement?", "Yes. MoEngage supports WhatsApp as a customer engagement channel for businesses.", ["whatsapp engagement", "support whatsapp"]],
  ["Can MoEngage send SMS messages?", "Yes. SMS can be used as one of the channels for customer communication and engagement.", ["send sms", "sms messages", "sms channel"]],
  ["Can MoEngage create cross-channel campaigns?", "Yes. MoEngage enables businesses to orchestrate customer engagement across multiple channels based on customer behavior and journey requirements.", ["cross channel campaigns", "cross-channel campaigns", "multichannel campaigns"]],
  ["Can MoEngage personalize customer messages?", "Yes. Businesses can use customer attributes, preferences, and behavioral data to create personalized messages and experiences.", ["personalize customer messages", "personalized messages"]],
  ["Can MoEngage personalize app experiences?", "Yes. MoEngage provides capabilities for personalizing experiences within mobile applications based on customer data and behavior.", ["personalize app experiences", "app personalization"]],
  ["Can MoEngage personalize websites?", "Yes. MoEngage provides web personalization capabilities that can be used to deliver more relevant experiences to website visitors.", ["personalize websites", "web personalization"]],
  ["Can MoEngage determine the best time to engage customers?", "MoEngage provides optimization capabilities that can help businesses determine suitable times and channels for customer engagement.", ["best time to engage", "best time to send", "optimization capabilities"]],
  ["Does MoEngage use artificial intelligence?", "Yes. MoEngage uses AI to provide insights, predictions, personalization, and automation for customer engagement activities.", ["artificial intelligence", "does moengage use ai"]],
  ["What is Merlin AI in MoEngage?", "Merlin AI is MoEngage's AI capability designed to help marketers gain insights, create content, analyze data, and improve customer engagement workflows.", ["merlin ai", "what is merlin"]],
  ["What are MoEngage AI Agents?", "MoEngage AI Agents are designed to automate and assist with customer engagement tasks and workflows using AI-driven capabilities.", ["moengage ai agents", "ai agents"]],
  ["Can MoEngage integrate with other platforms?", "Yes. MoEngage provides integrations and APIs that allow businesses to connect customer data and engagement workflows with other systems.", ["integrate with other platforms", "moengage integrations", "moengage api"]],
  ["How can MoEngage help improve marketing performance?", "MoEngage combines customer insights, segmentation, personalization, analytics, automation, and AI to help businesses create more relevant and measurable customer engagement campaigns.", ["improve marketing performance", "marketing performance"]],
];

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/\bmo\s*[- ]?\s*engage\b/g, "moengage")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function scoreFaqMatch(normalizedText, aliases = []) {
  return aliases.reduce((total, alias) => {
    const normalizedAlias = normalize(alias);
    if (!normalizedAlias) return total;
    if (normalizedText.includes(normalizedAlias)) return total + 4;

    const aliasWords = normalizedAlias.split(/\s+/).filter(Boolean);
    const textWords = normalizedText.split(/\s+/).filter(Boolean);
    const overlap = aliasWords.filter((word) => textWords.includes(word)).length;
    return total + overlap;
  }, 0);
}

async function findMoEngageFaq(userText) {
  const normalizedText = normalize(userText);
  if (!normalizedText) return null;

  const directMatch = faqs.find(([, , aliases]) => aliases.some((alias) => normalizedText.includes(normalize(alias))));
  if (directMatch) {
    const answer = await rephraseFaqAnswer(directMatch[0], directMatch[1]);
    return { question: directMatch[0], answer };
  }

  const scoredFaqs = faqs
    .map(([question, answer, aliases]) => ({
      question,
      answer,
      score: scoreFaqMatch(normalizedText, aliases),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scoredFaqs.length > 0) {
    const answer = await rephraseFaqAnswer(scoredFaqs[0].question, scoredFaqs[0].answer);
    return { question: scoredFaqs[0].question, answer };
  }

  try {
    const classification = await classifyFaqQuestion(userText, faqs.map(([question, answer]) => ({ question, answer })));
    if (classification && classification.matched && classification.faq) {
      const faq = faqs.find(([question]) => question === classification.faq);
      if (faq) {
        const answer = await rephraseFaqAnswer(faq[0], faq[1]);
        return { question: faq[0], answer };
      }
    }
  } catch (err) {
    console.warn("MoEngage FAQ classification failed:", err.message || err);
  }

  return null;
}

module.exports = { findMoEngageFaq };