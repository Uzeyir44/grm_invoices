import { afterEach, describe, expect, it } from 'vitest'
import {
  ACCESS_TOKEN_KEY,
  clearAccessToken,
  getAccessToken,
  setAccessToken,
} from './authStorage'

afterEach(() => {
  localStorage.clear()
})

describe('authStorage', () => {
  it('stores and reads an access token', () => {
    setAccessToken('access-token-123')
    expect(getAccessToken()).toBe('access-token-123')
  })

  it('clears the stored access token', () => {
    setAccessToken('access-token-123')
    clearAccessToken()
    expect(getAccessToken()).toBeNull()
  })

  it('uses a namespaced, application-specific storage key', () => {
    setAccessToken('access-token-123')
    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBe('access-token-123')
  })

  it('returns null when nothing is stored', () => {
    expect(getAccessToken()).toBeNull()
  })
})