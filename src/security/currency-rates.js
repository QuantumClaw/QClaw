/**
 * Currency conversion using exchangerate-api.com
 */

const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD'];
const CACHE_TTL = 3600000; // 1 hour

let ratesCache = null;
let cacheTime = 0;

async function fetchRates() {
  const now = Date.now();
  if (ratesCache && (now - cacheTime) < CACHE_TTL) {
    return ratesCache;
  }

  try {
    const response = await fetch('https://api.exchangerate-api.com/v4/latest/GBP');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    ratesCache = data.rates;
    cacheTime = now;
    return ratesCache;
  } catch (err) {
    console.error('Failed to fetch exchange rates:', err.message);
    if (ratesCache) {
      console.warn('Using stale exchange rates');
      return ratesCache;
    }
    return { USD: 1.27, EUR: 1.19, GBP: 1, JPY: 196, AUD: 2.02, CAD: 1.79 };
  }
}

export async function convert(amountGBP, targetCurrency) {
  if (targetCurrency === 'GBP') return amountGBP;
  
  const rates = await fetchRates();
  const rate = rates[targetCurrency];
  if (!rate) {
    throw new Error(`Unsupported currency: ${targetCurrency}`);
  }
  return parseFloat((amountGBP * rate).toFixed(2));
}

export async function convertObject(obj, targetCurrency) {
  if (targetCurrency === 'GBP') {
    return { ...obj, currency: 'GBP' };
  }

  const converted = { currency: targetCurrency };
  
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'number') {
      converted[key] = await convert(value, targetCurrency);
    } else if (typeof value === 'object' && value !== null) {
      converted[key] = await convertObject(value, targetCurrency);
    } else {
      converted[key] = value;
    }
  }
  
  return converted;
}

export function getSupportedCurrencies() {
  return SUPPORTED_CURRENCIES;
}
