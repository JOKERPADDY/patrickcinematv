import { afterEach, describe, expect, it, vi } from 'vitest'
import axios from 'axios'

describe('sports API poster URLs', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('routes streamed poster paths through the Cloudflare sports proxy in production', async () => {
    vi.resetModules()
    vi.stubEnv('MODE', 'production')

    const { normalizeSportsPosterUrl } = await import('./sports')

    expect(normalizeSportsPosterUrl('/api/images/proxy/card.webp')).toBe('/api/sports/images/proxy/card.webp')
    expect(normalizeSportsPosterUrl('/images/proxy/card.webp')).toBe('/api/sports/images/proxy/card.webp')
  })

  it('uses the upstream streamed API host outside production', async () => {
    vi.resetModules()
    vi.stubEnv('MODE', 'test')

    const { normalizeSportsPosterUrl } = await import('./sports')

    expect(normalizeSportsPosterUrl('/api/images/proxy/card.webp')).toBe('https://streamed.pk/api/images/proxy/card.webp')
  })

  it('keeps absolute poster URLs unchanged', async () => {
    vi.resetModules()

    const { normalizeSportsPosterUrl } = await import('./sports')

    expect(normalizeSportsPosterUrl('https://example.com/card.jpg')).toBe('https://example.com/card.jpg')
    expect(normalizeSportsPosterUrl('//example.com/card.jpg')).toBe('https://example.com/card.jpg')
  })

  it('uses a JPG fallback for matches without upstream posters', async () => {
    vi.resetModules()

    const { fallbackSportImage } = await import('./sports')

    expect(fallbackSportImage('football')).toBe('/sports-fallback.jpg')
    expect(fallbackSportImage('unknown')).toBe('/sports-fallback.jpg')
  })

  it('loads categories from the live sports API', async () => {
    vi.resetModules()
    const axiosGet = vi.spyOn(axios, 'get').mockResolvedValue({
      data: { categories: ['soccer', 'basketball'] },
    } as never)

    const { sportsApi } = await import('./sports')
    await expect(sportsApi.getCategories()).resolves.toEqual(['soccer', 'basketball'])
    expect(axiosGet).toHaveBeenCalledWith('https://streamfree.top/api/v1/categories', { timeout: 10000 })
  })

  it('loads live events from the Streamfree API and keeps only currently live sources', async () => {
    vi.resetModules()
    const axiosGet = vi.spyOn(axios, 'get').mockResolvedValue({
      data: {
        count: 2,
        streams: [
          {
            name: 'Ghana vs England',
            category: 'soccer',
            league: 'FIFA World Cup',
            stream_key: 'ghana-vs-england',
            match_timestamp: 1782244800,
            sources: [
              { quality: 'FHD', url: 'https://strmfree.st/embed/soccer/ghana-vs-england1080p', live: true },
              { quality: 'SD', url: 'https://strmfree.st/embed/soccer/ghana-vs-england540p', live: false },
            ],
            thumbnail_url: 'https://streamfree.top/thumbnails/soccer_ghana-vs-england',
          },
          {
            name: 'Not live yet',
            category: 'soccer',
            stream_key: 'not-live-yet',
            match_timestamp: Math.floor((Date.now() + 60 * 60 * 1000) / 1000),
            sources: [
              { quality: 'FHD', url: 'https://strmfree.st/embed/soccer/not-live-yet1080p', live: false },
              { quality: 'SD', url: 'https://strmfree.st/embed/soccer/not-live-yet540p', live: false },
            ],
          },
        ],
      },
    } as never)

    const { sportsApi } = await import('./sports')
    const matches = await sportsApi.getLiveMatches('soccer')

    expect(axiosGet).toHaveBeenCalledWith('https://streamfree.top/api/v1/streams', {
      params: { category: 'soccer' },
      timeout: 10000,
    })
    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({
      title: 'Ghana vs England',
      sport: 'soccer',
      streamKey: 'ghana-vs-england',
      liveSources: [{ quality: 'FHD', url: 'https://strmfree.st/embed/soccer/ghana-vs-england1080p', live: true }],
    })
  })

  it('caches live stream lists briefly to avoid repeat API requests', async () => {
    vi.resetModules()
    const axiosGet = vi.spyOn(axios, 'get').mockResolvedValue({
      data: { streams: [] },
    } as never)

    const { sportsApi } = await import('./sports')
    await sportsApi.getLiveMatches()
    await sportsApi.getLiveMatches()

    expect(axiosGet).toHaveBeenCalledTimes(1)
  })

  it('uses future timestamps and available sources for upcoming events', async () => {
    vi.resetModules()
    const axiosGet = vi.spyOn(axios, 'get').mockResolvedValue({
      data: {
        streams: [
          {
            name: 'Ghana vs England',
            category: 'soccer',
            stream_key: 'ghana-vs-england',
            match_timestamp: Math.floor((Date.now() + 60 * 60 * 1000) / 1000),
            sources: [
              { quality: 'FHD', url: 'https://strmfree.st/embed/soccer/ghana-vs-england1080p', live: false },
              { quality: 'SD', url: 'https://strmfree.st/embed/soccer/ghana-vs-england540p', live: false },
            ],
          },
          {
            name: 'Already live',
            category: 'soccer',
            stream_key: 'already-live',
            match_timestamp: Math.floor((Date.now() - 60 * 60 * 1000) / 1000),
            sources: [{ quality: 'FHD', url: 'https://strmfree.st/embed/soccer/already-live1080p', live: true }],
          },
          {
            name: 'Future but live',
            category: 'soccer',
            stream_key: 'future-but-live',
            match_timestamp: Math.floor((Date.now() + 60 * 60 * 1000) / 1000),
            sources: [{ quality: 'FHD', url: 'https://strmfree.st/embed/soccer/future-but-live1080p', live: true }],
          },
          {
            name: 'Scheduled without sources',
            category: 'soccer',
            stream_key: 'scheduled-without-sources',
            match_timestamp: Math.floor((Date.now() + 2 * 60 * 60 * 1000) / 1000),
            sources: [],
          },
        ],
      },
    } as never)

    const { sportsApi } = await import('./sports')
    const upcoming = await sportsApi.getUpcomingMatches()

    expect(axiosGet).toHaveBeenCalledTimes(1)
    expect(upcoming).toHaveLength(2)
    expect(upcoming[0]).toMatchObject({
      title: 'Ghana vs England',
      streamKey: 'ghana-vs-england',
      streamSources: [
        { quality: 'FHD', url: 'https://strmfree.st/embed/soccer/ghana-vs-england1080p', live: false },
        { quality: 'SD', url: 'https://strmfree.st/embed/soccer/ghana-vs-england540p', live: false },
      ],
    })
    expect(upcoming[1]).toMatchObject({
      title: 'Scheduled without sources',
      streamKey: 'scheduled-without-sources',
      streamSources: [],
      liveSources: [],
    })
  })

  it('fetches a stream key source list from the dedicated endpoint', async () => {
    vi.resetModules()
    const axiosGet = vi.spyOn(axios, 'get').mockResolvedValue({
      data: {
        stream_key: 'ghana-vs-england',
        sources: [
          { quality: 'SD', url: 'https://strmfree.st/embed/soccer/ghana-vs-england540p', live: false },
          { quality: 'FHD', url: 'https://strmfree.st/embed/soccer/ghana-vs-england1080p', live: true },
        ],
      },
    } as never)

    const { sportsApi } = await import('./sports')
    const sources = await sportsApi.getLiveSources('ghana-vs-england')

    expect(axiosGet).toHaveBeenCalledWith(
      'https://streamfree.top/api/v1/sources/ghana-vs-england',
      { timeout: 10000 },
    )
    expect(sources).toEqual([
      { quality: 'FHD', url: 'https://strmfree.st/embed/soccer/ghana-vs-england1080p', live: true },
    ])
  })

  it('returns all variants for an upcoming stream', async () => {
    vi.resetModules()
    vi.spyOn(axios, 'get').mockResolvedValue({
      data: {
        stream_key: 'ghana-vs-england',
        sources: [
          { quality: 'FHD', url: 'https://strmfree.st/embed/soccer/ghana-vs-england1080p', live: false },
          { quality: 'SD', url: 'https://strmfree.st/embed/soccer/ghana-vs-england540p', live: false },
        ],
      },
    } as never)

    const { sportsApi } = await import('./sports')
    const sources = await sportsApi.getSources('ghana-vs-england')

    expect(sources).toHaveLength(2)
    expect(sources[0].quality).toBe('FHD')
  })
})
