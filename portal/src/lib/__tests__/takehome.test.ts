import { TakehomeManager } from '../takehome'

describe('TakehomeManager', () => {
  describe('generatePasscode', () => {
    it('should generate 8-character alphanumeric passcode', () => {
      const manager = new TakehomeManager()
      const passcode = manager.generatePasscode()

      expect(passcode).toHaveLength(8)
      expect(passcode).toMatch(/^[A-Z0-9]{8}$/)
    })

    it('should generate unique passcodes', () => {
      const manager = new TakehomeManager()
      const passcode1 = manager.generatePasscode()
      const passcode2 = manager.generatePasscode()

      expect(passcode1).not.toBe(passcode2)
    })
  })
})
