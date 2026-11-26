const FEATURE_KEYS = ['messaging', 'requests', 'notices', 'analytics', 'documents', 'onboarding', 'email_broadcast'];

const normalizeFeatures = (input = {}) =>
  Object.fromEntries(FEATURE_KEYS.map(key => [key, input[key] !== false]));

// Uma feature só fica disponível se a empresa E o colaborador permitirem.
// Ausência de flag (undefined) significa "sem restrição própria" -- herda
// o que a empresa definiu.
const mergeFeatures = (companyFeatures = {}, userFeatures = {}) =>
  Object.fromEntries(FEATURE_KEYS.map(key => [key, companyFeatures[key] !== false && userFeatures[key] !== false]));

module.exports = { FEATURE_KEYS, normalizeFeatures, mergeFeatures };
