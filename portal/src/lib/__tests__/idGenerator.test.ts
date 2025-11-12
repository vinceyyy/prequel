import { generateId, generateSecureString } from '../idGenerator'

describe('idGenerator', () => {
  describe('generateId', () => {
    test('generates 8-character alphanumeric string', () => {
      const id = generateId()
      expect(id).toHaveLength(8)
      expect(id).toMatch(/^[a-z0-9]+$/)
    })

    test('generates unique IDs', () => {
      const ids = new Set()
      for (let i = 0; i < 1000; i++) {
        ids.add(generateId())
      }
      // Should generate mostly unique IDs (collision rate very low)
      expect(ids.size).toBeGreaterThan(990)
    })
  })

  describe('generateSecureString', () => {
    test('generates 10-character alphanumeric string', () => {
      const str = generateSecureString()
      expect(str).toHaveLength(10)
      expect(str).toMatch(/^[a-z0-9]+$/)
    })

    test('generates unique strings', () => {
      const strings = new Set()
      for (let i = 0; i < 1000; i++) {
        strings.add(generateSecureString())
      }
      // Should generate mostly unique strings
      expect(strings.size).toBeGreaterThan(990)
    })
  })
})
