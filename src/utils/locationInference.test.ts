import {
  parseLocationFromBio,
  inferTimezone,
  scanPostsForLocations,
  scanFollowerLocations,
  detectUserCity,
  getSearchTermsForLocation,
  profileMatchesLocation,
} from './locationInference'

// ── Helper to build minimal follower objects ──

function follower(handle: string, bio?: string, displayName?: string) {
  return { handle, description: bio, displayName }
}

// ── parseLocationFromBio ──

describe('parseLocationFromBio', () => {
  it('returns empty array for empty bio', () => {
    expect(parseLocationFromBio('')).toEqual([])
  })

  it('detects 📍 pin emoji locations', () => {
    const signals = parseLocationFromBio('📍 Seattle, WA')
    expect(signals).toHaveLength(1)
    expect(signals[0].source).toBe('bio')
    expect(signals[0].label).toBe('Seattle, WA')
  })

  it('detects "based in" patterns', () => {
    const signals = parseLocationFromBio('Software dev. Based in Portland, OR')
    expect(signals).toHaveLength(1)
    expect(signals[0].label).toBe('Portland, OR')
  })

  it('detects "from" patterns', () => {
    const signals = parseLocationFromBio('From Chicago')
    expect(signals).toHaveLength(1)
    expect(signals[0].label).toBe('Chicago')
  })

  it('detects "City, ST" at start of line', () => {
    const signals = parseLocationFromBio('Austin, TX')
    expect(signals).toHaveLength(1)
    expect(signals[0].label).toBe('Austin, TX')
  })

  it('detects "City, Country" at start of line', () => {
    const signals = parseLocationFromBio('London, England')
    expect(signals).toHaveLength(1)
    expect(signals[0].label).toBe('London, England')
  })

  it('strips trailing punctuation and emoji', () => {
    const signals = parseLocationFromBio('📍 Denver, CO 🏳🌈')
    expect(signals).toHaveLength(1)
    expect(signals[0].label).toBe('Denver, CO')
  })

  it('limits captures to first line', () => {
    const signals = parseLocationFromBio('Based in NYC\nI love cats')
    expect(signals).toHaveLength(1)
    expect(signals[0].label).toBe('NYC')
  })

  it('rejects very long matches (>80 chars)', () => {
    const long = 'Based in ' + 'A'.repeat(81)
    expect(parseLocationFromBio(long)).toEqual([])
  })

  it('caps City,ST pattern at 3 words before comma', () => {
    // 3 words should work
    const signals3 = parseLocationFromBio('Salt Lake City, UT')
    expect(signals3).toHaveLength(1)
    // 4 words should NOT match this pattern
    const signals4 = parseLocationFromBio('Former Roster Artist Thing, TX')
    expect(signals4).toEqual([])
  })
})

// ── inferTimezone ──

describe('inferTimezone', () => {
  it('returns null with fewer than 20 timestamps', () => {
    const ts = Array.from({ length: 19 }, (_, i) =>
      new Date(2024, 0, 1, i).toISOString()
    )
    expect(inferTimezone(ts)).toBeNull()
  })

  it('infers a negative UTC offset from Pacific-like posting pattern', () => {
    // Generate timestamps with a clear sleep gap at ~3-7am UTC (evening/night in Pacific)
    // and heavy posting at 14:00-04:00 UTC (morning-evening Pacific)
    const ts: string[] = []
    for (let day = 0; day < 60; day++) {
      // Heavy posting hours in UTC (roughly 6am-8pm Pacific = 14:00-04:00 UTC)
      for (const utcHour of [14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3]) {
        ts.push(new Date(Date.UTC(2024, 0, day + 1, utcHour, 30)).toISOString())
      }
    }
    const result = inferTimezone(ts)
    expect(result).not.toBeNull()
    // Should detect a negative offset (western hemisphere)
    expect(result!.offset).toBeLessThan(0)
  })

  it('returns a signal with source "timezone"', () => {
    const ts: string[] = []
    for (let day = 0; day < 30; day++) {
      for (const h of [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]) {
        ts.push(new Date(2024, 0, day + 1, h, 0).toISOString())
      }
    }
    const result = inferTimezone(ts)
    expect(result).not.toBeNull()
    expect(result!.signal.source).toBe('timezone')
  })
})

// ── scanPostsForLocations ──

describe('scanPostsForLocations', () => {
  it('returns empty ranked array for no posts', () => {
    const result = scanPostsForLocations([])
    expect(result.ranked).toEqual([])
    expect(result.signal).toBeNull()
  })

  it('detects city names in posts', () => {
    const posts = ['I love Seattle so much', 'Back in Seattle today', 'Seattle rain again']
    const result = scanPostsForLocations(posts)
    expect(result.ranked[0][0]).toBe('Seattle, US')
    expect(result.ranked[0][1]).toBe(3)
  })

  it('uses word boundaries for short keywords like NYC', () => {
    const posts = ['NYC is great', 'I love NYC']
    const result = scanPostsForLocations(posts)
    expect(result.ranked.some(([loc]) => loc === 'New York, US')).toBe(true)
  })

  it('does not generate signal for single mention', () => {
    const result = scanPostsForLocations(['Visited Tokyo once'])
    expect(result.signal).toBeNull()
  })

  it('ranks by count descending', () => {
    const posts = [
      'Seattle rain', 'Seattle coffee', 'Seattle sunset',
      'Portland visit', 'Portland cool',
    ]
    const result = scanPostsForLocations(posts)
    expect(result.ranked[0][0]).toBe('Seattle, US')
    expect(result.ranked[1][0]).toBe('Portland, US')
  })
})

// ── scanFollowerLocations — normalizeLocation + expandLocation ──

describe('scanFollowerLocations', () => {
  describe('basic detection', () => {
    it('returns zero detected for empty array', () => {
      const result = scanFollowerLocations([])
      expect(result.detected).toBe(0)
      expect(result.total).toBe(0)
    })

    it('detects location from bio pattern', () => {
      const result = scanFollowerLocations([
        follower('alice', '📍 Seattle, WA'),
      ])
      expect(result.detected).toBe(1)
      expect(result.locations.has('Seattle, Washington, United States')).toBe(true)
    })

    it('skips followers with no bio or display name', () => {
      const result = scanFollowerLocations([
        follower('alice', undefined, undefined),
      ])
      expect(result.detected).toBe(0)
    })
  })

  describe('normalizeLocation — prefix stripping', () => {
    it('strips "From" prefix', () => {
      const result = scanFollowerLocations([
        follower('alice', '📍 From Pittsburgh, PA'),
      ])
      expect(result.detected).toBe(1)
      expect(result.locations.has('Pittsburgh, Pennsylvania, United States')).toBe(true)
    })

    it('strips "Near" prefix', () => {
      const result = scanFollowerLocations([
        follower('alice', '📍 Near Boston'),
      ])
      expect(result.detected).toBe(1)
      expect(result.locations.has('Boston, Massachusetts, United States')).toBe(true)
    })

    it('strips "Born in" prefix', () => {
      const result = scanFollowerLocations([
        follower('alice', 'Born in Chicago'),
      ])
      expect(result.detected).toBe(1)
      expect(result.locations.has('Chicago, Illinois, United States')).toBe(true)
    })
  })

  describe('normalizeLocation — City, ST patterns', () => {
    it('expands known city + state abbreviation', () => {
      const result = scanFollowerLocations([
        follower('alice', 'Austin, TX'),
      ])
      expect(result.locations.has('Austin, Texas, United States')).toBe(true)
    })

    it('expands unknown city + valid state to full state name', () => {
      const result = scanFollowerLocations([
        follower('alice', 'Clearwater, FL'),
      ])
      expect(result.detected).toBe(1)
      expect(result.locations.has('Clearwater, Florida, United States')).toBe(true)
    })

    it('expands Canadian province abbreviations', () => {
      const result = scanFollowerLocations([
        follower('alice', 'Kelowna, BC'),
      ])
      expect(result.detected).toBe(1)
      expect(result.locations.has('Kelowna, British Columbia, Canada')).toBe(true)
    })

    it('rejects 4+ word "city" names in City,ST bio pattern', () => {
      // The bio pattern itself caps at 3 words before the comma
      // but the fallback alias scan may still catch state abbreviations in text.
      // This tests that the bio pattern doesn't capture garbage multi-word "cities".
      const signals = parseLocationFromBio('Former Roster Artist Thing, TX')
      expect(signals).toEqual([])
    })

    it('rejects directional prefixes as city names', () => {
      const result = scanFollowerLocations([
        follower('alice', '📍 Western, NY'),
      ])
      // Should not produce "Western, New York, United States"
      const keys = [...result.locations.keys()]
      expect(keys.every(k => !k.includes('Western'))).toBe(true)
    })

    it('normalizes "St " to "St. " for consistency', () => {
      const result = scanFollowerLocations([
        follower('a', 'St Louis, MO'),
        follower('b', 'St. Louis, MO'),
      ])
      expect(result.locations.has('St. Louis, Missouri, United States')).toBe(true)
      // Both should merge into the same location
      expect(result.locations.get('St. Louis, Missouri, United States')?.length).toBe(2)
    })
  })

  describe('normalizeLocation — alias resolution', () => {
    it('resolves city abbreviations (ATL, PDX, etc.)', () => {
      const result = scanFollowerLocations([
        follower('a', 'ATL native'),
        follower('b', 'PDX life'),
      ])
      expect(result.locations.has('Atlanta, Georgia, United States')).toBe(true)
      expect(result.locations.has('Portland, Oregon, United States')).toBe(true)
    })

    it('resolves PNW alias', () => {
      const result = scanFollowerLocations([
        follower('a', 'PNW outdoors lover'),
      ])
      expect(result.locations.has('Pacific Northwest, United States')).toBe(true)
    })

    it('resolves Bay Area to San Francisco', () => {
      const result = scanFollowerLocations([
        follower('a', '📍 Bay Area, CA'),
      ])
      expect(result.locations.has('San Francisco, California, United States')).toBe(true)
    })

    it('resolves DC and DMV', () => {
      const result = scanFollowerLocations([
        follower('a', 'DC politics'),
        follower('b', 'DMV area'),
      ])
      expect(result.locations.has('Washington DC, United States')).toBe(true)
      expect(result.locations.get('Washington DC, United States')?.length).toBe(2)
    })

    it('resolves UK country aliases', () => {
      const result = scanFollowerLocations([
        follower('a', 'England forever'),
        follower('b', 'Scotland native'),
      ])
      expect(result.locations.has('United Kingdom')).toBe(true)
      expect(result.locations.get('United Kingdom')?.length).toBe(2)
    })

    it('resolves BHAM to Birmingham', () => {
      const result = scanFollowerLocations([
        follower('a', 'BHAM local'),
      ])
      expect(result.locations.has('Birmingham, Alabama, United States')).toBe(true)
    })

    it('resolves "Philly" alias', () => {
      const result = scanFollowerLocations([
        follower('a', 'Philly sports fan'),
      ])
      expect(result.locations.has('Philadelphia, Pennsylvania, United States')).toBe(true)
    })
  })

  describe('normalizeLocation — garbage rejection', () => {
    it('rejects non-location bio text', () => {
      const result = scanFollowerLocations([
        follower('a', '📍 Gaymer, Cat Dad'),
        follower('b', '📍 Author, Powerlifter'),
        follower('c', '📍 Minas Gerais - Belo Horizonte 🇧🇷'),
      ])
      // None of these should produce a location
      expect(result.detected).toBe(0)
    })

    it('returns null for unrecognized freetext', () => {
      const result = scanFollowerLocations([
        follower('a', 'Based in the metaverse'),
        follower('b', 'Living my best life'),
      ])
      expect(result.detected).toBe(0)
    })
  })

  describe('expandLocation — full name expansion', () => {
    it('expands US cities to City, State, Country', () => {
      const result = scanFollowerLocations([
        follower('a', '📍 Seattle'),
      ])
      expect(result.locations.has('Seattle, Washington, United States')).toBe(true)
    })

    it('expands ", US" to ", United States"', () => {
      const result = scanFollowerLocations([
        follower('a', 'Buffalo, NY'),
      ])
      const keys = [...result.locations.keys()]
      expect(keys.some(k => k.endsWith('United States'))).toBe(true)
      expect(keys.every(k => !k.endsWith(', US'))).toBe(true)
    })

    it('expands ", UK" to ", United Kingdom"', () => {
      const result = scanFollowerLocations([
        follower('a', 'Based in London'),
      ])
      expect(result.locations.has('London, United Kingdom')).toBe(true)
    })

    it('expands Canadian cities to City, Province, Canada', () => {
      const result = scanFollowerLocations([
        follower('a', 'Toronto, ON'),
      ])
      expect(result.locations.has('Toronto, Ontario, Canada')).toBe(true)
    })
  })

  describe('display name scanning', () => {
    it('detects city in display name', () => {
      const result = scanFollowerLocations([
        follower('a', undefined, 'Seattle Mike'),
      ])
      expect(result.detected).toBe(1)
      expect(result.locations.has('Seattle, Washington, United States')).toBe(true)
    })

    it('prefers specific city from name over broad region from bio', () => {
      const result = scanFollowerLocations([
        follower('a', 'California vibes', 'Los Angeles Dan'),
      ])
      expect(result.locations.has('Los Angeles, California, United States')).toBe(true)
      expect(result.locations.has('California, United States')).toBeFalsy()
    })

    it('keeps specific bio location over less-specific name match', () => {
      const result = scanFollowerLocations([
        follower('a', '📍 Seattle, WA', 'Chicago Bears Fan'),
      ])
      // Bio has specific city, name also has a city — bio wins since it's the primary signal
      expect(result.locations.has('Seattle, Washington, United States')).toBe(true)
    })
  })

  describe('bio keyword and alias fallback', () => {
    it('falls back to city keyword scan when bio patterns fail', () => {
      const result = scanFollowerLocations([
        follower('a', 'Love my life in Seattle with my cats'),
      ])
      expect(result.locations.has('Seattle, Washington, United States')).toBe(true)
    })

    it('checks city keywords before aliases', () => {
      // "Manchester" should match the city keyword → "Manchester, UK"
      // NOT the "england" alias → "United Kingdom"
      const result = scanFollowerLocations([
        follower('a', 'Manchester, England'),
      ])
      expect(result.locations.has('Manchester, United Kingdom')).toBe(true)
    })
  })

  describe('aggregation', () => {
    it('groups multiple followers at the same location', () => {
      const result = scanFollowerLocations([
        follower('a', '📍 Seattle, WA'),
        follower('b', 'Based in Seattle'),
        follower('c', 'SEA native'),
      ])
      expect(result.locations.get('Seattle, Washington, United States')?.length).toBe(3)
    })

    it('ranks locations by count descending', () => {
      const result = scanFollowerLocations([
        follower('a', '📍 Seattle'), follower('b', '📍 Seattle'), follower('c', '📍 Seattle'),
        follower('d', '📍 Portland'), follower('e', '📍 Portland'),
        follower('f', '📍 Chicago'),
      ])
      expect(result.ranked[0][0]).toBe('Seattle, Washington, United States')
      expect(result.ranked[0][1]).toBe(3)
      expect(result.ranked[1][0]).toBe('Portland, Oregon, United States')
      expect(result.ranked[1][1]).toBe(2)
    })

    it('tracks detected count and total correctly', () => {
      const result = scanFollowerLocations([
        follower('a', '📍 Seattle'),
        follower('b', 'No location here'),
        follower('c', '📍 Portland'),
      ])
      expect(result.detected).toBe(2)
      expect(result.total).toBe(3)
    })
  })
})

// ── detectUserCity ──

describe('detectUserCity', () => {
  it('detects city from bio pattern', () => {
    const result = detectUserCity('📍 Seattle, WA', 'Some User')
    expect(result).not.toBeNull()
    expect(result!.canonical).toBe('Seattle, US')
    expect(result!.expanded).toBe('Seattle, Washington, United States')
  })

  it('detects city from display name', () => {
    const result = detectUserCity('', 'Seattle Mike')
    expect(result).not.toBeNull()
    expect(result!.canonical).toBe('Seattle, US')
  })

  it('returns null when no city detected', () => {
    expect(detectUserCity('Cat lover', 'Just Vibes')).toBeNull()
  })

  it('returns null for broad locations (states, countries)', () => {
    expect(detectUserCity('Based in California', '')).toBeNull()
    expect(detectUserCity('UK based', '')).toBeNull()
  })

  it('prefers specific city from display name over broad bio match', () => {
    const result = detectUserCity('California vibes', 'Los Angeles Dan')
    expect(result).not.toBeNull()
    expect(result!.canonical).toBe('Los Angeles, US')
  })

  it('detects city from alias in bio', () => {
    const result = detectUserCity('PDX native', '')
    expect(result).not.toBeNull()
    expect(result!.canonical).toBe('Portland, US')
  })
})

// ── getSearchTermsForLocation ──

describe('getSearchTermsForLocation', () => {
  it('returns city name and aliases for Seattle', () => {
    const terms = getSearchTermsForLocation('Seattle, US')
    expect(terms).toContain('Seattle')
    expect(terms).toContain('sea')
  })

  it('returns city name and aliases for San Francisco', () => {
    const terms = getSearchTermsForLocation('San Francisco, US')
    expect(terms).toContain('San Francisco')
  })

  it('returns city name and aliases for Philadelphia', () => {
    const terms = getSearchTermsForLocation('Philadelphia, US')
    expect(terms).toContain('Philadelphia')
    expect(terms).toContain('philly')
  })

  it('includes short aliases like ATL', () => {
    const terms = getSearchTermsForLocation('Atlanta, US')
    expect(terms).toContain('Atlanta')
    expect(terms).toContain('atl')
  })

  it('returns at least the city name for any location', () => {
    const terms = getSearchTermsForLocation('Tokyo, Japan')
    expect(terms).toContain('Tokyo')
    expect(terms.length).toBeGreaterThanOrEqual(1)
  })
})

// ── profileMatchesLocation ──

describe('profileMatchesLocation', () => {
  it('matches when bio contains the target city', () => {
    expect(profileMatchesLocation('📍 Seattle, WA', 'User', 'Seattle, US')).toBe(true)
  })

  it('matches when display name contains the target city', () => {
    expect(profileMatchesLocation('', 'Seattle Mike', 'Seattle, US')).toBe(true)
  })

  it('does not match a different city', () => {
    expect(profileMatchesLocation('📍 Portland, OR', 'User', 'Seattle, US')).toBe(false)
  })

  it('does not match when no location is detected', () => {
    expect(profileMatchesLocation('Cat lover', 'User', 'Seattle, US')).toBe(false)
  })

  it('matches via alias', () => {
    expect(profileMatchesLocation('SEA native', undefined, 'Seattle, US')).toBe(true)
  })
})

// ── detectUserCity — additional edge cases for nearby search ──

describe('detectUserCity — nearby search edge cases', () => {
  it('detects city from "City, ST" bio pattern', () => {
    const result = detectUserCity('Olympia, WA', '')
    expect(result).not.toBeNull()
    expect(result!.canonical).toBe('Olympia, US')
    expect(result!.expanded).toBe('Olympia, Washington, United States')
  })

  it('rejects PNW as too broad for nearby search', () => {
    // PNW maps to "Pacific Northwest, US" which is in BROAD_LOCATIONS
    expect(detectUserCity('PNW native', '')).toBeNull()
  })

  it('rejects standalone state names', () => {
    expect(detectUserCity('Texas forever', '')).toBeNull()
  })

  it('detects city via keyword fallback in bio text', () => {
    const result = detectUserCity('I write code and drink coffee in Minneapolis', '')
    expect(result).not.toBeNull()
    expect(result!.canonical).toBe('Minneapolis, US')
  })
})

// ── getSearchTermsForLocation — edge cases ──

describe('getSearchTermsForLocation — edge cases', () => {
  it('returns multiple aliases for Pittsburgh', () => {
    const terms = getSearchTermsForLocation('Pittsburgh, US')
    expect(terms).toContain('Pittsburgh')
    expect(terms).toContain('pgh')
    expect(terms).toContain('pit')
  })

  it('returns multiple aliases for Washington DC', () => {
    const terms = getSearchTermsForLocation('Washington DC, US')
    expect(terms).toContain('Washington DC')
    expect(terms).toContain('washington dc')
    expect(terms).toContain('dmv')
  })

  it('returns terms for non-US cities', () => {
    const terms = getSearchTermsForLocation('London, UK')
    expect(terms).toContain('London')
    expect(terms.length).toBeGreaterThanOrEqual(1)
  })
})
