import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusBadge } from '../src/components/StatusBadge'

describe('StatusBadge', () => {
  it('renders a human label for each status', () => {
    const { rerender } = render(<StatusBadge status="verified" />)
    expect(screen.getByText('Verified')).toBeInTheDocument()

    rerender(<StatusBadge status="needs_review" />)
    expect(screen.getByText('Needs review')).toBeInTheDocument()

    rerender(<StatusBadge status="manual_override" />)
    expect(screen.getByText('Manual override')).toBeInTheDocument()
  })
})
