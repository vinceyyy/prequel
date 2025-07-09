import { NextRequest } from 'next/server'
import { POST as loginPOST } from '../login/route'
import { POST as logoutPOST } from '../logout/route'

// Mock environment variables
const originalEnv = process.env

beforeEach(() => {
  jest.resetModules()
  process.env = { ...originalEnv }
})

afterAll(() => {
  process.env = originalEnv
})

describe('Authentication API', () => {
  describe('Login Route', () => {
    it('should return success when auth is disabled', async () => {
      process.env.ENABLE_AUTH = 'false'

      const request = new NextRequest('http://localhost:3000/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ passcode: 'any-passcode' }),
      })

      const response = await loginPOST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
    })

    it('should return error for invalid passcode when auth is enabled', async () => {
      process.env.ENABLE_AUTH = 'true'
      process.env.AUTH_PASSCODE = 'correct-passcode'

      const request = new NextRequest('http://localhost:3000/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ passcode: 'wrong-passcode' }),
      })

      const response = await loginPOST(request)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Invalid passcode')
    })

    it('should return success and set cookie for valid passcode', async () => {
      process.env.ENABLE_AUTH = 'true'
      process.env.AUTH_PASSCODE = 'correct-passcode'

      const request = new NextRequest('http://localhost:3000/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ passcode: 'correct-passcode' }),
      })

      const response = await loginPOST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)

      // Check that auth cookie is set
      const setCookieHeader = response.headers.get('set-cookie')
      expect(setCookieHeader).toContain('auth-token=authenticated')
    })

    it('should return error for empty passcode', async () => {
      process.env.ENABLE_AUTH = 'true'
      process.env.AUTH_PASSCODE = 'correct-passcode'

      const request = new NextRequest('http://localhost:3000/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ passcode: '' }),
      })

      const response = await loginPOST(request)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Invalid passcode')
    })
  })

  describe('Logout Route', () => {
    it('should clear authentication cookie', async () => {
      const response = await logoutPOST()
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)

      // Check that auth cookie is cleared
      const setCookieHeader = response.headers.get('set-cookie')
      expect(setCookieHeader).toContain('auth-token=')
      expect(setCookieHeader).toContain('Max-Age=0')
    })
  })
})
