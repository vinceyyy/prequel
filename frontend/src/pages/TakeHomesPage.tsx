import { useState, useEffect, useCallback, useRef } from 'react'
import { useTakeHomePolling, useOperationPolling, type OperationData } from '@/hooks/usePolling'
import { type Challenge } from '@/components/takehomes/types'
import CreateTakeHomeModal from '@/components/takehomes/CreateTakeHomeModal'
import ActiveTakeHomesTable from '@/components/takehomes/ActiveTakeHomesTable'
import HistoryTakeHomesTable from '@/components/takehomes/HistoryTakeHomesTable'
import TakeHomeLogsModal from '@/components/takehomes/TakeHomeLogsModal'

export default function TakeHomesPage() {
  const [activeTab, setActiveTab] = useState<'active' | 'history'>('active')
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [showLogsModal, setShowLogsModal] = useState(false)
  const [selectedTakeHomeForLogs, setSelectedTakeHomeForLogs] = useState<string | null>(null)
  const [notification, setNotification] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    candidateName: '',
    candidateEmail: '',
    challenge: '',
    availableDays: 7,
    durationHours: 4,
    additionalInstructions: '',
  })

  // Poll take-homes directly - server provides complete state
  const {
    takeHomes,
    hasInProgressTakeHomes,
    lastUpdated,
    isLoading: initialLoading,
  } = useTakeHomePolling()

  // Operation polling is only used for toast notifications
  const { lastOperation } = useOperationPolling({
    filterPrefix: 'TAKEHOME#',
  })

  const [challenges, setChallenges] = useState<Challenge[]>([])

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
            setFormData((prev) => ({ ...prev, challenge: data.challenges[0].id }))
          }
        }
      } else {
        console.warn('Failed to load challenges, using fallback')
      }
    } catch (error) {
      console.error('Error loading challenges:', error)
    }
  }, [formData.challenge])

  // Load challenges on initial page load
  // (take-homes are loaded by useTakeHomePolling hook)
  useEffect(() => {
    console.log('[DEBUG] TakeHomes page: Loading challenges')
    loadChallenges()
  }, [loadChallenges])

  // Track operation completions for toast notifications only
  // Take-home list updates are handled by useTakeHomePolling
  const previousOperationRef = useRef<OperationData | null>(null)
  useEffect(() => {
    if (!lastOperation) return

    const operation = lastOperation
    const prevOperation = previousOperationRef.current

    // Only show toast for status transitions we haven't seen
    if (prevOperation?.id === operation.id && prevOperation?.status === operation.status) {
      return
    }
    previousOperationRef.current = operation

    // Show toast for completed operations
    if (operation.status === 'completed' && operation.type === 'create') {
      if (operation.result?.success) {
        setNotification(`Take-home ready for ${operation.candidateName || 'candidate'}`)
        setTimeout(() => setNotification(null), 5000)
      } else {
        setNotification(`Take-home creation failed for ${operation.candidateName || 'candidate'}`)
        setTimeout(() => setNotification(null), 5000)
      }
    } else if (operation.status === 'completed' && operation.type === 'destroy') {
      if (operation.result?.success) {
        setNotification(`Take-home destroyed for ${operation.candidateName || 'candidate'}`)
        setTimeout(() => setNotification(null), 5000)
      }
    } else if (operation.status === 'failed') {
      setNotification(
        `Operation failed for ${operation.candidateName || 'candidate'}: ${operation.result?.error || 'Unknown error'}`,
      )
      setTimeout(() => setNotification(null), 7000)
    }
  }, [lastOperation])

  const handleDeleteTakeHome = async (takeHomeId: string) => {
    const takeHome = takeHomes.find((th) => th.id === takeHomeId)
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
      console.log('[DEBUG] Sending DELETE request to:', `/api/takehomes/${takeHomeId}/delete`)
      const response = await fetch(`/api/takehomes/${takeHomeId}/delete`, {
        method: 'POST',
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to delete take-home')
      }

      setNotification('Take-home deleted successfully')
      setTimeout(() => setNotification(null), 5000)

      // Take-home will be removed automatically via polling
    } catch (error) {
      console.error('Error deleting take-home:', error)
      alert(
        `Failed to delete take-home: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  }

  const handleRevokeTakeHome = async (takeHomeId: string) => {
    const takeHome = takeHomes.find((th) => th.id === takeHomeId)
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
      console.log('[DEBUG] Sending POST request to:', `/api/takehomes/${takeHomeId}/revoke`)
      const response = await fetch(`/api/takehomes/${takeHomeId}/revoke`, {
        method: 'POST',
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to revoke take-home')
      }

      const result = await response.json()

      if (result.operationId) {
        setNotification('Take-home revocation initiated - check logs for progress')
      } else {
        setNotification('Take-home revoked successfully')
      }

      setTimeout(() => setNotification(null), 5000)

      // Take-home will be updated automatically via polling
    } catch (error) {
      console.error('Error revoking take-home:', error)
      alert(
        `Failed to revoke take-home: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
        additionalInstructions: formData.additionalInstructions.trim() || undefined,
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

      // Take-home will appear automatically via polling
    } catch (error) {
      console.error('Error creating take-home:', error)
      alert(
        `Failed to create take-home: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    } finally {
      setLoading(false)
    }
  }

  // Separate take-homes into active and history
  // Active: not completed/expired, OR revoked but still destroying
  const activeTakeHomes = takeHomes.filter((th) => {
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
    (th) =>
      th.sessionStatus === 'completed' ||
      th.sessionStatus === 'expired' ||
      (th.sessionStatus === 'revoked' && th.instanceStatus !== 'destroying'),
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
              <p className="text-slate-600 mt-2">Create and manage take-home assessments</p>
            </div>
            <div className="flex items-center space-x-2">
              <div
                className={`w-2 h-2 rounded-full ${
                  hasInProgressTakeHomes ? 'bg-blue-500 animate-pulse' : 'bg-green-500'
                }`}
              ></div>
              <span className="text-sm text-slate-600">
                {hasInProgressTakeHomes ? 'Active' : 'Idle'}
                {lastUpdated && (
                  <span className="ml-2 text-slate-400">
                    Updated {lastUpdated.toLocaleTimeString()}
                  </span>
                )}
              </span>
            </div>
          </div>
        </header>

        <div className="mb-6 flex flex-wrap gap-3 items-center">
          <button onClick={() => setShowCreateForm(true)} className="btn-primary">
            Create New Take-Home
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="mb-6">
          <div className="border-b border-slate-200">
            <nav className="-mb-px flex space-x-8">
              <button
                onClick={() => setActiveTab('active')}
                className={`py-2 px-1 border-b-2 font-medium text-sm whitespace-nowrap cursor-pointer ${
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
                className={`py-2 px-1 border-b-2 font-medium text-sm whitespace-nowrap cursor-pointer ${
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
          <CreateTakeHomeModal
            formData={formData}
            setFormData={setFormData}
            challenges={challenges}
            loading={loading}
            onCreate={handleCreateTakeHome}
            onCancel={() => setShowCreateForm(false)}
          />
        )}

        {/* Active Tab */}
        {activeTab === 'active' && (
          <ActiveTakeHomesTable
            takeHomes={activeTakeHomes}
            challenges={challenges}
            initialLoading={initialLoading}
            onRevoke={handleRevokeTakeHome}
            onShowLogs={(takeHomeId) => {
              setSelectedTakeHomeForLogs(takeHomeId)
              setShowLogsModal(true)
            }}
          />
        )}

        {/* History Tab */}
        {activeTab === 'history' && (
          <HistoryTakeHomesTable
            takeHomes={historicalTakeHomes}
            challenges={challenges}
            initialLoading={initialLoading}
            onDownloadFiles={handleDownloadFiles}
            onDelete={handleDeleteTakeHome}
            onShowLogs={(takeHomeId) => {
              setSelectedTakeHomeForLogs(takeHomeId)
              setShowLogsModal(true)
            }}
          />
        )}

        {/* Logs Modal */}
        {showLogsModal && (
          <TakeHomeLogsModal
            selectedTakeHomeForLogs={selectedTakeHomeForLogs}
            onClose={() => {
              setShowLogsModal(false)
              setSelectedTakeHomeForLogs(null)
            }}
          />
        )}
      </div>
    </div>
  )
}
