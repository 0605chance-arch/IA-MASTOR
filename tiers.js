// tiers.js
const TIERS = {
  BASIC: ["chat", "image"],
  VIDEO: ["chat", "image", "video"],
  STUDIO: ["chat", "image", "video", "studio"]
};

function getActiveTier() {
  const envTier = (process.env.TIER || "").toUpperCase().trim();
  if (TIERS[envTier]) return envTier;
  return "STUDIO"; // Par défaut, tout est affiché
}

function getFeaturesForTier(tier) {
  return TIERS[tier] || TIERS.STUDIO;
}

module.exports = { getActiveTier, getFeaturesForTier };
