import axios from 'axios'

const IS_PRODUCTION = import.meta.env.PROD || import.meta.env.MODE === 'production'
const STREAMED_API_BASE = 'https://streamed.pk/api'
const SPORTS_API_BASE = IS_PRODUCTION ? '/api/sports' : STREAMED_API_BASE
const STREAMFREE_API_BASE = 'https://streamfree.top/api/v1'
const LIVE_MATCHES_CACHE_TTL = 60_000
export const DEFAULT_SPORTS_CATEGORIES = [
  'soccer',
  'basketball',
  'hockey',
  'combat',
  'baseball',
  'football',
  'racing',
  'tennis',
  'cricket',
] as const

export interface Stream {
  id: string
  streamNo: number
  language: string
  hd: boolean
  embedUrl: string
  source: string
  quality?: string
  thumbnail?: string
  healthScore?: number
}

export interface LiveSportsSource {
  quality: string
  url: string
  live: boolean
}

export interface MatchSource {
  source: string
  id: string
}

export interface Match {
  id: string
  title: string
  homeTeam: string
  awayTeam: string
  league: string
  status: string
  time: string
  score: string
  sport: string
  poster?: string
  date?: number
  sources?: MatchSource[]
  streamKey?: string
  streamSources?: LiveSportsSource[]
  liveSources?: LiveSportsSource[]
}

interface StreamfreeMatch {
  name: string
  category: string
  league?: string
  stream_key: string
  match_timestamp?: number
  sources: LiveSportsSource[]
  thumbnail_url?: string
}

const liveMatchesCache = new Map<string, { expiresAt: number; matches: Match[]; pending?: Promise<Match[]> }>()

function isLiveSportsSource(value: unknown): value is LiveSportsSource {
  if (!value || typeof value !== 'object') return false

  const source = value as Record<string, unknown>
  if (
    typeof source.quality !== 'string' ||
    typeof source.url !== 'string' ||
    typeof source.live !== 'boolean'
  ) return false

  try {
    const url = new URL(source.url)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

function normalizeStreamfreeMatch(value: unknown): Match | null {
  if (!value || typeof value !== 'object') return null
  const match = value as Partial<StreamfreeMatch>

  if (typeof match.name !== 'string' || typeof match.category !== 'string' ||
      typeof match.stream_key !== 'string' || !Array.isArray(match.sources)) {
    return null
  }

  const streamSources = match.sources.filter(isLiveSportsSource)
  const liveSources = streamSources.filter((source) => source.live)

  const [homeTeam, awayTeam] = match.name.split(/\s+vs\.?\s+/i)
  const timestamp = typeof match.match_timestamp === 'number' ? match.match_timestamp * 1000 : undefined

  return {
    id: match.stream_key,
    title: match.name,
    homeTeam: homeTeam || match.name,
    awayTeam: awayTeam || '',
    league: match.league || match.category.toUpperCase(),
    status: 'LIVE',
    time: timestamp ? getMatchTime(timestamp, timestamp > Date.now()) : 'Live',
    score: liveSources.length > 0 ? 'LIVE' : 'vs',
    sport: match.category,
    poster: match.thumbnail_url || getFallbackSportImage(match.category),
    date: timestamp,
    streamKey: match.stream_key,
    streamSources,
    liveSources,
  }
}

function getMatchTime(date?: number, showDate = false): string {
  if (!date) return 'Live'

  const matchDate = new Date(date)
  if (Number.isNaN(matchDate.getTime())) return 'Live'

  return new Intl.DateTimeFormat(undefined, {
    ...(showDate ? { month: 'short', day: 'numeric' } : {}),
    hour: '2-digit',
    minute: '2-digit',
  }).format(matchDate)
}

function getSportsApiPath(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return normalizedPath.startsWith('/api/')
    ? normalizedPath.slice('/api'.length)
    : normalizedPath
}

export function normalizeSportsPosterUrl(poster?: string): string | undefined {
  if (!poster) return undefined
  if (/^https?:\/\//i.test(poster)) return poster
  if (poster.startsWith('//')) return `https:${poster}`

  const apiPath = getSportsApiPath(poster)
  return `${SPORTS_API_BASE}${apiPath}`
}

// Generate fallback sports image based on sport category
const LOCAL_FALLBACK_IMAGE = '/sports-fallback.jpg'

function getFallbackSportImage(sport: string): string {
  const sportImages: Record<string, string> = {
    football: LOCAL_FALLBACK_IMAGE,
    basketball: LOCAL_FALLBACK_IMAGE,
    rugby: LOCAL_FALLBACK_IMAGE,
    tennis: LOCAL_FALLBACK_IMAGE,
    cricket: LOCAL_FALLBACK_IMAGE,
    afl: LOCAL_FALLBACK_IMAGE,
    ufc: LOCAL_FALLBACK_IMAGE,
    motorsports: LOCAL_FALLBACK_IMAGE,
  }

  return sportImages[sport.toLowerCase()] || LOCAL_FALLBACK_IMAGE
}

export const sportsApi = {
  async getCategories(): Promise<string[]> {
    const response = await axios.get(`${STREAMFREE_API_BASE}/categories`, { timeout: 10000 })
    const data: unknown = response.data

    if (!data || typeof data !== 'object' || !Array.isArray((data as { categories?: unknown }).categories)) {
      throw new Error('The live sports API returned an invalid category list.')
    }

    const categories = (data as { categories: unknown[] }).categories
      .filter((category): category is string => typeof category === 'string' && category.length > 0)
    return categories.length > 0 ? categories : [...DEFAULT_SPORTS_CATEGORIES]
  },

  async getStreamfreeMatches(category?: string): Promise<Match[]> {
    const cacheKey = category || 'all'
    let cachedMatches = liveMatchesCache.get(cacheKey)
    if (cachedMatches && cachedMatches.expiresAt > Date.now()) {
      if (cachedMatches.pending) return cachedMatches.pending
      return cachedMatches.matches
    }

    const pending = (async () => {
      try {
        const response = await axios.get(`${STREAMFREE_API_BASE}/streams`, {
          params: category ? { category } : undefined,
          timeout: 10000,
        })

        const data: unknown = response.data
        if (!data || typeof data !== 'object' || !Array.isArray((data as { streams?: unknown }).streams)) {
          throw new Error('The live sports API returned an invalid stream list.')
        }

        const matches = (data as { streams: unknown[] }).streams
          .map(normalizeStreamfreeMatch)
          .filter((match): match is Match => match !== null)
        liveMatchesCache.set(cacheKey, { matches, expiresAt: Date.now() + LIVE_MATCHES_CACHE_TTL })
        return matches
      } catch (error) {
        liveMatchesCache.delete(cacheKey)
        console.error('Error fetching Streamfree sports matches:', error)
        throw error
      }
    })()

    liveMatchesCache.set(cacheKey, {
      matches: cachedMatches?.matches || [],
      expiresAt: Date.now() + LIVE_MATCHES_CACHE_TTL,
      pending,
    })
    return pending
  },

  async getLiveMatches(category?: string): Promise<Match[]> {
    const matches = await this.getStreamfreeMatches(category)
    return matches.filter((match) => (match.liveSources?.length || 0) > 0)
  },

  async getSources(streamKey: string): Promise<LiveSportsSource[]> {
    const response = await axios.get(
      `${STREAMFREE_API_BASE}/sources/${encodeURIComponent(streamKey)}`,
      { timeout: 10000 },
    )
    const data: unknown = response.data

    if (
      !data ||
      typeof data !== 'object' ||
      !Array.isArray((data as { sources?: unknown }).sources)
    ) {
      throw new Error('The live sports API returned an invalid source list.')
    }

    const sources = (data as { sources: unknown[] }).sources
    const validSources = sources.filter(isLiveSportsSource)
    if (validSources.length !== sources.length) {
      throw new Error('The live sports API returned an invalid source list.')
    }

    return validSources
  },

  async getLiveSources(streamKey: string): Promise<LiveSportsSource[]> {
    const sources = await this.getSources(streamKey)
    return sources.filter((source) => source.live)
  },

  async getUpcomingMatches(): Promise<Match[]> {
    const matches = await this.getStreamfreeMatches()
    const now = Date.now()
    return matches
      .filter((match) => match.date && match.date > now && (match.liveSources?.length || 0) === 0)
      .sort((a, b) => (a.date || 0) - (b.date || 0))
  },

  async getStreams(source: string, id: string): Promise<Stream[]> {
    try {
      if (!IS_PRODUCTION) {
        console.log('Fetching streams from:', `${SPORTS_API_BASE}/stream/${source}/${id}`)
      }
      const response = await axios.get(`${SPORTS_API_BASE}/stream/${source}/${id}`, {
        timeout: 10000,
      })
      if (!IS_PRODUCTION) {
        console.log('Streams response:', response.data)
      }
      return response.data
    } catch (error) {
      console.error('Error fetching streams:', error)
      if (axios.isAxiosError(error)) {
        console.error('Axios error details:', {
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data,
        })
      }
      // Return mock data as fallback
      return this.getMockStreams()
    }
  },

  getStreamUrl(source: string, id: string): string {
    return `${SPORTS_API_BASE}/stream/${source}/${id}`
  },

  // Available sources
  sources: ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'intel'] as const,

  // Mock data fallback
  getMockMatches(): Match[] {
    return [
      {
        id: '1',
        title: 'Manchester United vs Liverpool',
        homeTeam: 'Manchester United',
        awayTeam: 'Liverpool',
        league: 'Premier League',
        status: 'LIVE',
        time: '67\'',
        score: '2 - 1',
        sport: 'football',
        poster: getFallbackSportImage('football'),
        sources: [{ source: 'alpha', id: 'match1' }],
      },
      {
        id: '2',
        title: 'Real Madrid vs Barcelona',
        homeTeam: 'Real Madrid',
        awayTeam: 'Barcelona',
        league: 'La Liga',
        status: 'LIVE',
        time: '34\'',
        score: '1 - 0',
        sport: 'football',
        poster: getFallbackSportImage('football'),
        sources: [{ source: 'bravo', id: 'match2' }],
      },
      {
        id: '3',
        title: 'Lakers vs Warriors',
        homeTeam: 'Lakers',
        awayTeam: 'Warriors',
        league: 'NBA',
        status: 'LIVE',
        time: 'Q3',
        score: '98 - 95',
        sport: 'basketball',
        poster: getFallbackSportImage('basketball'),
        sources: [{ source: 'charlie', id: 'match3' }],
      },
    ]
  },

  getMockStreams(): Stream[] {
    return [
      {
        id: 'stream1',
        streamNo: 1,
        language: 'English',
        hd: true,
        embedUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
        source: 'alpha',
        thumbnail: LOCAL_FALLBACK_IMAGE,
      },
      {
        id: 'stream2',
        streamNo: 2,
        language: 'Spanish',
        hd: true,
        embedUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
        source: 'alpha',
        thumbnail: LOCAL_FALLBACK_IMAGE,
      },
    ]
  },

  getFallbackSportImage,
}

// Backwards-compatible named exports for tests and callers that import * as sportsApi
export const getLiveMatches = (...args: Parameters<typeof sportsApi.getLiveMatches>) => sportsApi.getLiveMatches(...args)
export const getUpcomingMatches = (...args: Parameters<typeof sportsApi.getUpcomingMatches>) => sportsApi.getUpcomingMatches(...args)
export const getCategories = (...args: Parameters<typeof sportsApi.getCategories>) => sportsApi.getCategories(...args)
export const getStreams = (...args: Parameters<typeof sportsApi.getStreams>) => sportsApi.getStreams(...args)
export const getLiveSources = (...args: Parameters<typeof sportsApi.getLiveSources>) => sportsApi.getLiveSources(...args)
export const getSources = (...args: Parameters<typeof sportsApi.getSources>) => sportsApi.getSources(...args)
export const getStreamfreeMatches = (...args: Parameters<typeof sportsApi.getStreamfreeMatches>) => sportsApi.getStreamfreeMatches(...args)
export const getStreamUrl = (source: string, id: string) => sportsApi.getStreamUrl(source, id)
export const sources = sportsApi.sources
export const getMockMatches = () => sportsApi.getMockMatches()
export const getMockStreams = () => sportsApi.getMockStreams()
export const fallbackSportImage = sportsApi.getFallbackSportImage
