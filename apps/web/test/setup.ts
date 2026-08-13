import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// Explicit, not relying on @testing-library/react's global-afterEach magic —
// this project doesn't enable vitest's `globals: true` (every other test
// file imports describe/it/expect explicitly), so that auto-registration
// has nothing to hook into and renders leak across tests in the same file.
afterEach(() => cleanup())
