import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SportsPlayer from './SportsPlayer'
import { sportsApi } from '../api/sports'

vi.mock('../api/sports', async () => {
  const actual = await vi.importActual<typeof import('../api/sports')>('../api/sports')
  return {
    ...actual,
    sportsApi: {
      ...actual.sportsApi,
      getStreams: vi.fn(),
      getSources: vi.fn(),
      getLiveSources: vi.fn(),
    },
  }
})

const mockToast = {
  error: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}

vi.mock('../hooks/useToast', () => ({
  useToast: () => mockToast,
}))

const mockedGetStreams = vi.mocked(sportsApi.getStreams)
const mockedGetSources = vi.mocked(sportsApi.getSources)
const mockedGetLiveSources = vi.mocked(sportsApi.getLiveSources)

describe('SportsPlayer', () => {
  beforeEach(() => {
    mockedGetStreams.mockReset()
    mockedGetSources.mockReset()
    mockedGetLiveSources.mockReset()
    Object.values(mockToast).forEach((fn) => fn.mockReset())
  })

  it('renders a safe fallback when navigation leaves no streams selected', async () => {
    mockedGetStreams.mockImplementation(async (_source, streamId) => streamId === '123'
      ? [
        {
          id: 'stream-1',
          streamNo: 1,
          language: 'English',
          hd: true,
          embedUrl: 'https://example.com/1',
          source: 'alpha',
        },
        {
          id: 'stream-2',
          streamNo: 2,
          language: 'Spanish',
          hd: true,
          embedUrl: 'https://example.com/2',
          source: 'alpha',
        },
      ]
      : [])

    const router = createMemoryRouter(
      [{ path: '/sports/:source/:id', element: <SportsPlayer /> }],
      { initialEntries: ['/sports/alpha/123'] }
    )

    render(<RouterProvider router={router} />)

    expect(await screen.findByText(/Stream 1 of 2/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Spanish HD/i }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Spanish HD/i })).toHaveClass('bg-primary')
    })

    await act(async () => {
      await router.navigate('/sports/beta/456')
    })

    await waitFor(() => {
      expect(screen.getByText(/No streams available/i)).toBeInTheDocument()
    })
  })

  it('embeds a live source without sandboxing and offers its quality variant', async () => {
    mockedGetSources.mockResolvedValue([
      {
        quality: 'FHD',
        url: 'https://strmfree.st/embed/soccer/ghana-vs-england1080p',
        live: true,
      },
      {
        quality: 'SD',
        url: 'https://strmfree.st/embed/soccer/ghana-vs-england540p',
        live: false,
      },
    ])

    const router = createMemoryRouter(
      [{ path: '/sports/:source/:id', element: <SportsPlayer /> }],
      { initialEntries: ['/sports/live/ghana-vs-england'] },
    )

    const { container } = render(<RouterProvider router={router} />)

    expect(await screen.findByText('1 live quality')).toBeInTheDocument()
    await waitFor(() => {
      expect(container.querySelector('iframe')).toHaveAttribute(
        'src',
        'https://strmfree.st/embed/soccer/ghana-vs-england1080p',
      )
    })
    const playerIframe = container.querySelector('iframe')
    expect(playerIframe).not.toHaveAttribute('sandbox')
    expect(playerIframe).toHaveAttribute('allowfullscreen')
    expect(playerIframe).toHaveAttribute('allow', expect.stringContaining('picture-in-picture'))
    expect(screen.getAllByText('FHD').length).toBeGreaterThan(0)
    expect(mockedGetSources).toHaveBeenCalledWith('ghana-vs-england')
    expect(mockedGetLiveSources).not.toHaveBeenCalled()
  })

  it('loads all configured variants for an upcoming event', async () => {
    mockedGetSources.mockResolvedValue([
      {
        quality: 'FHD',
        url: 'https://strmfree.st/embed/soccer/ghana-vs-england1080p',
        live: false,
      },
      {
        quality: 'SD',
        url: 'https://strmfree.st/embed/soccer/ghana-vs-england540p',
        live: false,
      },
    ])

    const router = createMemoryRouter(
      [{ path: '/sports/:source/:id', element: <SportsPlayer /> }],
      { initialEntries: ['/sports/upcoming/ghana-vs-england'] },
    )

    render(<RouterProvider router={router} />)

    expect(await screen.findByText('2 quality options')).toBeInTheDocument()
    expect(mockedGetSources).toHaveBeenCalledWith('ghana-vs-england')
    expect(mockedGetLiveSources).not.toHaveBeenCalled()
    expect((await screen.findAllByText('SD')).length).toBeGreaterThan(1)
  })
})
