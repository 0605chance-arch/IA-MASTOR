// tiers.js
const TIERS = {
  BASIC: ["chat", "image"],
  VIDEO: ["chat", "image", "video"],
  STUDIO: ["chat", "image", "video", "studio"]
};

function getActiveTier() {
  // Récupère la variable d'environnement (ex: TIER=BASIC) ou met STUDIO par défaut
  const envTier = (process.env.TIER || "").toUpperCase().trim();
  if (TIERS[envTier]) return envTier;
  return "STUDIO"; // Par défaut, on affiche tout (pratique pour tes tests locaux)
}

function getFeaturesForTier(tier) {
  return TIERS[tier] || TIERS.STUDIO;
}

module.exports = { getActiveTier, getFeaturesForTier };
