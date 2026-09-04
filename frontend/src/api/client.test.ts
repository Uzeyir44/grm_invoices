import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiClient, onUnauthorized } from './client'
import { ApiError, HTTP_STATUS } from '../types/api'
import {
  clearAuthTokens,
  getAccessToken,
  getRefreshToken,
  setAccessToken,
  setRefreshToken,
} from '../utils/authStorage'

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

describe('apiClient', () => {
  const fetchMock = vi.fn()

  afterEach(() => {
    localStorage.clear()
    clearAuthTokens()
    vi.unstubAllGlobals()
  })

  function stubFetch(response: Response) {
    fetchMock.mockResolvedValue(response)
    vi.stubGlobal('fetch', fetchMock)
  }

  function lastCall() {
    const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit]
    return { url, init, headers: new Headers(init.headers) }
  }

  it('constructs a GET request against the API base URL', async () => {
    stubFetch(jsonResponse(200, { ok: true }))
    await expect(apiClient.get<{ ok: boolean }>('/clients')).resolves.toEqual({ ok: true })

    const { url, init } = lastCall()
    expect(url).toBe('/api/clients')
    expect(init.method).toBe('GET')
    expect(init.body).toBeUndefined()
  })

  it('serializes JSON bodies and sets the JSON content type', async () => {
    stubFetch(jsonResponse(200, { id: 1 }))
    await apiClient.post('/clients', { name: 'Acme' })

    const { init, headers } = lastCall()
    expect(init.method).toBe('POST')
    expect(headers.get('Content-Type')).toBe('application/json')
    expect(init.body).toBe(JSON.stringify({ name: 'Acme' }))
  })

  it('passes FormData bodies without a manual content type', async () => {
    stubFetch(jsonResponse(200, { ok: true }))
    const form = new FormData()
    form.append('file', new File(['content'], 'tpl.docx'))

    await apiClient.post('/uploads', form)

    const { init, headers } = lastCall()
    expect(init.method).toBe('POST')
    expect(headers.get('Content-Type')).toBeNull()
    expect(init.body).toBe(form)
  })

  it('attaches the access token as a bearer header when present', async () => {
    setAccessToken('token-123')
    stubFetch(jsonResponse(200, {}))
    await apiClient.get('/me')

    const { headers } = lastCall()
    expect(headers.get('Authorization')).toBe('Bearer token-123')
  })

  it('skips the auth header when auth is disabled', async () => {
    setAccessToken('token-123')
    stubFetch(jsonResponse(200, {}))
    await apiClient.get('/public', { auth: false })

    const { headers } = lastCall()
    expect(headers.get('Authorization')).toBeNull()
  })

  it('returns undefined for 204 no-content responses', async () => {
    stubFetch(new Response(null, { status: 204 }))
    await expect(apiClient.delete('/clients/1')).resolves.toBeUndefined()
  })

  it('converts field validation errors into typed fieldErrors', async () => {
    stubFetch(jsonResponse(400, { name: ['This field is required.'] }))

    const error = await expectRejects(apiClient.post('/clients', {}))
    expect(error.status).toBe(HTTP_STATUS.BAD_REQUEST)
    expect(error.fieldErrors.name).toEqual(['This field is required.'])
    expect(error.message).toBe('This field is required.')
  })

  it('flattens nested field validation errors into dotted keys', async () => {
    stubFetch(
      jsonResponse(400, {
        legal_entity: { voen: ['A legal entity with this VOEN already exists.'] },
      }),
    )

    const error = await expectRejects(apiClient.post('/clients', {}))
    expect(error.fieldErrors['legal_entity.voen']).toEqual([
      'A legal entity with this VOEN already exists.',
    ])
  })

  it('preserves the backend code for 401 responses', async () => {
    stubFetch(
      jsonResponse(401, {
        detail: 'Token is invalid or expired',
        code: 'token_not_valid',
      }),
    )

    const error = await expectRejects(apiClient.get('/me'))
    expect(error.status).toBe(HTTP_STATUS.UNAUTHORIZED)
    expect(error.code).toBe('token_not_valid')
    expect(error.message).toBe('Token is invalid or expired')
  })

  it('captures Retry-After on 429 responses', async () => {
    stubFetch(
      jsonResponse(429, { detail: 'Request was throttled.' }, { 'Retry-After': '5' }),
    )

    const error = await expectRejects(apiClient.get('/documents'))
    expect(error.status).toBe(HTTP_STATUS.TOO_MANY_REQUESTS)
    expect(error.retryAfterSeconds).toBe(5)
  })

  it('falls back to a safe message when the error body is not JSON', async () => {
    stubFetch(new Response('Internal server error', { status: 500 }))

    const error = await expectRejects(apiClient.get('/documents'))
    expect(error.status).toBe(HTTP_STATUS.INTERNAL_SERVER_ERROR)
    expect(error.payload).toBeNull()
    expect(error.message).toBe('An unexpected server error occurred.')
  })

  it('distinguishes statuses via ApiError.status without string matching', () => {
    expect(HTTP_STATUS.UNAUTHORIZED).toBe(401)
    expect(HTTP_STATUS.FORBIDDEN).toBe(403)
    expect(HTTP_STATUS.NOT_FOUND).toBe(404)
    expect(HTTP_STATUS.PAYLOAD_TOO_LARGE).toBe(413)
    expect(HTTP_STATUS.TOO_MANY_REQUESTS).toBe(429)
  })

  describe('automatic token refresh on 401', () => {
    function stubSequence(...responses: Response[]) {
      responses.forEach((response) => fetchMock.mockResolvedValueOnce(response))
      vi.stubGlobal('fetch', fetchMock)
    }

    it('refreshes the access token once and retries the original request', async () => {
      setAccessToken('expired')
      setRefreshToken('refresh-1')
      stubSequence(
        jsonResponse(401, { detail: 'Token is invalid or expired', code: 'token_not_valid' }),
        jsonResponse(200, { access: 'fresh' }),
        jsonResponse(200, { ok: true }),
      )

      await expect(apiClient.get('/me')).resolves.toEqual({ ok: true })

      const calls = fetchMock.mock.calls as [string, RequestInit][]
      expect(calls).toHaveLength(3)
      // The refresh request is public: no bearer header, refresh token in body.
      expect(calls[1][0]).toBe('/api/authentication/token/refresh/')
      expect(new Headers(calls[1][1].headers).get('Authorization')).toBeNull()
      expect(calls[1][1].body).toBe(JSON.stringify({ refresh: 'refresh-1' }))
      // The retried request used the fresh access token.
      expect(new Headers(calls[2][1].headers).get('Authorization')).toBe('Bearer fresh')
      expect(getAccessToken()).toBe('fresh')
    })

    it('shares a single refresh across concurrent 401 responses', async () => {
      setAccessToken('expired')
      setRefreshToken('refresh-1')
      stubSequence(
        jsonResponse(401, { detail: 'expired' }),
        jsonResponse(401, { detail: 'expired' }),
        jsonResponse(200, { access: 'fresh' }),
        jsonResponse(200, { a: 1 }),
        jsonResponse(200, { b: 2 }),
      )

      const [a, b] = await Promise.all([apiClient.get('/a'), apiClient.get('/b')])
      expect(a).toEqual({ a: 1 })
      expect(b).toEqual({ b: 2 })

      const refreshCalls = fetchMock.mock.calls.filter(([url]) =>
        String(url).includes('/authentication/token/refresh/'),
      )
      expect(refreshCalls).toHaveLength(1)
    })

    it('clears tokens and notifies subscribers when refresh fails', async () => {
      setAccessToken('expired')
      setRefreshToken('refresh-1')
      stubSequence(
        jsonResponse(401, { detail: 'expired' }),
        jsonResponse(401, { detail: 'Token is invalid or expired', code: 'token_not_valid' }),
      )
      const listener = vi.fn()
      const unsubscribe = onUnauthorized(listener)

      const error = await expectRejects(apiClient.get('/me'))
      expect(error.status).toBe(HTTP_STATUS.UNAUTHORIZED)
      expect(listener).toHaveBeenCalledTimes(1)
      expect(getAccessToken()).toBeNull()
      expect(getRefreshToken()).toBeNull()
      unsubscribe()
    })

    it('does not retry a request that was already retried once', async () => {
      setAccessToken('expired')
      setRefreshToken('refresh-1')
      stubSequence(
        jsonResponse(401, { detail: 'expired' }), // original
        jsonResponse(200, { access: 'fresh' }), // refresh
        jsonResponse(401, { detail: 'expired' }), // retry is also 401
      )
      vi.stubGlobal('fetch', fetchMock)

      const error = await expectRejects(apiClient.get('/me'))
      expect(error.status).toBe(HTTP_STATUS.UNAUTHORIZED)
      // original + refresh + single retry — no second refresh.
      expect(fetchMock.mock.calls).toHaveLength(3)
      const refreshCount = fetchMock.mock.calls.filter(([url]) =>
        String(url).includes('/authentication/token/refresh/'),
      ).length
      expect(refreshCount).toBe(1)
    })

    it('does not attempt a refresh for public requests (e.g. login)', async () => {
      setAccessToken('expired')
      setRefreshToken('refresh-1')
      stubSequence(jsonResponse(401, { detail: 'No active account found' }))
      const listener = vi.fn()
      const unsubscribe = onUnauthorized(listener)

      const error = await expectRejects(
        apiClient.post(
          '/authentication/token/',
          { company_id: 1, email: 'a@b.c', password: 'x' },
          { auth: false },
        ),
      )
      expect(error.status).toBe(HTTP_STATUS.UNAUTHORIZED)
      expect(fetchMock.mock.calls).toHaveLength(1)
      expect(listener).not.toHaveBeenCalled()
      expect(getAccessToken()).toBe('expired')
      unsubscribe()
    })
  })
})

async function expectRejects(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError)
    return error as ApiError
  }
  throw new Error('expected the promise to reject')
}