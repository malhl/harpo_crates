// No explicit import from 'vitest' — we rely on globals: true in vitest.config.ts
// This avoids the vi.mock hoisting issue where vi.fn() inside the factory
// tries to reference an import that hasn't been initialized yet.

/* global vi, describe, it, expect, beforeEach */

const mockAgent = {
  getProfile: vi.fn(),
  getFollowers: vi.fn(),
  getFollows: vi.fn(),
  getProfiles: vi.fn(),
}

vi.mock('@atproto/api', () => ({
  Agent: class MockAgent {
    getProfile = mockAgent.getProfile
    getFollowers = mockAgent.getFollowers
    getFollows = mockAgent.getFollows
    getProfiles = mockAgent.getProfiles
  },
}))

// Dynamic import to ensure mock is in place before the module loads
const { getProfile, getAllFollowers, getAllFollowing, enrichProfiles } = await import('./bluesky')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getProfile', () => {
  it('fetches and returns profile data', async () => {
    const profileData = { did: 'did:plc:test', handle: 'test.bsky.social', displayName: 'Test' }
    mockAgent.getProfile.mockResolvedValue({ data: profileData })

    const result = await getProfile('test.bsky.social')
    expect(result).toEqual(profileData)
    expect(mockAgent.getProfile).toHaveBeenCalledWith({ actor: 'test.bsky.social' })
  })

  it('propagates API errors', async () => {
    mockAgent.getProfile.mockRejectedValue(new Error('Profile not found'))
    await expect(getProfile('nonexistent.bsky.social')).rejects.toThrow('Profile not found')
  })
})

describe('getAllFollowers', () => {
  it('fetches all followers across multiple pages', async () => {
    const onProgress = vi.fn()

    mockAgent.getFollowers
      .mockResolvedValueOnce({
        data: {
          followers: [
            { did: 'did:1', handle: 'one.bsky.social' },
            { did: 'did:2', handle: 'two.bsky.social' },
          ],
          subject: { followersCount: 3 },
          cursor: 'page2',
        },
      })
      .mockResolvedValueOnce({
        data: {
          followers: [{ did: 'did:3', handle: 'three.bsky.social' }],
          subject: { followersCount: 3 },
          cursor: undefined,
        },
      })

    const result = await getAllFollowers('test.bsky.social', onProgress)

    expect(result).toHaveLength(3)
    expect(result[0].did).toBe('did:1')
    expect(result[2].did).toBe('did:3')
    expect(onProgress).toHaveBeenCalledTimes(2)
    expect(onProgress).toHaveBeenCalledWith(2, 3)
    expect(onProgress).toHaveBeenCalledWith(3, 3)
  })

  it('handles a single page of results', async () => {
    const onProgress = vi.fn()

    mockAgent.getFollowers.mockResolvedValueOnce({
      data: {
        followers: [{ did: 'did:1', handle: 'one.bsky.social' }],
        subject: { followersCount: 1 },
        cursor: undefined,
      },
    })

    const result = await getAllFollowers('test.bsky.social', onProgress)
    expect(result).toHaveLength(1)
    expect(mockAgent.getFollowers).toHaveBeenCalledTimes(1)
  })

  it('handles empty follower list', async () => {
    const onProgress = vi.fn()

    mockAgent.getFollowers.mockResolvedValueOnce({
      data: {
        followers: [],
        subject: { followersCount: 0 },
        cursor: undefined,
      },
    })

    const result = await getAllFollowers('test.bsky.social', onProgress)
    expect(result).toHaveLength(0)
  })
})

describe('getAllFollowing', () => {
  it('fetches all following across pages', async () => {
    const onProgress = vi.fn()

    mockAgent.getFollows
      .mockResolvedValueOnce({
        data: {
          follows: [{ did: 'did:f1', handle: 'f1.bsky.social' }],
          subject: { followsCount: 2 },
          cursor: 'page2',
        },
      })
      .mockResolvedValueOnce({
        data: {
          follows: [{ did: 'did:f2', handle: 'f2.bsky.social' }],
          subject: { followsCount: 2 },
          cursor: undefined,
        },
      })

    const result = await getAllFollowing('test.bsky.social', onProgress)
    expect(result).toHaveLength(2)
    expect(onProgress).toHaveBeenCalledWith(2, 2)
  })
})

describe('enrichProfiles', () => {
  it('batches requests in groups of 25', async () => {
    const onProgress = vi.fn()
    const dids = Array.from({ length: 30 }, (_, i) => `did:plc:${i}`)

    mockAgent.getProfiles
      .mockResolvedValueOnce({
        data: {
          profiles: dids.slice(0, 25).map(did => ({ did, handle: `h${did}` })),
        },
      })
      .mockResolvedValueOnce({
        data: {
          profiles: dids.slice(25).map(did => ({ did, handle: `h${did}` })),
        },
      })

    const result = await enrichProfiles(dids, onProgress)

    expect(result.size).toBe(30)
    expect(mockAgent.getProfiles).toHaveBeenCalledTimes(2)
    expect(mockAgent.getProfiles.mock.calls[0][0].actors).toHaveLength(25)
    expect(mockAgent.getProfiles.mock.calls[1][0].actors).toHaveLength(5)
    expect(onProgress).toHaveBeenCalledWith(25, 30)
    expect(onProgress).toHaveBeenCalledWith(30, 30)
  })

  it('handles empty DID list', async () => {
    const onProgress = vi.fn()
    const result = await enrichProfiles([], onProgress)
    expect(result.size).toBe(0)
    expect(mockAgent.getProfiles).not.toHaveBeenCalled()
  })

  it('handles exactly 25 DIDs in one batch', async () => {
    const onProgress = vi.fn()
    const dids = Array.from({ length: 25 }, (_, i) => `did:plc:${i}`)

    mockAgent.getProfiles.mockResolvedValueOnce({
      data: { profiles: dids.map(did => ({ did, handle: `h${did}` })) },
    })

    const result = await enrichProfiles(dids, onProgress)
    expect(result.size).toBe(25)
    expect(mockAgent.getProfiles).toHaveBeenCalledTimes(1)
  })
})
