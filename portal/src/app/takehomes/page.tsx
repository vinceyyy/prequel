'use client'

import { useState, useEffect, useCallback } from 'react'
import OperationDashboard from '@/components/OperationDashboard'
import { useSSE, type OperationData } from '@/hooks/useSSE'
import type {
  TakeHomeSessionStatus,
  InstanceStatus,
} from '@/lib/types/assessment'

interface TakeHome {
  id: string
  candidateName?: string
  candidateEmail?: string
  challengeId: string
  sessionStatus: TakeHomeSessionStatus
  instanceStatus: InstanceStatus
  createdAt: string
  availableFrom: string
  availableUntil: string
  activatedAt?: string
  accessToken: string
  url?: string
  password?: string
  autoDestroyAt?: string
  destroyedAt?: string
  saveFiles?: boolean
}

/**
 * Formats a duration in milliseconds to human-readable format.
 * Examples: "2h 30m", "45m", "1h 5m"
 */
function formatDuration(durationMs: number): string {
  const hours = Math.floor(durationMs / (1000 * 60 * 60))
  const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60))

  if (hours > 0 && minutes > 0) {
    return `${hours}h ${minutes}m`
  } else if (hours > 0) {
    return `${hours}h`
  } else if (minutes > 0) {
    return `${minutes}m`
  } else {
    return '<1m'
  }
}

/**
 * Calculates the duration the candidate had active access to the instance.
 * Returns formatted duration string or null if not calculable.
 */
function calculateTakeHomeDuration(takeHome: TakeHome): string | null {
  if (!takeHome.activatedAt) {
    return null
  }

  const activatedTime = new Date(takeHome.activatedAt).getTime()

  // Use destroyedAt if available (actual destruction time)
  // Otherwise use autoDestroyAt (scheduled destruction time)
  let endTime: number
  if (takeHome.destroyedAt) {
    endTime = new Date(takeHome.destroyedAt).getTime()
  } else if (takeHome.autoDestroyAt) {
    endTime = new Date(takeHome.autoDestroyAt).getTime()
  } else {
    return null
  }

  // Only calculate if end time is after activation
  if (endTime > activatedTime) {
    return formatDuration(endTime - activatedTime)
  }

  return null
}

export default function TakeHomesPage() {
  const [takeHomes, setTakeHomes] = useState<TakeHome[]>([])
  const [activeTab, setActiveTab] = useState<'active' | 'history'>('active')
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const [showLogsModal, setShowLogsModal] = useState(false)
  const [selectedTakeHomeForLogs, setSelectedTakeHomeForLogs] = useState<
    string | null
  >(null)
  const [notification, setNotification] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    candidateName: '',
    candidateEmail: '',
    challenge: '',
    availableDays: 7,
    durationHours: 4,
    additionalInstructions: '',
  })

  // Use SSE for real-time updates
  const { connected: sseConnected, lastEvent } = useSSE('/api/events')

  const [challenges, setChallenges] = useState<
    Array<{
      id: string
      name: string
      description: string
      ecsConfig: {
        cpu: number
        cpuCores: number
        memory: number
        storage: number
      }
      usageCount: number
      createdAt: string
      lastUsedAt?: string
    }>
  >([])

  const loadChallenges = useCallback(async () => {
    try {
      const response = await fetch('/api/challenges')
      if (response.ok) {
        const data = await response.json()
        if (data.success && data.challenges) {
          console.log('[DEBUG] Loaded challenges from API:', data.challenges)
          setChallenges(data.challenges)
          // Set first challenge as default if no challenge selected
          if (data.challenges.length > 0 && !formData.challenge) {
            setFormData(prev => ({ ...prev, challenge: data.challenges[0].id }))
          }
        }
      } else {
        console.warn('Failed to load challenges, using fallback')
      }
    } catch (error) {
      console.error('Error loading challenges:', error)
    }
  }, [formData.challenge])

  const loadTakeHomes = useCallback(async () => {
    try {
      const timestamp = new Date().getTime()
      const response = await fetch(`/api/takehomes?t=${timestamp}`)
      if (response.ok) {
        const data = await response.json()
        console.log('[DEBUG] Loaded take-homes from API:', data.takeHomes)
        setTakeHomes(data.takeHomes || [])
      } else {
        console.error('Failed to load take-homes')
      }
    } catch (error) {
      console.error('Error loading take-homes:', error)
    } finally {
      if (initialLoading) {
        setInitialLoading(false)
      }
    }
  }, [initialLoading])

  // Initial load
  useEffect(() => {
    console.log('[DEBUG] TakeHomes page: Initial load')
    loadTakeHomes()
    loadChallenges()
  }, [loadTakeHomes, loadChallenges])

  // 30-second polling for take-home updates
  useEffect(() => {
    const interval = setInterval(() => {
      console.log('[DEBUG] Polling: Refreshing take-homes (30s interval)')
      loadTakeHomes()
    }, 30000)

    return () => clearInterval(interval)
  }, [loadTakeHomes])

  // Listen for SSE events to update data immediately
  useEffect(() => {
    if (lastEvent) {
      console.log('Received SSE event:', lastEvent)

      // Handle operation updates for take-homes
      if (lastEvent.type === 'operation_update' && lastEvent.operation) {
        const operation: OperationData = lastEvent.operation

        // Filter for take-home operations only (ignore interview operations)
        // Operations include an interviewId field (actually instanceId) with prefixes:
        // - TAKEHOME# for take-home operations
        // - INTERVIEW# for interview operations
        if (
          operation.interviewId &&
          operation.interviewId.startsWith('TAKEHOME#')
        ) {
          console.log('Processing take-home operation update:', operation)

          // Refresh take-homes from API
          setTimeout(() => {
            loadTakeHomes()
          }, 100)
        }
      }

      // Refresh on scheduler events
      if (lastEvent.type === 'scheduler_event') {
        console.log('Refreshing take-homes due to scheduler event')
        setTimeout(() => {
          loadTakeHomes()
        }, 100)
      }
    }
  }, [lastEvent, loadTakeHomes])

  const handleDeleteTakeHome = async (takeHomeId: string) => {
    const takeHome = takeHomes.find(th => th.id === takeHomeId)
    if (!takeHome) return

    console.log('[DEBUG] Delete take-home requested', {
      takeHomeId,
      candidateName: takeHome.candidateName,
      sessionStatus: takeHome.sessionStatus,
    })

    const message = `Are you sure you want to permanently delete this take-home for ${takeHome.candidateName || 'Unknown'}? This action cannot be undone.`

    if (!confirm(message)) {
      return
    }

    try {
      console.log(
        '[DEBUG] Sending DELETE request to:',
        `/api/takehomes/${takeHomeId}/delete`
      )
      const response = await fetch(`/api/takehomes/${takeHomeId}/delete`, {
        method: 'POST',
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to delete take-home')
      }

      setNotification('Take-home deleted successfully')
      setTimeout(() => setNotification(null), 5000)

      // Refresh the list
      loadTakeHomes()
    } catch (error) {
      console.error('Error deleting take-home:', error)
      alert(
        `Failed to delete take-home: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      )
    }
  }

  const handleRevokeTakeHome = async (takeHomeId: string) => {
    const takeHome = takeHomes.find(th => th.id === takeHomeId)
    if (!takeHome) return

    console.log('[DEBUG] Revoke take-home requested', {
      takeHomeId,
      candidateName: takeHome.candidateName,
      sessionStatus: takeHome.sessionStatus,
    })

    const message = `Are you sure you want to revoke this take-home for ${takeHome.candidateName || 'Unknown'}? This will immediately destroy the environment and mark it as revoked. This action cannot be undone.`

    if (!confirm(message)) {
      return
    }

    try {
      console.log(
        '[DEBUG] Sending POST request to:',
        `/api/takehomes/${takeHomeId}/revoke`
      )
      const response = await fetch(`/api/takehomes/${takeHomeId}/revoke`, {
        method: 'POST',
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to revoke take-home')
      }

      const result = await response.json()

      if (result.operationId) {
        setNotification(
          'Take-home revocation initiated - check logs for progress'
        )
      } else {
        setNotification('Take-home revoked successfully')
      }

      setTimeout(() => setNotification(null), 5000)

      // Refresh the list
      loadTakeHomes()
    } catch (error) {
      console.error('Error revoking take-home:', error)
      alert(
        `Failed to revoke take-home: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      )
    }
  }

  const handleDownloadFiles = async (takeHomeId: string) => {
    try {
      const response = await fetch(`/api/takehomes/${takeHomeId}/files`)

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to download files')
      }

      // Create download link
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url

      // Extract filename from response headers or use default
      const contentDisposition = response.headers.get('Content-Disposition')
      let filename = `takehome-${takeHomeId}-files.tar.gz`

      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="(.+)"/)
        if (filenameMatch) {
          filename = filenameMatch[1]
        }
      }

      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)

      setNotification('Files downloaded successfully')
      setTimeout(() => setNotification(null), 3000)
    } catch (error) {
      console.error('Error downloading files:', error)
      let errorMessage = 'Failed to download files'

      if (error instanceof Error) {
        errorMessage = error.message

        // Make some common errors more user-friendly
        if (error.message.includes('Files were not saved')) {
          errorMessage = 'Files were not saved for this take-home'
        } else if (error.message.includes('not yet available')) {
          errorMessage = 'Files are not yet available. Please try again later.'
        }
      }

      alert(errorMessage)
    }
  }

  const handleCreateTakeHome = async () => {
    if (!formData.candidateName.trim() || !formData.challenge) return

    setLoading(true)
    try {
      const requestBody = {
        candidateName: formData.candidateName.trim(),
        candidateEmail: formData.candidateEmail.trim() || undefined,
        challengeId: formData.challenge,
        availableDays: formData.availableDays,
        durationHours: formData.durationHours,
        additionalInstructions:
          formData.additionalInstructions.trim() || undefined,
      }

      const response = await fetch('/api/takehomes/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to create take-home')
      }

      await response.json()

      // Reset form and close modal
      setFormData({
        candidateName: '',
        candidateEmail: '',
        challenge: challenges.length > 0 ? challenges[0].id : '',
        availableDays: 7,
        durationHours: 4,
        additionalInstructions: '',
      })
      setShowCreateForm(false)

      // Show notification with access link
      setNotification(`Take-home created for ${formData.candidateName.trim()}`)
      setTimeout(() => setNotification(null), 5000)

      // Refresh the list
      loadTakeHomes()
    } catch (error) {
      console.error('Error creating take-home:', error)
      alert(
        `Failed to create take-home: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      )
    } finally {
      setLoading(false)
    }
  }

  // Separate take-homes into active and history
  // Active: not completed/expired, OR revoked but still destroying
  const activeTakeHomes = takeHomes.filter(th => {
    if (th.sessionStatus === 'completed' || th.sessionStatus === 'expired') {
      return false
    }
    if (th.sessionStatus === 'revoked' && th.instanceStatus !== 'destroying') {
      return false
    }
    return true
  })

  // History: completed, expired, or revoked AND not destroying
  const historicalTakeHomes = takeHomes.filter(
    th =>
      th.sessionStatus === 'completed' ||
      th.sessionStatus === 'expired' ||
      (th.sessionStatus === 'revoked' && th.instanceStatus !== 'destroying')
  )

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-8 w-full overflow-x-hidden">
      {/* Notification */}
      {notification && (
        <div
          className={`fixed top-4 right-4 text-white px-6 py-3 rounded-xl shadow-lg z-50 fade-in ${
            notification.includes('Failed') || notification.includes('Error')
              ? 'bg-red-600'
              : 'bg-green-600'
          }`}
        >
          <div className="flex items-center space-x-2">
            <span>{notification}</span>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto w-full">
        <header className="mb-8">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-3xl font-bold text-slate-900">Take-Homes</h1>
              <p className="text-slate-600 mt-2">
                Create and manage take-home assessments
              </p>
            </div>
            <div className="flex items-center space-x-2">
              <div
                className={`w-2 h-2 rounded-full ${
                  sseConnected ? 'bg-green-500' : 'bg-red-500'
                }`}
              ></div>
              <span className="text-sm text-slate-600">
                {sseConnected ? 'Live updates' : 'Offline'}
              </span>
            </div>
          </div>
        </header>

        <div className="mb-6 flex flex-wrap gap-3 items-center">
          <button
            onClick={() => setShowCreateForm(true)}
            className="btn-primary"
          >
            Create New Take-Home
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="mb-6">
          <div className="border-b border-slate-200">
            <nav className="-mb-px flex space-x-8">
              <button
                onClick={() => setActiveTab('active')}
                className={`py-2 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${
                  activeTab === 'active'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                }`}
              >
                Active Take-Homes
                {activeTakeHomes.length > 0 && (
                  <span className="ml-2 bg-blue-100 text-blue-600 text-xs px-2 py-1 rounded-full">
                    {activeTakeHomes.length}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className={`py-2 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${
                  activeTab === 'history'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                }`}
              >
                History
                {historicalTakeHomes.length > 0 && (
                  <span className="ml-2 bg-slate-100 text-slate-600 text-xs px-2 py-1 rounded-full">
                    {historicalTakeHomes.length}
                  </span>
                )}
              </button>
            </nav>
          </div>
        </div>

        {showCreateForm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="card p-4 sm:p-6 w-full max-w-md fade-in">
              <h2 className="text-xl font-semibold mb-4 text-slate-900">
                Create New Take-Home
              </h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-900 mb-1">
                    Candidate Name
                  </label>
                  <input
                    type="text"
                    value={formData.candidateName}
                    onChange={e =>
                      setFormData({
                        ...formData,
                        candidateName: e.target.value,
                      })
                    }
                    className="input-field"
                    placeholder="Enter candidate name"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-900 mb-1">
                    Candidate Email (optional)
                  </label>
                  <input
                    type="email"
                    value={formData.candidateEmail}
                    onChange={e =>
                      setFormData({
                        ...formData,
                        candidateEmail: e.target.value,
                      })
                    }
                    className="input-field"
                    placeholder="candidate@example.com"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-900 mb-2">
                    Challenge
                  </label>
                  <div className="space-y-3 max-h-64 overflow-y-auto">
                    {challenges.length === 0 ? (
                      <div className="text-slate-500 text-sm p-3 border border-slate-200 rounded-lg">
                        No challenges available. Create challenges first.
                      </div>
                    ) : (
                      challenges.map(challenge => (
                        <div key={challenge.id}>
                          <label className="flex items-start space-x-3 p-3 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer">
                            <input
                              type="radio"
                              name="challenge"
                              value={challenge.id}
                              checked={formData.challenge === challenge.id}
                              onChange={e =>
                                setFormData({
                                  ...formData,
                                  challenge: e.target.value,
                                })
                              }
                              className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 border-slate-300"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between">
                                <h4 className="text-sm font-medium text-slate-900">
                                  {challenge.name}
                                </h4>
                              </div>
                              <p className="text-sm text-slate-600 mt-1">
                                {challenge.description}
                              </p>
                              <div className="mt-2 text-xs text-slate-600">
                                {challenge.ecsConfig.cpuCores} CPU{' '}
                                {challenge.ecsConfig.cpuCores === 1
                                  ? 'core'
                                  : 'cores'}{' '}
                                / {challenge.ecsConfig.memory / 1024}GB RAM /{' '}
                                {challenge.ecsConfig.storage}GB Storage
                              </div>
                            </div>
                          </label>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-900 mb-1">
                    Available For (days)
                  </label>
                  <select
                    value={formData.availableDays}
                    onChange={e =>
                      setFormData({
                        ...formData,
                        availableDays: parseInt(e.target.value),
                      })
                    }
                    className="input-field"
                  >
                    <option value={1}>1 day</option>
                    <option value={3}>3 days</option>
                    <option value={7}>7 days</option>
                    <option value={14}>14 days</option>
                    <option value={30}>30 days</option>
                  </select>
                  <p className="text-xs text-slate-500 mt-1">
                    How long the candidate has to activate the take-home
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-900 mb-1">
                    Duration (hours)
                  </label>
                  <select
                    value={formData.durationHours}
                    onChange={e =>
                      setFormData({
                        ...formData,
                        durationHours: parseInt(e.target.value),
                      })
                    }
                    className="input-field"
                  >
                    <option value={1}>1 hour</option>
                    <option value={2}>2 hours</option>
                    <option value={3}>3 hours</option>
                    <option value={4}>4 hours</option>
                    <option value={6}>6 hours</option>
                    <option value={8}>8 hours</option>
                  </select>
                  <p className="text-xs text-slate-500 mt-1">
                    Time limit once candidate activates
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-900 mb-1">
                    Additional Instructions (optional)
                  </label>
                  <textarea
                    value={formData.additionalInstructions}
                    onChange={e =>
                      setFormData({
                        ...formData,
                        additionalInstructions: e.target.value,
                      })
                    }
                    className="input-field"
                    rows={4}
                    placeholder="Any specific instructions or requirements for the candidate..."
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Custom instructions that will be shown to the candidate
                  </p>
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={handleCreateTakeHome}
                  disabled={
                    !formData.candidateName.trim() ||
                    !formData.challenge ||
                    loading
                  }
                  className="flex-1 btn-primary"
                >
                  {loading ? 'Creating...' : 'Create Take-Home'}
                </button>
                <button
                  onClick={() => setShowCreateForm(false)}
                  className="flex-1 btn-outline"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Active Tab */}
        {activeTab === 'active' && (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                      Candidate
                    </th>
                    <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                      Challenge
                    </th>
                    <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                      Schedule
                    </th>
                    <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                      Access Link
                    </th>
                    <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-200">
                  {initialLoading ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-3 sm:px-6 py-4 text-center text-slate-500"
                      >
                        <div className="flex items-center justify-center space-x-2">
                          <div className="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full"></div>
                          <span>Loading take-homes...</span>
                        </div>
                      </td>
                    </tr>
                  ) : activeTakeHomes.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-3 sm:px-6 py-4 text-center text-slate-500"
                      >
                        No active take-homes
                      </td>
                    </tr>
                  ) : (
                    activeTakeHomes.map(takeHome => (
                      <tr key={takeHome.id}>
                        <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-slate-900">
                            {takeHome.candidateName || 'Unknown'}
                          </div>
                          {takeHome.candidateEmail && (
                            <div className="text-sm text-slate-500">
                              {takeHome.candidateEmail}
                            </div>
                          )}
                        </td>
                        <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-sm text-slate-900">
                          {
                            challenges.find(c => c.id === takeHome.challengeId)
                              ?.name
                          }
                        </td>
                        <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                          <div className="space-y-1">
                            <span
                              className={`status-badge ${
                                takeHome.sessionStatus === 'available'
                                  ? 'bg-blue-100 text-blue-800'
                                  : takeHome.sessionStatus === 'activated'
                                    ? 'bg-green-100 text-green-800'
                                    : takeHome.sessionStatus === 'revoked'
                                      ? 'bg-red-100 text-red-800'
                                      : 'bg-slate-100 text-slate-800'
                              }`}
                            >
                              {takeHome.sessionStatus}
                            </span>
                            {takeHome.sessionStatus === 'activated' && (
                              <div>
                                <span
                                  className={`status-badge status-${takeHome.instanceStatus}`}
                                >
                                  {takeHome.instanceStatus}
                                </span>
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-sm text-slate-900">
                          <div>
                            <div className="text-xs text-slate-500">
                              Available until:
                            </div>
                            <div className="text-sm">
                              {new Date(
                                takeHome.availableUntil
                              ).toLocaleString()}
                            </div>
                          </div>
                          {takeHome.activatedAt && takeHome.autoDestroyAt && (
                            <div className="bg-amber-50 p-1 rounded-md border border-amber-200 mt-1">
                              <div className="text-xs text-amber-700">
                                Auto-destroy:
                              </div>
                              <div className="text-xs font-medium text-amber-900">
                                {new Date(
                                  takeHome.autoDestroyAt
                                ).toLocaleString()}
                              </div>
                            </div>
                          )}
                        </td>
                        <td className="px-3 sm:px-6 py-4 text-sm text-slate-900">
                          {takeHome.sessionStatus === 'activated' &&
                          takeHome.instanceStatus === 'active' &&
                          takeHome.url ? (
                            <div className="max-w-xs">
                              <a
                                className="text-blue-600 underline cursor-pointer break-all hover:text-blue-700 transition-colors"
                                href={takeHome.url}
                                target="_blank"
                              >
                                {takeHome.url}
                              </a>
                              <div className="text-slate-500 break-all">
                                Password: {takeHome.password}
                              </div>
                            </div>
                          ) : (
                            <div className="text-sm">
                              <a
                                href={`${window.location.protocol}//${window.location.host}/takehome/${takeHome.accessToken}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:text-blue-700 underline break-all"
                              >
                                {`${window.location.protocol}//${window.location.host}/takehome/${takeHome.accessToken}`}
                              </a>
                            </div>
                          )}
                        </td>
                        <td className="px-3 sm:px-6 py-4 text-sm font-medium">
                          <div className="flex flex-wrap gap-2 items-center">
                            <button
                              onClick={() => handleRevokeTakeHome(takeHome.id)}
                              disabled={
                                takeHome.instanceStatus === 'destroying'
                              }
                              className="btn-danger text-sm px-3 py-1 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {takeHome.instanceStatus === 'destroying'
                                ? 'Destroying...'
                                : 'Revoke'}
                            </button>
                            <button
                              onClick={() => {
                                setSelectedTakeHomeForLogs(takeHome.id)
                                setShowLogsModal(true)
                              }}
                              className="btn-primary text-sm px-3 py-1"
                            >
                              Logs
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* History Tab */}
        {activeTab === 'history' && (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                      Candidate
                    </th>
                    <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                      Challenge
                    </th>
                    <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                      Created
                    </th>
                    <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                      Activated
                    </th>
                    <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                      Duration
                    </th>
                    <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-200">
                  {initialLoading ? (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-3 sm:px-6 py-4 text-center text-slate-500"
                      >
                        <div className="flex items-center justify-center space-x-2">
                          <div className="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full"></div>
                          <span>Loading history...</span>
                        </div>
                      </td>
                    </tr>
                  ) : historicalTakeHomes.length === 0 ? (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-3 sm:px-6 py-4 text-center text-slate-500"
                      >
                        No historical take-homes found
                      </td>
                    </tr>
                  ) : (
                    historicalTakeHomes.map(takeHome => (
                      <tr key={takeHome.id}>
                        <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-slate-900">
                            {takeHome.candidateName || 'Unknown'}
                          </div>
                          {takeHome.candidateEmail && (
                            <div className="text-sm text-slate-500">
                              {takeHome.candidateEmail}
                            </div>
                          )}
                        </td>
                        <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-sm text-slate-900">
                          {
                            challenges.find(c => c.id === takeHome.challengeId)
                              ?.name
                          }
                        </td>
                        <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                          <span
                            className={`status-badge ${
                              takeHome.sessionStatus === 'completed'
                                ? 'bg-green-100 text-green-800'
                                : takeHome.sessionStatus === 'revoked'
                                  ? 'bg-red-100 text-red-800'
                                  : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {takeHome.sessionStatus}
                          </span>
                        </td>
                        <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-sm text-slate-900">
                          <div>
                            {new Date(takeHome.createdAt).toLocaleDateString()}
                          </div>
                          <div className="text-slate-500">
                            {new Date(takeHome.createdAt).toLocaleTimeString()}
                          </div>
                        </td>
                        <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-sm text-slate-900">
                          {takeHome.activatedAt ? (
                            <div>
                              <div>
                                {new Date(
                                  takeHome.activatedAt
                                ).toLocaleDateString()}
                              </div>
                              <div className="text-slate-500">
                                {new Date(
                                  takeHome.activatedAt
                                ).toLocaleTimeString()}
                              </div>
                            </div>
                          ) : (
                            <span className="text-slate-400">
                              Not activated
                            </span>
                          )}
                        </td>
                        <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-sm text-slate-900">
                          {(() => {
                            const duration = calculateTakeHomeDuration(takeHome)
                            return duration ? (
                              <span className="text-slate-900">{duration}</span>
                            ) : (
                              <span className="text-slate-400">-</span>
                            )
                          })()}
                        </td>
                        <td className="px-3 sm:px-6 py-4 text-sm font-medium">
                          <div className="flex flex-wrap gap-2 items-center">
                            {takeHome.saveFiles && (
                              <button
                                onClick={() => handleDownloadFiles(takeHome.id)}
                                className="btn-primary text-sm px-3 py-1"
                              >
                                Download
                              </button>
                            )}
                            <button
                              onClick={() => handleDeleteTakeHome(takeHome.id)}
                              className="btn-outline text-sm px-3 py-1"
                            >
                              Delete
                            </button>
                            <button
                              onClick={() => {
                                setSelectedTakeHomeForLogs(takeHome.id)
                                setShowLogsModal(true)
                              }}
                              className="btn-primary text-sm px-3 py-1"
                            >
                              Logs
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Logs Modal */}
        {showLogsModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="card p-4 sm:p-6 w-full max-w-6xl h-5/6 max-h-screen overflow-hidden fade-in">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold text-slate-900">
                  Operation Logs
                  {selectedTakeHomeForLogs
                    ? ` - Take-Home ${selectedTakeHomeForLogs}`
                    : ''}
                </h2>
                <button
                  onClick={() => {
                    setShowLogsModal(false)
                    setSelectedTakeHomeForLogs(null)
                  }}
                  className="text-slate-500 hover:text-slate-700 cursor-pointer transition-colors"
                >
                  ✕
                </button>
              </div>

              <OperationDashboard interviewFilter={selectedTakeHomeForLogs} />

              <div className="flex justify-end mt-4">
                <button
                  onClick={() => {
                    setShowLogsModal(false)
                    setSelectedTakeHomeForLogs(null)
                  }}
                  className="btn-outline"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
