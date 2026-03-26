import Pkg from '@atproto/api';
const { BskyAgent } = Pkg;
const agent = new BskyAgent({ service: 'https://public.api.bsky.app' });
const delay = ms => new Promise(r => setTimeout(r, ms));

const BIO_PATTERNS = [
  /\u{1F4CD}\s*(.+)/iu,
  /(?:based|located|living|residing)\s+(?:in|out of)\s+(.+)/i,
  /(?:from|hailing from)\s+(.+)/i,
  /(?:^|\n)([A-Z][a-z]+(?:\s[A-Z][a-z]+)*,\s*[A-Z]{2})\b/m,
  /(?:^|\n)([A-Z][a-z]+(?:\s[A-Z][a-z]+)*,\s*[A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\b/m,
];

const LOCS = [
  ['New York','New York, US'],['Los Angeles','Los Angeles, US'],['Chicago','Chicago, US'],
  ['Houston','Houston, US'],['Phoenix','Phoenix, US'],['Philadelphia','Philadelphia, US'],
  ['San Diego','San Diego, US'],['Dallas','Dallas, US'],['Austin','Austin, US'],
  ['San Francisco','San Francisco, US'],['Seattle','Seattle, US'],['Denver','Denver, US'],
  ['Boston','Boston, US'],['Nashville','Nashville, US'],['Portland','Portland, US'],
  ['Las Vegas','Las Vegas, US'],['Atlanta','Atlanta, US'],['Miami','Miami, US'],
  ['Minneapolis','Minneapolis, US'],['Detroit','Detroit, US'],['Pittsburgh','Pittsburgh, US'],
  ['Baltimore','Baltimore, US'],['Milwaukee','Milwaukee, US'],['Cleveland','Cleveland, US'],
  ['St. Louis','St. Louis, US'],['Tampa','Tampa, US'],['Orlando','Orlando, US'],
  ['Sacramento','Sacramento, US'],['Charlotte','Charlotte, US'],['Richmond','Richmond, US'],
  ['Olympia','Olympia, US'],['Tacoma','Tacoma, US'],['Spokane','Spokane, US'],
  ['Toronto','Toronto, Canada'],['Vancouver','Vancouver, Canada'],['Montreal','Montreal, Canada'],
  ['London','London, UK'],['Manchester','Manchester, UK'],['Edinburgh','Edinburgh, UK'],
  ['Glasgow','Glasgow, UK'],['Bristol','Bristol, UK'],['Liverpool','Liverpool, UK'],
  ['Paris','Paris, France'],['Berlin','Berlin, Germany'],['Munich','Munich, Germany'],
  ['Amsterdam','Amsterdam, Netherlands'],['Madrid','Madrid, Spain'],['Barcelona','Barcelona, Spain'],
  ['Rome','Rome, Italy'],['Dublin','Dublin, Ireland'],['Lisbon','Lisbon, Portugal'],
  ['Prague','Prague, Czech Republic'],['Stockholm','Stockholm, Sweden'],
  ['Tokyo','Tokyo, Japan'],['Seoul','Seoul, South Korea'],['Singapore','Singapore'],
  ['Sydney','Sydney, Australia'],['Melbourne','Melbourne, Australia'],
  ['Auckland','Auckland, New Zealand'],['Mexico City','Mexico City, Mexico'],
  ['California','California, US'],['Texas','Texas, US'],['Florida','Florida, US'],
  ['Ohio','Ohio, US'],['Michigan','Michigan, US'],['Oregon','Oregon, US'],
  ['Colorado','Colorado, US'],['Virginia','Virginia, US'],['Georgia','Georgia, US'],
  ['Minnesota','Minnesota, US'],['New Jersey','New Jersey, US'],['Connecticut','Connecticut, US'],
];
const CITY_NAMES = new Map();
for (const [kw, loc] of LOCS) CITY_NAMES.set(kw.toLowerCase(), loc);

const BIO_ALIASES = new Map([
  ['atl','Atlanta, US'],['pdx','Portland, US'],['phx','Phoenix, US'],
  ['slc','Salt Lake City, US'],['stl','St. Louis, US'],['dfw','Dallas, US'],
  ['uk','United Kingdom'],['the uk','United Kingdom'],
  ['england','United Kingdom'],['scotland','United Kingdom'],['wales','United Kingdom'],
  ['usa','United States'],['brasil','Brazil'],['deutschland','Germany'],
]);

const STATE_ABBREVS = new Set([
  'wa','or','ca','tx','fl','ny','il','oh','pa','co','mn','ga',
  'mi','va','nc','ma','nj','ct','wi','md','tn','mo','az','nv','ut'
]);

function normalize(raw) {
  const lower = raw.toLowerCase().trim();
  if (BIO_ALIASES.has(lower)) return BIO_ALIASES.get(lower);
  const m = raw.match(/^([A-Za-z\s.'-]+),\s*([A-Z]{2})$/i);
  if (m) {
    const city = m[1].trim().toLowerCase();
    const st = m[2].toLowerCase();
    if (CITY_NAMES.has(city)) return CITY_NAMES.get(city);
    if (STATE_ABBREVS.has(st)) return m[1].trim() + ', US';
  }
  for (const [k,v] of CITY_NAMES) {
    if (lower === k || lower.startsWith(k+',') || lower.startsWith(k+' ')) return v;
  }
  for (const [k,v] of CITY_NAMES) {
    if (k.length >= 5 && lower.includes(k)) return v;
  }
  return raw;
}

let followers = [];
let cursor;
process.stdout.write('Fetching followers');
do {
  const res = await agent.getFollowers({ actor: 'mal-content.bsky.social', limit: 100, cursor });
  for (const f of res.data.followers)
    followers.push({ handle: f.handle, bio: f.description || '' });
  cursor = res.data.cursor;
  process.stdout.write('.');
  if (cursor) await delay(200);
} while (cursor);
console.log(' ' + followers.length);

const locations = new Map();
let detected = 0, byPattern = 0, byAlias = 0, byKeyword = 0;

for (const f of followers) {
  if (!f.bio) continue;
  let location = null, method = '';

  for (const p of BIO_PATTERNS) {
    const m = f.bio.match(p);
    if (m?.[1]) {
      const raw = m[1].split('\n')[0].trim().replace(/[.!|\u00b7\u2022\u2014\u2013\-]+$/, '').trim();
      if (raw.length > 1 && raw.length < 80) { location = normalize(raw); method = 'pattern'; break; }
    }
  }

  if (!location) {
    for (const [alias, loc] of BIO_ALIASES) {
      if (new RegExp('\\b' + alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(f.bio)) {
        location = loc; method = 'alias'; break;
      }
    }
  }

  if (!location) {
    const bl = f.bio.toLowerCase();
    for (const [kw, loc] of CITY_NAMES) {
      if (kw.length <= 4) {
        if (new RegExp('\\b' + kw + '\\b', 'i').test(f.bio)) { location = loc; method = 'keyword'; break; }
      } else if (bl.includes(kw)) { location = loc; method = 'keyword'; break; }
    }
  }

  if (location) {
    detected++;
    if (method === 'pattern') byPattern++;
    else if (method === 'alias') byAlias++;
    else byKeyword++;
    if (!locations.has(location)) locations.set(location, []);
    locations.get(location).push(f.handle);
  }
}

const noBio = followers.filter(f => !f.bio).length;
const hasBio = followers.length - noBio;

console.log('\n=== DETECTION BREAKDOWN ===');
console.log('Total followers:     ' + followers.length);
console.log('Have a bio:          ' + hasBio + ' (' + Math.round(hasBio/followers.length*100) + '%)');
console.log('No bio:              ' + noBio + ' (' + Math.round(noBio/followers.length*100) + '%)');
console.log('');
console.log('Location detected:   ' + detected + ' (' + Math.round(detected/followers.length*100) + '% of all, ' + Math.round(detected/hasBio*100) + '% of those with bios)');
console.log('  via bio pattern:   ' + byPattern + ' ("Based in", "Living in", "\u{1F4CD}", "City, ST")');
console.log('  via alias:         ' + byAlias + ' (ATL, PDX, UK, etc.)');
console.log('  via keyword:       ' + byKeyword + ' (city name found in bio text)');
console.log('No location found:   ' + (hasBio - detected) + ' (have bio but no location signal)');

const ranked = [...locations.entries()].map(([l,h]) => [l, h.length]).sort((a,b) => b[1]-a[1]);
const max = ranked[0]?.[1] || 1;
console.log('\n=== TOP 30 LOCATIONS ===');
for (const [loc, count] of ranked.slice(0, 30)) {
  const bar = '\u2588'.repeat(Math.round(count / max * 30));
  console.log(String(count).padStart(4) + '  ' + bar.padEnd(32) + loc);
}
console.log('\nUnique locations: ' + ranked.length);
