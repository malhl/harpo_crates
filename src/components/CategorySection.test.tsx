import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CategorySection } from './CategorySection'
import { FOLLOWER_CATEGORIES } from '../types'
import { makeFollower } from '../test/fixtures'

const lurkerCategory = FOLLOWER_CATEGORIES[0]

const followers = [
  makeFollower({ did: 'a', handle: 'lurker1.bsky.social', displayName: 'Lurker One', postsCount: 5 }),
  makeFollower({ did: 'b', handle: 'lurker2.bsky.social', displayName: 'Lurker Two', postsCount: 50 }),
  makeFollower({ did: 'c', handle: 'active.bsky.social', displayName: 'Active User', postsCount: 500 }),
  makeFollower({ did: 'd', handle: 'lurker3.bsky.social', displayName: 'Lurker Three', postsCount: 0 }),
]

describe('CategorySection', () => {
  it('renders the category button with count', () => {
    render(<CategorySection category={lurkerCategory} followers={followers} />)
    expect(screen.getByText('Lurkers')).toBeInTheDocument()
    expect(screen.getByText('(3)')).toBeInTheDocument()
  })

  it('does not show follower list when collapsed', () => {
    render(<CategorySection category={lurkerCategory} followers={followers} />)
    expect(screen.queryByText('Lurker One')).not.toBeInTheDocument()
  })

  it('shows matching followers when expanded', async () => {
    const user = userEvent.setup()
    render(<CategorySection category={lurkerCategory} followers={followers} />)

    await user.click(screen.getByText('Lurkers'))

    expect(screen.getByText('Lurker One')).toBeInTheDocument()
    expect(screen.getByText('Lurker Two')).toBeInTheDocument()
    expect(screen.getByText('Lurker Three')).toBeInTheDocument()
    expect(screen.queryByText('Active User')).not.toBeInTheDocument()
  })

  it('sorts lurkers by posts ascending (fewest first)', async () => {
    const user = userEvent.setup()
    render(<CategorySection category={lurkerCategory} followers={followers} />)

    await user.click(screen.getByText('Lurkers'))

    const names = screen.getAllByText(/Lurker (One|Two|Three)/).map(el => el.textContent)
    expect(names).toEqual(['Lurker Three', 'Lurker One', 'Lurker Two'])
  })

  it('collapses when clicked again', async () => {
    const user = userEvent.setup()
    render(<CategorySection category={lurkerCategory} followers={followers} />)

    await user.click(screen.getByText('Lurkers'))
    expect(screen.getByText('Lurker One')).toBeInTheDocument()

    await user.click(screen.getByText('Lurkers'))
    expect(screen.queryByText('Lurker One')).not.toBeInTheDocument()
  })

  it('shows empty message when no followers match', async () => {
    const user = userEvent.setup()
    const noLurkers = [makeFollower({ postsCount: 500 })]
    render(<CategorySection category={lurkerCategory} followers={noLurkers} />)

    await user.click(screen.getByText('Lurkers'))
    expect(screen.getByText('No followers match this category.')).toBeInTheDocument()
  })

  it('respects the limit and shows truncation message', async () => {
    const user = userEvent.setup()
    const limitedCategory = { ...lurkerCategory, limit: 2 }
    render(<CategorySection category={limitedCategory} followers={followers} />)

    await user.click(screen.getByText('Lurkers'))
    expect(screen.getByText('Showing 2 of 3 matches')).toBeInTheDocument()
  })
})
