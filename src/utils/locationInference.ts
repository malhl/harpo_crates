/**
 * utils/locationInference.ts — Client-side location inference from Bluesky profile + posts.
 *
 * Three signals are combined and cross-referenced for maximum specificity:
 *   1. Bio parsing — regex patterns for "Based in X", "📍X", "From X", etc.
 *   2. Timezone inference — find the sleep trough in posting times to estimate UTC offset
 *   3. Post text scanning — count mentions of known cities/countries/states
 *
 * The combiner cross-references timezone with post mentions to narrow broad
 * timezone regions down to specific cities when possible.
 */

export interface LocationGuess {
  /** Most specific guess possible, or null if nothing found */
  bestGuess: string | null
  /** 0–100 overall confidence heat score */
  heat: number
  /** Human-readable specificity level */
  specificity: 'exact' | 'city' | 'region' | 'timezone' | 'unknown'
  /** Individual signals that contributed */
  signals: LocationSignal[]
}

export interface LocationSignal {
  source: 'bio' | 'timezone' | 'posts'
  label: string
  detail: string
  /** 0–100 confidence for this signal */
  heat: number
}

// ── Timezone → region/city mapping for cross-referencing ──

interface TzRegion {
  label: string
  cities: string[]
}

const TIMEZONE_REGIONS: Record<number, TzRegion> = {
  [-12]: { label: 'Baker Island', cities: [] },
  [-11]: { label: 'Samoa', cities: [] },
  [-10]: { label: 'Hawaii', cities: ['Honolulu, US'] },
  [-9]:  { label: 'Alaska', cities: ['Anchorage, US'] },
  [-8]:  { label: 'Pacific US / BC', cities: ['Los Angeles, US', 'San Francisco, US', 'Seattle, US', 'Portland, US', 'San Diego, US', 'Sacramento, US', 'Las Vegas, US', 'Vancouver, Canada', 'Olympia, US', 'Tacoma, US', 'Spokane, US', 'Eugene, US', 'Bend, US'] },
  [-7]:  { label: 'Mountain US / Alberta', cities: ['Denver, US', 'Phoenix, US', 'Salt Lake City, US', 'Boise, US', 'Calgary, Canada', 'Edmonton, Canada'] },
  [-6]:  { label: 'Central US / Mexico', cities: ['Chicago, US', 'Houston, US', 'Dallas, US', 'Austin, US', 'San Antonio, US', 'Nashville, US', 'Minneapolis, US', 'Milwaukee, US', 'St. Louis, US', 'Mexico City, Mexico'] },
  [-5]:  { label: 'Eastern US / Ontario', cities: ['New York, US', 'Philadelphia, US', 'Boston, US', 'Atlanta, US', 'Miami, US', 'Detroit, US', 'Pittsburgh, US', 'Baltimore, US', 'Cleveland, US', 'Tampa, US', 'Orlando, US', 'Charlotte, US', 'Raleigh, US', 'Richmond, US', 'Toronto, Canada', 'Ottawa, Canada', 'Montreal, Canada'] },
  [-4]:  { label: 'Atlantic / Caribbean', cities: ['Halifax, Canada'] },
  [-3]:  { label: 'Argentina / Brazil', cities: ['Buenos Aires, Argentina', 'São Paulo, Brazil', 'Rio de Janeiro, Brazil'] },
  [-2]:  { label: 'Mid-Atlantic', cities: [] },
  [-1]:  { label: 'Azores', cities: [] },
  [0]:   { label: 'UK / Iceland / Portugal', cities: ['London, UK', 'Manchester, UK', 'Birmingham, UK', 'Edinburgh, UK', 'Glasgow, UK', 'Bristol, UK', 'Liverpool, UK', 'Leeds, UK', 'Dublin, Ireland', 'Lisbon, Portugal'] },
  [1]:   { label: 'Central Europe / West Africa', cities: ['Paris, France', 'Berlin, Germany', 'Munich, Germany', 'Hamburg, Germany', 'Amsterdam, Netherlands', 'Brussels, Belgium', 'Madrid, Spain', 'Barcelona, Spain', 'Rome, Italy', 'Milan, Italy', 'Vienna, Austria', 'Zurich, Switzerland', 'Stockholm, Sweden', 'Oslo, Norway', 'Copenhagen, Denmark', 'Prague, Czech Republic', 'Warsaw, Poland', 'Lagos, Nigeria'] },
  [2]:   { label: 'Eastern Europe / South Africa', cities: ['Helsinki, Finland', 'Bucharest, Romania', 'Budapest, Hungary', 'Athens, Greece', 'Istanbul, Turkey', 'Cairo, Egypt', 'Cape Town, South Africa', 'Johannesburg, South Africa', 'Tel Aviv, Israel'] },
  [3]:   { label: 'Moscow / East Africa', cities: ['Nairobi, Kenya'] },
  [4]:   { label: 'Gulf / Caucasus', cities: ['Dubai, UAE'] },
  [5]:   { label: 'Pakistan / Central Asia', cities: [] },
  [6]:   { label: 'Bangladesh / Central Asia', cities: [] },
  [7]:   { label: 'Indochina / Western Indonesia', cities: ['Bangkok, Thailand', 'Jakarta, Indonesia', 'Hanoi, Vietnam'] },
  [8]:   { label: 'China / Singapore / Western Australia', cities: ['Beijing, China', 'Shanghai, China', 'Hong Kong, Hong Kong', 'Taipei, Taiwan', 'Singapore, Singapore', 'Kuala Lumpur, Malaysia', 'Manila, Philippines', 'Perth, Australia'] },
  [9]:   { label: 'Japan / Korea', cities: ['Tokyo, Japan', 'Osaka, Japan', 'Seoul, South Korea'] },
  [10]:  { label: 'Eastern Australia', cities: ['Sydney, Australia', 'Melbourne, Australia', 'Brisbane, Australia'] },
  [11]:  { label: 'Solomon Islands', cities: [] },
  [12]:  { label: 'New Zealand / Fiji', cities: ['Auckland, New Zealand', 'Wellington, New Zealand'] },
}

// ── Bio parsing ──

const BIO_PATTERNS: RegExp[] = [
  /📍\s*(.+)/i,
  /(?:based|located|living|residing)\s+(?:in|out of)\s+(.+)/i,
  /(?:from|hailing from)\s+(.+)/i,
  /(?:^|\n)([A-Z][a-z]+(?:\s[A-Z][a-z]+)*,\s*[A-Z]{2})\b/m,           // "Austin, TX"
  /(?:^|\n)([A-Z][a-z]+(?:\s[A-Z][a-z]+)*,\s*[A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\b/m, // "London, England"
]

export function parseLocationFromBio(bio: string): LocationSignal[] {
  if (!bio) return []

  for (const pattern of BIO_PATTERNS) {
    const match = bio.match(pattern)
    if (match?.[1]) {
      const raw = match[1].split('\n')[0].trim().replace(/[.!|·•—–\-🏳🌈]+$/, '').trim()
      if (raw.length > 1 && raw.length < 80) {
        return [{
          source: 'bio',
          label: raw,
          detail: `Bio says "${match[0].trim()}"`,
          heat: 90,
        }]
      }
    }
  }

  return []
}

// ── Timezone inference from posting times ──

export interface TimezoneResult {
  offset: number
  region: TzRegion
  signal: LocationSignal
}

export function inferTimezone(timestamps: string[]): TimezoneResult | null {
  if (timestamps.length < 20) return null

  const hourCounts = new Array(24).fill(0)
  for (const ts of timestamps) {
    const d = new Date(ts)
    if (!isNaN(d.getTime())) hourCounts[d.getUTCHours()]++
  }

  // Find the 4-hour window with the fewest posts (the "sleep trough")
  let minSum = Infinity
  let minStart = 0
  for (let start = 0; start < 24; start++) {
    let sum = 0
    for (let i = 0; i < 4; i++) sum += hourCounts[(start + i) % 24]
    if (sum < minSum) { minSum = sum; minStart = start }
  }

  // Midpoint of sleep window → ~3:30am local
  const sleepMidUtc = (minStart + 2) % 24
  let offset = Math.round(3.5 - sleepMidUtc)
  if (offset > 12) offset -= 24
  if (offset < -12) offset += 24

  const total = timestamps.length
  const troughPct = Math.round((minSum / total) * 100)

  // Heat: strong trough + many posts = high confidence
  let heat = 40
  if (troughPct < 2) heat += 25
  else if (troughPct < 5) heat += 15
  else if (troughPct < 8) heat += 5
  if (total >= 500) heat += 15
  else if (total >= 200) heat += 10
  else if (total >= 50) heat += 5

  const region = TIMEZONE_REGIONS[offset] ?? { label: `UTC${offset >= 0 ? '+' : ''}${offset}`, cities: [] }

  // Build activity chart
  const maxCount = Math.max(...hourCounts)
  const chartLines = []
  for (let localH = 0; localH < 24; localH++) {
    const utcH = ((localH - offset) % 24 + 24) % 24
    const c = hourCounts[utcH]
    const bar = maxCount > 0 ? Math.round((c / maxCount) * 8) : 0
    chartLines.push(`${String(localH).padStart(2, '0')}:00 ${'█'.repeat(bar)}${'░'.repeat(8 - bar)} ${c}`)
  }

  return {
    offset,
    region,
    signal: {
      source: 'timezone',
      label: region.label,
      detail: `Estimated UTC${offset >= 0 ? '+' : ''}${offset} — sleep trough at ${String(minStart).padStart(2, '0')}:00–${String((minStart + 4) % 24).padStart(2, '0')}:00 UTC (${troughPct}% of ${total} posts)\n\nActivity by estimated local time:\n${chartLines.join('\n')}`,
      heat,
    },
  }
}

// ── Post text scanning for location mentions ──

const LOCATION_KEYWORDS: [string, string][] = [
  // US cities
  ['New York', 'New York, US'], ['NYC', 'New York, US'], ['Manhattan', 'New York, US'], ['Brooklyn', 'New York, US'],
  ['Los Angeles', 'Los Angeles, US'], ['LA', 'Los Angeles, US'],
  ['Chicago', 'Chicago, US'], ['Houston', 'Houston, US'], ['Phoenix', 'Phoenix, US'],
  ['Philadelphia', 'Philadelphia, US'], ['San Antonio', 'San Antonio, US'], ['San Diego', 'San Diego, US'],
  ['Dallas', 'Dallas, US'], ['Austin', 'Austin, US'], ['San Francisco', 'San Francisco, US'], ['SF', 'San Francisco, US'],
  ['Seattle', 'Seattle, US'], ['Denver', 'Denver, US'], ['Boston', 'Boston, US'], ['Nashville', 'Nashville, US'],
  ['Portland', 'Portland, US'], ['Las Vegas', 'Las Vegas, US'], ['Atlanta', 'Atlanta, US'], ['Miami', 'Miami, US'],
  ['Minneapolis', 'Minneapolis, US'], ['Detroit', 'Detroit, US'], ['Pittsburgh', 'Pittsburgh, US'],
  ['Baltimore', 'Baltimore, US'], ['Milwaukee', 'Milwaukee, US'], ['Cleveland', 'Cleveland, US'],
  ['St. Louis', 'St. Louis, US'], ['Tampa', 'Tampa, US'], ['Orlando', 'Orlando, US'],
  ['Sacramento', 'Sacramento, US'], ['Raleigh', 'Raleigh, US'], ['Charlotte', 'Charlotte, US'],
  ['Salt Lake City', 'Salt Lake City, US'], ['Richmond', 'Richmond, US'],
  ['Olympia', 'Olympia, US'], ['Tacoma', 'Tacoma, US'], ['Spokane', 'Spokane, US'],
  ['Boise', 'Boise, US'], ['Eugene', 'Eugene, US'], ['Bend', 'Bend, US'],
  ['Honolulu', 'Honolulu, US'], ['Anchorage', 'Anchorage, US'],
  // US states
  ['California', 'California, US'], ['Texas', 'Texas, US'], ['Florida', 'Florida, US'],
  ['Massachusetts', 'Massachusetts, US'], ['Pennsylvania', 'Pennsylvania, US'],
  ['Illinois', 'Illinois, US'], ['Ohio', 'Ohio, US'], ['Georgia', 'Georgia, US'],
  ['Michigan', 'Michigan, US'], ['Virginia', 'Virginia, US'], ['Washington state', 'Washington, US'],
  ['Colorado', 'Colorado, US'], ['Minnesota', 'Minnesota, US'], ['Wisconsin', 'Wisconsin, US'],
  ['Oregon', 'Oregon, US'], ['Connecticut', 'Connecticut, US'], ['New Jersey', 'New Jersey, US'],
  // Canada
  ['Toronto', 'Toronto, Canada'], ['Vancouver', 'Vancouver, Canada'], ['Montreal', 'Montreal, Canada'],
  ['Ottawa', 'Ottawa, Canada'], ['Calgary', 'Calgary, Canada'], ['Edmonton', 'Edmonton, Canada'],
  // UK
  ['London', 'London, UK'], ['Manchester', 'Manchester, UK'], ['Birmingham', 'Birmingham, UK'],
  ['Edinburgh', 'Edinburgh, UK'], ['Glasgow', 'Glasgow, UK'], ['Bristol', 'Bristol, UK'],
  ['Liverpool', 'Liverpool, UK'], ['Leeds', 'Leeds, UK'],
  // Europe
  ['Paris', 'Paris, France'], ['Berlin', 'Berlin, Germany'], ['Munich', 'Munich, Germany'],
  ['Hamburg', 'Hamburg, Germany'], ['Amsterdam', 'Amsterdam, Netherlands'],
  ['Brussels', 'Brussels, Belgium'], ['Madrid', 'Madrid, Spain'], ['Barcelona', 'Barcelona, Spain'],
  ['Rome', 'Rome, Italy'], ['Milan', 'Milan, Italy'], ['Vienna', 'Vienna, Austria'],
  ['Zurich', 'Zurich, Switzerland'], ['Stockholm', 'Stockholm, Sweden'], ['Oslo', 'Oslo, Norway'],
  ['Copenhagen', 'Copenhagen, Denmark'], ['Helsinki', 'Helsinki, Finland'],
  ['Dublin', 'Dublin, Ireland'], ['Lisbon', 'Lisbon, Portugal'], ['Prague', 'Prague, Czech Republic'],
  ['Warsaw', 'Warsaw, Poland'], ['Budapest', 'Budapest, Hungary'], ['Bucharest', 'Bucharest, Romania'],
  ['Athens', 'Athens, Greece'],
  // Asia-Pacific
  ['Tokyo', 'Tokyo, Japan'], ['Osaka', 'Osaka, Japan'], ['Seoul', 'Seoul, South Korea'],
  ['Beijing', 'Beijing, China'], ['Shanghai', 'Shanghai, China'], ['Hong Kong', 'Hong Kong'],
  ['Taipei', 'Taipei, Taiwan'], ['Singapore', 'Singapore'], ['Bangkok', 'Bangkok, Thailand'],
  ['Jakarta', 'Jakarta, Indonesia'], ['Manila', 'Manila, Philippines'],
  ['Kuala Lumpur', 'Kuala Lumpur, Malaysia'], ['Hanoi', 'Hanoi, Vietnam'],
  ['Mumbai', 'Mumbai, India'], ['Delhi', 'Delhi, India'], ['Bangalore', 'Bangalore, India'],
  // Oceania
  ['Sydney', 'Sydney, Australia'], ['Melbourne', 'Melbourne, Australia'], ['Brisbane', 'Brisbane, Australia'],
  ['Perth', 'Perth, Australia'], ['Auckland', 'Auckland, New Zealand'], ['Wellington', 'Wellington, New Zealand'],
  // South America
  ['São Paulo', 'São Paulo, Brazil'], ['Rio de Janeiro', 'Rio de Janeiro, Brazil'],
  ['Buenos Aires', 'Buenos Aires, Argentina'], ['Lima', 'Lima, Peru'],
  ['Bogotá', 'Bogotá, Colombia'], ['Santiago', 'Santiago, Chile'],
  ['Mexico City', 'Mexico City, Mexico'],
  // Middle East / Africa
  ['Dubai', 'Dubai, UAE'], ['Tel Aviv', 'Tel Aviv, Israel'], ['Istanbul', 'Istanbul, Turkey'],
  ['Cairo', 'Cairo, Egypt'], ['Lagos', 'Lagos, Nigeria'], ['Nairobi', 'Nairobi, Kenya'],
  ['Cape Town', 'Cape Town, South Africa'], ['Johannesburg', 'Johannesburg, South Africa'],
]

const SHORT_KEYWORDS = new Set(['LA', 'SF', 'NYC'])

export interface PostScanResult {
  /** All location → count pairs, sorted by count desc */
  ranked: [string, number][]
  signal: LocationSignal | null
}

export function scanPostsForLocations(postTexts: string[]): PostScanResult {
  const counts = new Map<string, number>()

  for (const text of postTexts) {
    const matched = new Set<string>()
    for (const [keyword, location] of LOCATION_KEYWORDS) {
      if (matched.has(location)) continue
      if (SHORT_KEYWORDS.has(keyword)) {
        if (new RegExp(`\\b${keyword}\\b`).test(text)) {
          counts.set(location, (counts.get(location) ?? 0) + 1)
          matched.add(location)
        }
      } else if (text.includes(keyword)) {
        counts.set(location, (counts.get(location) ?? 0) + 1)
        matched.add(location)
      }
    }
  }

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1])
  if (ranked.length === 0) return { ranked, signal: null }

  const topCount = ranked[0][1]
  if (topCount < 2) return { ranked, signal: null }

  const top5 = ranked.slice(0, 5)
  const detail = top5.map(([loc, n]) => `${loc}: ${n} mentions`).join('\n')

  let heat = 20
  if (topCount >= 20) heat = 60
  else if (topCount >= 10) heat = 45
  else if (topCount >= 5) heat = 35
  else if (topCount >= 3) heat = 25

  // Bonus if top location is clearly dominant
  if (ranked.length >= 2 && topCount >= ranked[1][1] * 2) heat += 10

  return {
    ranked,
    signal: {
      source: 'posts',
      label: ranked[0][0],
      detail: `Top location mentions across ${postTexts.length} posts:\n${detail}`,
      heat: Math.min(heat, 70), // post mentions alone max at 70
    },
  }
}

// ── Combine all signals with cross-referencing ──

export function inferLocation(
  bio: string,
  postTexts: string[],
  timestamps: string[],
): LocationGuess {
  const bioSignals = parseLocationFromBio(bio)
  const tzResult = inferTimezone(timestamps)
  const postResult = scanPostsForLocations(postTexts)

  const signals: LocationSignal[] = []
  let bestGuess: string | null = null
  let heat = 0
  let specificity: LocationGuess['specificity'] = 'unknown'

  // ── Priority 1: Bio gives the most specific answer ──
  if (bioSignals.length > 0) {
    signals.push(bioSignals[0])
    bestGuess = bioSignals[0].label
    heat = bioSignals[0].heat
    specificity = 'exact'

    // Boost if timezone corroborates
    if (tzResult) {
      signals.push(tzResult.signal)
      // Check if bio location is in the timezone's city list
      const bioLower = bestGuess.toLowerCase()
      const tzCitiesLower = tzResult.region.cities.map(c => c.toLowerCase())
      if (tzCitiesLower.some(c => c.includes(bioLower) || bioLower.includes(c.split(',')[0]))) {
        heat = Math.min(100, heat + 8)
      }
    }
    if (postResult.signal) signals.push(postResult.signal)

    return { bestGuess, heat, specificity, signals }
  }

  // ── Priority 2: Cross-reference timezone + post mentions for city-level guess ──
  if (tzResult) {
    const tzCities = new Set(tzResult.region.cities)

    // Find post-mentioned cities that fall within the inferred timezone
    const matchingCities: [string, number][] = []
    for (const [loc, count] of postResult.ranked) {
      if (tzCities.has(loc)) {
        matchingCities.push([loc, count])
      }
    }

    if (matchingCities.length > 0 && matchingCities[0][1] >= 2) {
      // We have a city that matches the timezone — use it
      const [topCity, topCount] = matchingCities[0]
      bestGuess = topCity
      specificity = 'city'

      // Heat: start from timezone heat, boost for post corroboration
      heat = tzResult.signal.heat
      if (topCount >= 10) heat += 25
      else if (topCount >= 5) heat += 18
      else if (topCount >= 3) heat += 12
      else heat += 8

      // If there's a clear winner among timezone-matching cities, boost more
      if (matchingCities.length >= 2 && topCount >= matchingCities[1][1] * 2) {
        heat += 5
      }
      heat = Math.min(heat, 85) // cap without bio

      // Build a combined signal explaining the cross-reference
      signals.push({
        source: 'posts',
        label: topCity,
        detail: `Timezone narrows to ${tzResult.region.label}. Within that region, "${topCity.split(',')[0]}" appears ${topCount} times in posts — more than any other city in this timezone.\n\n${matchingCities.map(([c, n]) => `  ${c}: ${n} mentions`).join('\n')}`,
        heat,
      })
      signals.push(tzResult.signal)
      if (postResult.signal && postResult.signal.label !== topCity) {
        signals.push(postResult.signal)
      }

      return { bestGuess, heat, specificity, signals }
    }

    // No city-level cross-match — check if any post mentions are in a nearby timezone (±1)
    const nearbyOffsets = [tzResult.offset - 1, tzResult.offset, tzResult.offset + 1]
    const nearbyCities = new Set<string>()
    for (const o of nearbyOffsets) {
      const r = TIMEZONE_REGIONS[o]
      if (r) r.cities.forEach(c => nearbyCities.add(c))
    }
    const nearbyMatches: [string, number][] = []
    for (const [loc, count] of postResult.ranked) {
      if (nearbyCities.has(loc)) nearbyMatches.push([loc, count])
    }

    if (nearbyMatches.length > 0 && nearbyMatches[0][1] >= 3) {
      const [topCity, topCount] = nearbyMatches[0]
      bestGuess = topCity
      specificity = 'city'
      heat = Math.min(tzResult.signal.heat + (topCount >= 5 ? 10 : 5), 70)

      signals.push({
        source: 'posts',
        label: topCity,
        detail: `Timezone suggests ${tzResult.region.label} (±1 hour). "${topCity.split(',')[0]}" appears ${topCount} times — best match in the nearby timezone range.`,
        heat,
      })
      signals.push(tzResult.signal)
      return { bestGuess, heat, specificity, signals }
    }

    // Fall back to region-level from timezone
    bestGuess = tzResult.region.label
    heat = tzResult.signal.heat
    specificity = 'region'
    signals.push(tzResult.signal)

    // If post mentions exist but didn't match timezone, still show them
    if (postResult.signal) signals.push(postResult.signal)

    return { bestGuess, heat, specificity, signals }
  }

  // ── Priority 3: Post mentions only (no usable timezone) ──
  if (postResult.signal) {
    signals.push(postResult.signal)
    bestGuess = postResult.signal.label
    heat = postResult.signal.heat
    specificity = 'city'

    return { bestGuess, heat, specificity, signals }
  }

  // ── Nothing found ──
  return { bestGuess: null, heat: 0, specificity: 'unknown', signals }
}

// ── Batch follower location scanning ──

export interface FollowerLocationResult {
  /** Location string → list of follower handles at that location */
  locations: Map<string, string[]>
  /** Sorted [location, count] pairs, descending */
  ranked: [string, number][]
  /** How many followers had a detectable location */
  detected: number
  /** Total followers scanned */
  total: number
}

/** Also try to match bio text against known city keywords (for bios that just say a city name) */
const CITY_NAMES = new Map<string, string>()
for (const [keyword, location] of LOCATION_KEYWORDS) {
  if (!SHORT_KEYWORDS.has(keyword)) {
    CITY_NAMES.set(keyword.toLowerCase(), location)
  }
}

/** Common abbreviations and alternate names people use in bios */
const BIO_ALIASES = new Map<string, string>([
  // US city abbreviations (safe — not common English words)
  ['atl', 'Atlanta, US'], ['pdx', 'Portland, US'], ['phx', 'Phoenix, US'],
  ['slc', 'Salt Lake City, US'], ['stl', 'St. Louis, US'],
  ['dtx', 'Dallas, US'], ['dfw', 'Dallas, US'],
  // US state abbreviations — only those that aren't common English words.
  // Omitted: in, or, al, la, ma, oh, pa, co, mi, va, ga, md, me, hi, ok, id
  // These still work when written as "City, ST" via STATE_ABBREVS + normalizeLocation().
  ['tx', 'Texas, US'], ['fl', 'Florida, US'], ['ny', 'New York, US'],
  ['il', 'Illinois, US'], ['mn', 'Minnesota, US'], ['nc', 'North Carolina, US'],
  ['nj', 'New Jersey, US'], ['ct', 'Connecticut, US'],
  ['wi', 'Wisconsin, US'], ['tn', 'Tennessee, US'],
  ['az', 'Arizona, US'], ['nv', 'Nevada, US'], ['sc', 'South Carolina, US'],
  ['ky', 'Kentucky, US'], ['ut', 'Utah, US'],
  // Country-level
  ['uk', 'United Kingdom'], ['the uk', 'United Kingdom'],
  ['england', 'United Kingdom'], ['scotland', 'United Kingdom'], ['wales', 'United Kingdom'],
  ['usa', 'United States'], ['the us', 'United States'], ['america', 'United States'],
  ['brasil', 'Brazil'], ['deutschland', 'Germany'], ['españa', 'Spain'],
])

/** Map "City, ST" patterns to their normalized form — e.g. "Seattle, WA" → "Seattle, US" */
const STATE_ABBREVS = new Map<string, string>([
  ['wa', 'Seattle'], ['or', 'Portland'], ['ca', 'Los Angeles'], ['tx', 'Houston'],
  ['fl', 'Miami'], ['ny', 'New York'], ['il', 'Chicago'], ['oh', 'Cleveland'],
  ['pa', 'Philadelphia'], ['co', 'Denver'], ['mn', 'Minneapolis'], ['ga', 'Atlanta'],
  ['mi', 'Detroit'], ['va', 'Richmond'], ['nc', 'Charlotte'], ['ma', 'Boston'],
  ['nj', 'New Jersey, US'], ['ct', 'Connecticut, US'], ['wi', 'Milwaukee'],
  ['md', 'Baltimore'], ['tn', 'Nashville'], ['mo', 'St. Louis'], ['az', 'Phoenix'],
  ['nv', 'Las Vegas'], ['ut', 'Salt Lake City'],
])

/** Expand "City, Country" to "City, State/Province, Country" for display */
const STATE_PROVINCE_MAP = new Map<string, string>([
  // US cities
  ['New York, US', 'New York, NY, US'], ['Los Angeles, US', 'Los Angeles, CA, US'],
  ['Chicago, US', 'Chicago, IL, US'], ['Houston, US', 'Houston, TX, US'],
  ['Phoenix, US', 'Phoenix, AZ, US'], ['Philadelphia, US', 'Philadelphia, PA, US'],
  ['San Antonio, US', 'San Antonio, TX, US'], ['San Diego, US', 'San Diego, CA, US'],
  ['Dallas, US', 'Dallas, TX, US'], ['Austin, US', 'Austin, TX, US'],
  ['San Francisco, US', 'San Francisco, CA, US'], ['Seattle, US', 'Seattle, WA, US'],
  ['Denver, US', 'Denver, CO, US'], ['Boston, US', 'Boston, MA, US'],
  ['Nashville, US', 'Nashville, TN, US'], ['Portland, US', 'Portland, OR, US'],
  ['Las Vegas, US', 'Las Vegas, NV, US'], ['Atlanta, US', 'Atlanta, GA, US'],
  ['Miami, US', 'Miami, FL, US'], ['Minneapolis, US', 'Minneapolis, MN, US'],
  ['Detroit, US', 'Detroit, MI, US'], ['Pittsburgh, US', 'Pittsburgh, PA, US'],
  ['Baltimore, US', 'Baltimore, MD, US'], ['Milwaukee, US', 'Milwaukee, WI, US'],
  ['Cleveland, US', 'Cleveland, OH, US'], ['St. Louis, US', 'St. Louis, MO, US'],
  ['Tampa, US', 'Tampa, FL, US'], ['Orlando, US', 'Orlando, FL, US'],
  ['Sacramento, US', 'Sacramento, CA, US'], ['Raleigh, US', 'Raleigh, NC, US'],
  ['Charlotte, US', 'Charlotte, NC, US'], ['Salt Lake City, US', 'Salt Lake City, UT, US'],
  ['Richmond, US', 'Richmond, VA, US'], ['Olympia, US', 'Olympia, WA, US'],
  ['Tacoma, US', 'Tacoma, WA, US'], ['Spokane, US', 'Spokane, WA, US'],
  ['Boise, US', 'Boise, ID, US'], ['Eugene, US', 'Eugene, OR, US'],
  ['Bend, US', 'Bend, OR, US'], ['Honolulu, US', 'Honolulu, HI, US'],
  ['Anchorage, US', 'Anchorage, AK, US'],
  // Canada
  ['Toronto, Canada', 'Toronto, ON, Canada'], ['Vancouver, Canada', 'Vancouver, BC, Canada'],
  ['Montreal, Canada', 'Montreal, QC, Canada'], ['Ottawa, Canada', 'Ottawa, ON, Canada'],
  ['Calgary, Canada', 'Calgary, AB, Canada'], ['Edmonton, Canada', 'Edmonton, AB, Canada'],
  ['Halifax, Canada', 'Halifax, NS, Canada'],
  // Australia
  ['Sydney, Australia', 'Sydney, NSW, Australia'], ['Melbourne, Australia', 'Melbourne, VIC, Australia'],
  ['Brisbane, Australia', 'Brisbane, QLD, Australia'], ['Perth, Australia', 'Perth, WA, Australia'],
])

function expandStateProvince(location: string): string {
  return STATE_PROVINCE_MAP.get(location) ?? location
}

/**
 * Scans an array of follower bios for location signals.
 * Uses bio regex patterns first, then falls back to keyword matching.
 * Returns aggregated location data.
 */
export function scanFollowerLocations(
  followers: { handle: string; description?: string }[],
): FollowerLocationResult {
  const locations = new Map<string, string[]>()
  let detected = 0

  for (const f of followers) {
    const bio = f.description
    if (!bio) continue

    let location: string | null = null

    // Try structured bio patterns first (most reliable)
    for (const pattern of BIO_PATTERNS) {
      const match = bio.match(pattern)
      if (match?.[1]) {
        const raw = match[1].split('\n')[0].trim().replace(/[.!|·•—–\-🏳🌈]+$/, '').trim()
        if (raw.length > 1 && raw.length < 80) {
          // Try to normalize against known locations
          location = normalizeLocation(raw)
          break
        }
      }
    }

    // Fall back: scan bio for known city/country names and aliases
    if (!location) {
      const bioLower = bio.toLowerCase()
      // Check city names first (more specific than aliases)
      for (const [keyword, loc] of CITY_NAMES) {
        if (keyword.length <= 4) {
          if (new RegExp(`\\b${keyword}\\b`, 'i').test(bio)) {
            location = loc
            break
          }
        } else if (bioLower.includes(keyword)) {
          location = loc
          break
        }
      }
      // Then check aliases (ATL, PDX, UK, England, etc.) with word boundaries
      if (!location) {
        for (const [alias, loc] of BIO_ALIASES) {
          if (new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(bio)) {
            location = loc
            break
          }
        }
      }
    }

    if (location) {
      detected++
      const display = expandStateProvince(location)
      const list = locations.get(display) ?? []
      list.push(f.handle)
      locations.set(display, list)
    }
  }

  const ranked = [...locations.entries()]
    .map(([loc, handles]) => [loc, handles.length] as [string, number])
    .sort((a, b) => b[1] - a[1])

  return { locations, ranked, detected, total: followers.length }
}

/** Try to normalize a free-text location against known cities/regions */
function normalizeLocation(raw: string): string {
  const lower = raw.toLowerCase().trim()

  // Check aliases first (ATL, PDX, UK, etc.)
  const alias = BIO_ALIASES.get(lower)
  if (alias) return alias

  // "City, ST" pattern — e.g. "Seattle, WA" or "Portland, OR"
  const cityStateMatch = raw.match(/^([A-Za-z\s.'-]+),\s*([A-Z]{2})$/i)
  if (cityStateMatch) {
    const city = cityStateMatch[1].trim()
    const state = cityStateMatch[2].toLowerCase()
    // Try to find the city in our known locations
    const cityLower = city.toLowerCase()
    for (const [keyword, location] of CITY_NAMES) {
      if (keyword === cityLower) return location
    }
    // If city not found but state is valid, return "City, US"
    if (STATE_ABBREVS.has(state)) {
      return `${city}, US`
    }
  }

  // Direct match against known location names
  for (const [keyword, location] of CITY_NAMES) {
    if (lower === keyword || lower.startsWith(keyword + ',') || lower.startsWith(keyword + ' ')) {
      return location
    }
  }

  // Check if the raw text contains a known city
  for (const [keyword, location] of CITY_NAMES) {
    if (keyword.length >= 5 && lower.includes(keyword)) {
      return location
    }
  }

  // Return as-is if we can't normalize (still useful for display)
  return raw
}
