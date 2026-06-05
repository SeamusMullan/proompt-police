'use strict';

// Prices per million tokens (USD). Update as Anthropic changes pricing.
// Cache read is 10% of input price; cache write is 125% of input price (5-min TTL).
const RATES = {
  // Opus 4.5+ pricing tier: $5/$25
  'claude-opus-4-8':     { input: 5.00,  output: 25.00, cacheRead: 0.50,  cacheWrite: 6.25  },
  'claude-opus-4-7':     { input: 5.00,  output: 25.00, cacheRead: 0.50,  cacheWrite: 6.25  },
  'claude-opus-4-6':     { input: 5.00,  output: 25.00, cacheRead: 0.50,  cacheWrite: 6.25  },
  'claude-opus-4-5':     { input: 5.00,  output: 25.00, cacheRead: 0.50,  cacheWrite: 6.25  },
  // Opus 4.1 and earlier (claude-opus-4-0, claude-opus-4-20250514): $15/$75
  'claude-opus-4-1':     { input: 15.00, output: 75.00, cacheRead: 1.50,  cacheWrite: 18.75 },
  'claude-opus-4':       { input: 15.00, output: 75.00, cacheRead: 1.50,  cacheWrite: 18.75 },
  'claude-sonnet-4-6':   { input: 3.00,  output: 15.00, cacheRead: 0.30,  cacheWrite: 3.75  },
  'claude-sonnet-4-5':   { input: 3.00,  output: 15.00, cacheRead: 0.30,  cacheWrite: 3.75  },
  'claude-haiku-4-5':    { input: 1.00,  output: 5.00,  cacheRead: 0.10,  cacheWrite: 1.25  },
};

const DEFAULT_RATE = { input: 3.00, output: 15.00, cacheRead: 0.30, cacheWrite: 3.75 };

function rateForModel(modelId) {
  if (!modelId) return DEFAULT_RATE;
  const key = Object.keys(RATES).find(k => modelId.includes(k));
  return key ? RATES[key] : DEFAULT_RATE;
}

function estimateCost(usage, modelId) {
  const rate = rateForModel(modelId);
  const M = 1_000_000;
  return (
    (usage.input_tokens || 0) * rate.input / M +
    (usage.output_tokens || 0) * rate.output / M +
    (usage.cache_read_input_tokens || 0) * rate.cacheRead / M +
    (usage.cache_creation_input_tokens || 0) * rate.cacheWrite / M
  );
}

module.exports = { rateForModel, estimateCost, RATES };
