/**
 * Challenge type + constant definitions shared with the UI.
 *
 * These mirror the authoritative definitions in the backend's lib/challenges.ts
 * but live here, free of any AWS SDK imports, so the browser bundle never pulls
 * in server-only code. Keep in sync with the backend if the shape changes.
 */

export interface ChallengeFile {
  /** Relative path within the challenge folder */
  path: string
  /** File size in bytes */
  size: number
  /** MIME type */
  mimeType: string
  /** Last modified timestamp */
  lastModified: Date
}

export interface ECSConfiguration {
  /** CPU units (256, 512, 1024, 2048, 4096) */
  cpu: number
  /** Memory in MB (512, 1024, 2048, 4096, 8192, 16384) */
  memory: number
  /** Storage in GB (20-200) */
  storage: number
}

export interface Challenge {
  id: string
  name: string
  description: string
  isActive: string
  files: ChallengeFile[]
  ecsConfig: ECSConfiguration
  usageCount: number
  lastUsedAt?: Date
  createdAt: Date
  updatedAt: Date
  createdBy: string
  ttl?: number
}

export const ECS_CONFIG_LIMITS = {
  cpu: {
    256: [512, 1024, 2048],
    512: [1024, 2048, 3072, 4096],
    1024: [2048, 3072, 4096, 5120, 6144, 7168, 8192],
    2048: [4096, 5120, 6144, 7168, 8192, 9216, 10240, 11264, 12288, 13312, 14336, 15360, 16384],
    4096: [
      8192, 9216, 10240, 11264, 12288, 13312, 14336, 15360, 16384, 17408, 18432, 19456, 20480,
      21504, 22528, 23552, 24576, 25600, 26624, 27648, 28672, 29696, 30720,
    ],
  },
  storage: { min: 20, max: 200 },
} as const
