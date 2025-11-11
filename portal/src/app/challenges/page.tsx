'use client'

import { useState, useEffect, useCallback } from 'react'
import { Challenge, ECSConfiguration } from '@/lib/challenges'
import ChallengeForm from '@/components/ChallengeForm'
import FileBrowser from '@/components/FileBrowser'

export default function ChallengesPage() {
  const [challenges, setChallenges] = useState<Challenge[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedChallenge, setSelectedChallenge] = useState<Challenge | null>(
    null
  )
  const [activeTab, setActiveTab] = useState<
    'list' | 'create' | 'edit' | 'files'
  >('list')
  const [notification, setNotification] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<'newest' | 'usage' | 'lastUsed'>(
    'newest'
  )
  const [searchTerm, setSearchTerm] = useState('')

  // Load challenges
  const loadChallenges = useCallback(async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/challenges/manage?sortBy=${sortBy}`)
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          setChallenges(data.challenges)
        } else {
          setNotification('Failed to load challenges')
        }
      } else {
        setNotification('Failed to load challenges')
      }
    } catch (error) {
      console.error('Error loading challenges:', error)
      setNotification('Error loading challenges')
    } finally {
      setLoading(false)
    }
  }, [sortBy])

  useEffect(() => {
    loadChallenges()
  }, [loadChallenges])

  // Filter challenges based on search term
  const filteredChallenges = challenges.filter(
    challenge =>
      challenge.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      challenge.description.toLowerCase().includes(searchTerm.toLowerCase())
  )

  // Handle challenge deletion
  const handleDelete = async (challengeId: string) => {
    if (!window.confirm('Are you sure you want to delete this challenge?')) {
      return
    }

    try {
      const response = await fetch(`/api/challenges/manage/${challengeId}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        setNotification('Challenge deleted successfully')
        loadChallenges()
        setSelectedChallenge(null)
        setActiveTab('list')
      } else {
        const data = await response.json()
        setNotification(data.error || 'Failed to delete challenge')
      }
    } catch (error) {
      console.error('Error deleting challenge:', error)
      setNotification('Error deleting challenge')
    }
  }

  // Handle challenge creation/update success
  const handleChallengeSuccess = () => {
    setNotification(
      `Challenge ${selectedChallenge ? 'updated' : 'created'} successfully`
    )
    loadChallenges()
    setSelectedChallenge(null)
    setActiveTab('list')
  }

  // Auto-hide notification after 5 seconds
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 5000)
      return () => clearTimeout(timer)
    }
  }, [notification])

  // Format date for display
  const formatDate = (date: Date | string) => {
    const d = typeof date === 'string' ? new Date(date) : date
    return (
      d.toLocaleDateString() +
      ' ' +
      d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    )
  }

  // CPU units to vCPU cores mapping
  const CPU_UNITS_TO_CORES = {
    256: 0.25, // 0.25 vCPU
    512: 0.5, // 0.5 vCPU
    1024: 1, // 1 vCPU
    2048: 2, // 2 vCPU
    4096: 4, // 4 vCPU
  } as const

  const getCpuCores = (cpuUnits: number): number => {
    return CPU_UNITS_TO_CORES[cpuUnits as keyof typeof CPU_UNITS_TO_CORES] || 0
  }

  // Get CPU/Memory display text
  const formatECSConfig = (config: ECSConfiguration) => {
    const cores = getCpuCores(config.cpu)
    const ramGB = config.memory / 1024 // Convert MB to GB
    return `${cores} CPU ${cores === 1 ? 'core' : 'cores'} / ${ramGB}GB RAM / ${
      config.storage
    }GB Storage`
  }

  return (
    <div className="min-h-screen bg-gray-900 p-4 sm:p-8 w-full overflow-x-hidden text-white">
      {/* Notification */}
      {notification && (
        <div
          className={`fixed top-4 right-4 text-white px-6 py-3 rounded-xl shadow-lg z-50 fade-in ${
            notification.includes('Error') || notification.includes('Failed')
              ? 'bg-red-600'
              : 'bg-green-600'
          }`}
        >
          <span>{notification}</span>
        </div>
      )}

      <div className="max-w-7xl mx-auto w-full">
        <header className="mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white">
              Challenge Management
            </h1>
            <p className="text-gray-400 mt-2">
              Manage interview challenges, upload files, and configure ECS
              settings
            </p>
          </div>
        </header>

        {/* Tabs */}
        <div className="flex border-b border-gray-700 mb-6">
          <button
            onClick={() => setActiveTab('list')}
            className={`px-4 py-2 border-b-2 transition-colors ${
              activeTab === 'list'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            Challenges ({challenges.length})
          </button>
          <button
            onClick={() => {
              setActiveTab('create')
              setSelectedChallenge(null)
            }}
            className={`px-4 py-2 border-b-2 transition-colors ${
              activeTab === 'create'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            Create New
          </button>
          {selectedChallenge && (
            <>
              <button
                onClick={() => setActiveTab('edit')}
                className={`px-4 py-2 border-b-2 transition-colors ${
                  activeTab === 'edit'
                    ? 'border-blue-500 text-blue-400'
                    : 'border-transparent text-gray-400 hover:text-white'
                }`}
              >
                Edit &quot;{selectedChallenge.name}&quot;
              </button>
              <button
                onClick={() => setActiveTab('files')}
                className={`px-4 py-2 border-b-2 transition-colors ${
                  activeTab === 'files'
                    ? 'border-blue-500 text-blue-400'
                    : 'border-transparent text-gray-400 hover:text-white'
                }`}
              >
                Files
              </button>
            </>
          )}
        </div>

        {/* Challenge List Tab */}
        {activeTab === 'list' && (
          <div>
            {/* Search and Sort Controls */}
            <div className="flex gap-4 mb-6">
              <input
                type="text"
                placeholder="Search challenges..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value as typeof sortBy)}
                className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="newest">Newest First</option>
                <option value="usage">Most Used</option>
                <option value="lastUsed">Recently Used</option>
              </select>
            </div>

            {/* Challenge List */}
            {loading ? (
              <div className="text-center py-8">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                <p className="mt-2">Loading challenges...</p>
              </div>
            ) : filteredChallenges.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                {searchTerm
                  ? 'No challenges match your search'
                  : 'No challenges found'}
                <br />
                <button
                  onClick={() => setActiveTab('create')}
                  className="mt-4 btn-primary"
                >
                  Create First Challenge
                </button>
              </div>
            ) : (
              <div className="grid gap-4">
                {filteredChallenges.map(challenge => (
                  <div
                    key={challenge.id}
                    className="p-6 bg-gray-800 border border-gray-700 rounded-lg hover:border-gray-600 transition-colors"
                  >
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h3 className="text-xl font-semibold mb-2">
                          {challenge.name}
                        </h3>
                        <p className="text-gray-400 mb-2">
                          {challenge.description}
                        </p>
                        <div className="flex items-center gap-4 text-sm text-gray-500">
                          <span>
                            Created: {formatDate(challenge.createdAt)}
                          </span>
                          <span>Used: {challenge.usageCount} times</span>
                          {challenge.lastUsedAt && (
                            <span>
                              Last used: {formatDate(challenge.lastUsedAt)}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setSelectedChallenge(challenge)
                            setActiveTab('files')
                          }}
                          className="px-3 py-1 text-sm bg-green-600 hover:bg-green-500 rounded transition-colors"
                        >
                          View Files
                        </button>
                        <button
                          onClick={() => {
                            setSelectedChallenge(challenge)
                            setActiveTab('edit')
                          }}
                          className="px-3 py-1 text-sm bg-blue-600 hover:bg-blue-500 rounded transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(challenge.id)}
                          className="px-3 py-1 text-sm bg-red-600 hover:bg-red-500 rounded transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-gray-400">
                        <span>{formatECSConfig(challenge.ecsConfig)}</span>
                      </div>
                      <div className="text-sm text-gray-400">
                        <span>{challenge.files.length} files</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Create/Edit Challenge Tab */}
        {(activeTab === 'create' || activeTab === 'edit') && (
          <ChallengeForm
            challenge={selectedChallenge}
            onSuccess={handleChallengeSuccess}
            onCancel={() => {
              setActiveTab('list')
              setSelectedChallenge(null)
            }}
          />
        )}

        {/* File Browser Tab */}
        {activeTab === 'files' && selectedChallenge && (
          <FileBrowser
            challengeId={selectedChallenge.id}
            challengeName={selectedChallenge.name}
            onBack={() => setActiveTab('list')}
          />
        )}
      </div>
    </div>
  )
}
