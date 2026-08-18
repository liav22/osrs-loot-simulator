import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusBadge } from '../src/components/StatusBadge'

describe('StatusBadge', () => {
  it('renders each status tier label', () => {
    const { rerender } = render(<StatusBadge status="verified" statusTier="verified" />)
    expect(screen.getByText('Verified')).toBeInTheDocument()

    rerender(<StatusBadge status="needs_review" statusTier="minor_gaps" />)
    expect(screen.getByText('Minor gaps')).toBeInTheDocument()

    rerender(<StatusBadge status="needs_review" statusTier="approximate" />)
    expect(screen.getByText('Approximate')).toBeInTheDocument()

    rerender(<StatusBadge status="needs_review" statusTier="unknown_scaling" />)
    expect(screen.getByText('Unknown scaling')).toBeInTheDocument()

    rerender(<StatusBadge status="manual_override" statusTier={null} />)
    expect(screen.getByText('Manual override')).toBeInTheDocument()
  })

  it('shows manual_override even if a tier were somehow present, since it is a separate terminal state', () => {
    render(<StatusBadge status="manual_override" statusTier="approximate" />)
    expect(screen.getByText('Manual override')).toBeInTheDocument()
  })

  it('falls back to the generic "Needs review" label when no tier is wired up', () => {
    render(<StatusBadge status="needs_review" />)
    expect(screen.getByText('Needs review')).toBeInTheDocument()
  })

  it('falls back to the generic label for a needs_review document with no tier yet (pre-migration data)', () => {
    render(<StatusBadge status="needs_review" statusTier={null} />)
    expect(screen.getByText('Needs review')).toBeInTheDocument()
  })
})
