// Turns the many spellings of a payee ("SWIGGY", "swiggy@icici", "Swiggy Instamart") into one merchant.
export type NormalizedMerchant = { key: string; name: string };

// Well-known brands: any cleaned name matching the pattern collapses to the canonical display name.
const BRANDS: [RegExp, string][] = [
  [/swiggy/, 'Swiggy'], [/zomato/, 'Zomato'], [/\bamazon\b|\bamzn\b|amazon pay/, 'Amazon'], [/flipkart/, 'Flipkart'],
  [/myntra/, 'Myntra'], [/\bajio\b/, 'Ajio'], [/nykaa/, 'Nykaa'], [/meesho/, 'Meesho'],
  [/\buber\b/, 'Uber'], [/\bola\b|olacabs|ola cabs/, 'Ola'], [/rapido/, 'Rapido'], [/irctc/, 'IRCTC'], [/redbus/, 'RedBus'],
  [/netflix/, 'Netflix'], [/spotify/, 'Spotify'], [/hotstar|disney/, 'Hotstar'], [/bookmyshow|bms\b/, 'BookMyShow'],
  [/youtube|google play|googleplay|google one/, 'Google'], [/apple\.com|itunes|apple services/, 'Apple'],
  [/bigbasket/, 'BigBasket'], [/blinkit|grofers/, 'Blinkit'], [/zepto/, 'Zepto'], [/\bdmart\b|avenue supermarts/, 'DMart'],
  [/airtel/, 'Airtel'], [/\bjio\b|reliance jio/, 'Jio'], [/vodafone|\bvi\b/, 'Vi'], [/\bbsnl\b/, 'BSNL'],
  [/apollo/, 'Apollo'], [/pharmeasy/, 'PharmEasy'], [/1mg|tata 1mg/, 'Tata 1mg'], [/medplus/, 'MedPlus'],
  [/starbucks/, 'Starbucks'], [/dominos|domino s/, "Domino's"], [/mcdonald/, "McDonald's"], [/\bkfc\b/, 'KFC'], [/pizza hut/, 'Pizza Hut'],
  [/indian oil|indianoil|iocl/, 'Indian Oil'], [/\bbpcl\b|bharat petroleum/, 'Bharat Petroleum'], [/\bhpcl\b|hindustan petroleum/, 'HP Petrol'],
  [/phonepe/, 'PhonePe'], [/paytm(?! qr)/, 'Paytm'], [/cred\b/, 'CRED'],
];

const LEGAL = /\b(pvt|private|ltd|limited|llp|inc|corp|corporation|opc)\b/g;

const titleCase = (s: string, shout: boolean) =>
  s.split(' ').filter(Boolean).map((w) => (shout && w.length <= 3 && /^[a-z]+$/.test(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(' ');

export function normalizeMerchant(raw: string): NormalizedMerchant | null {
  let s = raw.trim();
  if (!s) return null;
  const wasShouting = s === s.toUpperCase() && /[A-Z]/.test(s);
  s = s.toLowerCase();

  // UPI handle: keep the part before @
  if (s.includes('@')) {
    const local = s.split('@')[0];
    // QR/aggregator handles carry no readable name; keep them distinct but readable
    const isQr = /^(paytmqr|q\d{6,}|bharatpe|gpay-|upi)/.test(local) || (/\d{8,}/.test(local) && !/^\d+$/.test(local));
    if (isQr)
      return { key: `qr:${local}`, name: `UPI QR ·${local.slice(-4)}` };
    s = local;
  }
  s = s.replace(/^m\/s\.?\s+/, '').replace(/[._\-\/*]+/g, ' ').replace(/[^a-z0-9&' ]+/g, ' ');
  const brand = BRANDS.find(([re]) => re.test(s.replace(/'/g, '')));
  if (brand) return { key: brand[1].toLowerCase(), name: brand[1] };

  // drop legal suffixes and trailing reference numbers
  s = s.replace(LEGAL, ' ').replace(/(\s+\d{4,})+\s*$/, '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (/^\d{10}$/.test(s)) return { key: s, name: s }; // a phone number; keep as-is
  return { key: s, name: titleCase(s, wasShouting) };
}
