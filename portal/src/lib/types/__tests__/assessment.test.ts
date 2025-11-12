import {
  Interview,
  TakeHome,
  InstanceFields,
  instanceStatusValues,
  interviewSessionStatusValues,
  takeHomeSessionStatusValues,
} from '../assessment'

describe('Assessment Types', () => {
  test('InstanceFields contains all required infrastructure fields', () => {
    const instance: InstanceFields = {
      instanceStatus: 'pending',
      challengeId: 'challenge-123',
      resourceConfig: {
        cpu: 1024,
        memory: 2048,
        storage: 20,
      },
    }

    expect(instance.instanceStatus).toBe('pending')
    expect(instance.challengeId).toBe('challenge-123')
  })

  test('Interview type has sessionStatus and InstanceFields', () => {
    const interview: Interview = {
      PK: 'INTERVIEW#int-123',
      SK: 'METADATA',
      sessionType: 'interview',
      id: 'int-123',
      type: 'immediate',
      sessionStatus: 'active',
      createdAt: Date.now() / 1000,
      createdBy: 'user-123',

      // Instance fields
      instanceStatus: 'active',
      challengeId: 'challenge-123',
      resourceConfig: {
        cpu: 1024,
        memory: 2048,
        storage: 20,
      },
    }

    expect(interview.sessionStatus).toBe('active')
    expect(interview.instanceStatus).toBe('active')
    expect(interview.sessionType).toBe('interview')
  })

  test('TakeHome type has sessionStatus and InstanceFields', () => {
    const takeHome: TakeHome = {
      PK: 'TAKEHOME#th-123',
      SK: 'METADATA',
      sessionType: 'takehome',
      id: 'th-123',
      accessToken: 'token-abc-123',
      availableFrom: Date.now() / 1000,
      availableUntil: Date.now() / 1000 + 86400 * 7,
      isActivated: false,
      sessionStatus: 'available',
      createdAt: Date.now() / 1000,
      createdBy: 'user-123',

      // Instance fields
      instanceStatus: 'pending',
      challengeId: 'challenge-123',
      resourceConfig: {
        cpu: 1024,
        memory: 2048,
        storage: 20,
      },
    }

    expect(takeHome.sessionStatus).toBe('available')
    expect(takeHome.instanceStatus).toBe('pending')
    expect(takeHome.sessionType).toBe('takehome')
  })

  test('status enums contain correct values', () => {
    expect(instanceStatusValues).toContain('pending')
    expect(instanceStatusValues).toContain('active')
    expect(interviewSessionStatusValues).toContain('scheduled')
    expect(interviewSessionStatusValues).toContain('active')
    expect(takeHomeSessionStatusValues).toContain('available')
    expect(takeHomeSessionStatusValues).toContain('expired')
  })
})
