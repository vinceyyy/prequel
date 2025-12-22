'use client'

import { useState } from 'react'
import { useApiKeyPolling, type ApiKeyData } from '@/hooks/usePolling'

const DURATION_OPTIONS = [
  { value: 3600, label: '1 hour' },
  { value: 7200, label: '2 hours' },
  { value: 14400, label: '4 hours' },
  { value: 28800, label: '8 hours' },
  { value: 86400, label: '24 hours' },
  { value: 259200, label: '3 days' },
  { value: 604800, label: '7 days' },
]

const AVAILABLE_DAYS_OPTIONS = [
  { value: 1, label: '1 day' },
  { value: 3, label: '3 days' },
  { value: 7, label: '7 days' },
  { value: 14, label: '14 days' },
  { value: 30, label: '30 days' },
]

function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString()
}

export default function ApiKeysPage() {
  const [activeTab, setActiveTab] = useState<'active' | 'history'>('active')
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [notification, setNotification] = useState<string | null>(null)
  const [showInfoBanner, setShowInfoBanner] = useState(true)

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    activationMode: 'immediate' as 'immediate' | 'scheduled' | 'recipient',
    durationSeconds: 14400,
    scheduledAt: '',
    availableDays: 7,
  })

  const {
    apiKeys,
    activeCount,
    orphanCheckFailed,
    lastUpdated,
    isLoading: initialLoading,
    refresh,
  } = useApiKeyPolling()

  // Separate keys into active and history
  const activeKeys = apiKeys.filter(k =>
    ['scheduled', 'available', 'active', 'orphan'].includes(k.status)
  )
  const historicalKeys = apiKeys.filter(k =>
    ['expired', 'revoked', 'error'].includes(k.status)
  )

  const handleCreateKey = async () => {
    if (!formData.name.trim()) return

    setLoading(true)
    try {
      const requestBody: Record<string, unknown> = {
        name: formData.name.trim(),
        description: formData.description.trim() || undefined,
        activationMode: formData.activationMode,
        durationSeconds: formData.durationSeconds,
      }

      if (formData.activationMode === 'scheduled') {
        requestBody.scheduledAt = formData.scheduledAt
      } else if (formData.activationMode === 'recipient') {
        requestBody.availableDays = formData.availableDays
      }

      const response = await fetch('/api/apikeys/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to create API key')
      }

      const result = await response.json()

      setFormData({
        name: '',
        description: '',
        activationMode: 'immediate',
        durationSeconds: 14400,
        scheduledAt: '',
        availableDays: 7,
      })
      setShowCreateForm(false)

      if (formData.activationMode === 'immediate') {
        setNotification(
          `API key created: ${result.apiKey.apiKey?.substring(0, 20)}...`
        )
      } else if (formData.activationMode === 'recipient') {
        setNotification(`Shareable API key created for "${formData.name}"`)
      } else {
        setNotification(`API key scheduled for ${formData.scheduledAt}`)
      }
      setTimeout(() => setNotification(null), 5000)
    } catch (error) {
      setNotification(
        `Failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
      setTimeout(() => setNotification(null), 5000)
    } finally {
      setLoading(false)
    }
  }

  const handleRevoke = async (key: ApiKeyData) => {
    const message =
      key.status === 'orphan'
        ? `Delete this orphan service account (${key.name})?`
        : `Revoke API key "${key.name}"? This will immediately delete the key from OpenAI.`

    if (!confirm(message)) return

    setRevokingId(key.id)
    try {
      const response = await fetch(`/api/apikeys/${key.id}/revoke`, {
        method: 'POST',
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to revoke')
      }

      setNotification(
        key.status === 'orphan' ? 'Orphan deleted' : 'API key revoked'
      )
      setTimeout(() => setNotification(null), 3000)

      // Refresh the list immediately
      await refresh()
    } catch (error) {
      setNotification(
        `Failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
      setTimeout(() => setNotification(null), 5000)
    } finally {
      setRevokingId(null)
    }
  }

  const handleDelete = async (key: ApiKeyData) => {
    if (!confirm(`Delete "${key.name}" from history?`)) return

    try {
      const response = await fetch(`/api/apikeys/${key.id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('Failed to delete')
      }

      setNotification('Deleted from history')
      setTimeout(() => setNotification(null), 3000)
    } catch (error) {
      setNotification(
        `Failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
      setTimeout(() => setNotification(null), 5000)
    }
  }

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'scheduled':
        return 'bg-purple-100 text-purple-800'
      case 'available':
        return 'bg-blue-100 text-blue-800'
      case 'active':
        return 'bg-green-100 text-green-800'
      case 'expired':
        return 'bg-slate-100 text-slate-800'
      case 'revoked':
        return 'bg-red-100 text-red-800'
      case 'error':
        return 'bg-red-100 text-red-800'
      case 'orphan':
        return 'bg-orange-100 text-orange-800'
      default:
        return 'bg-slate-100 text-slate-800'
    }
  }

  const getSourceBadgeClass = (source: string) => {
    switch (source) {
      case 'standalone':
        return 'bg-slate-100 text-slate-600'
      case 'interview':
        return 'bg-blue-50 text-blue-600'
      case 'takehome':
        return 'bg-purple-50 text-purple-600'
      default:
        return 'bg-slate-100 text-slate-600'
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-8 w-full overflow-x-hidden">
      {notification && (
        <div
          className={`fixed top-4 right-4 text-white px-6 py-3 rounded-xl shadow-lg z-50 fade-in ${
            notification.includes('Failed') ? 'bg-red-600' : 'bg-green-600'
          }`}
        >
          {notification}
        </div>
      )}

      <div className="max-w-7xl mx-auto w-full">
        <header className="mb-8">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-3xl font-bold text-slate-900">API Keys</h1>
              <p className="text-slate-600 mt-2">
                Provision and manage temporary OpenAI API keys
              </p>
            </div>
            <div className="flex items-center space-x-4">
              <div className="bg-blue-100 text-blue-800 px-4 py-2 rounded-lg font-medium">
                {activeCount} Active {activeCount === 1 ? 'Key' : 'Keys'}
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 rounded-full bg-green-500"></div>
                <span className="text-sm text-slate-600">
                  {lastUpdated && `Updated ${lastUpdated.toLocaleTimeString()}`}
                </span>
              </div>
            </div>
          </div>
        </header>

        {/* Info Banner */}
        {showInfoBanner && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-medium text-blue-900">About API Keys</h3>
                <p className="text-sm text-blue-800 mt-1">
                  Create temporary OpenAI API keys for candidates or testing.
                  All keys share the same rate limit.
                </p>
                <ul className="text-sm text-blue-800 mt-2 list-disc list-inside">
                  <li>Maximum duration: 7 days</li>
                  <li>Keys are automatically deleted when expired</li>
                  <li>Cost limits: [placeholder]</li>
                </ul>
              </div>
              <button
                onClick={() => setShowInfoBanner(false)}
                className="text-blue-600 hover:text-blue-800"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {orphanCheckFailed && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-6 text-sm text-amber-800">
            Could not check for orphan keys. OpenAI API may be temporarily
            unavailable.
          </div>
        )}

        <div className="mb-6">
          <button
            onClick={() => setShowCreateForm(true)}
            className="btn-primary"
          >
            Create New API Key
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="mb-6">
          <div className="border-b border-slate-200">
            <nav className="-mb-px flex space-x-8">
              <button
                onClick={() => setActiveTab('active')}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'active'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                Active Keys
                {activeKeys.length > 0 && (
                  <span className="ml-2 bg-blue-100 text-blue-600 text-xs px-2 py-1 rounded-full">
                    {activeKeys.length}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'history'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                History
                {historicalKeys.length > 0 && (
                  <span className="ml-2 bg-slate-100 text-slate-600 text-xs px-2 py-1 rounded-full">
                    {historicalKeys.length}
                  </span>
                )}
              </button>
            </nav>
          </div>
        </div>

        {/* Create Form Modal */}
        {showCreateForm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="card p-6 w-full max-w-md fade-in">
              <h2 className="text-xl font-semibold mb-4 text-slate-900">
                Create New API Key
              </h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-900 mb-1">
                    Name *
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={e =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    className="input-field"
                    placeholder="e.g., Test Key for John"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-900 mb-1">
                    Description (optional)
                  </label>
                  <input
                    type="text"
                    value={formData.description}
                    onChange={e =>
                      setFormData({ ...formData, description: e.target.value })
                    }
                    className="input-field"
                    placeholder="Optional description"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-900 mb-2">
                    Activation Mode
                  </label>
                  <div className="space-y-2">
                    {[
                      { value: 'immediate', label: 'Provision immediately' },
                      { value: 'scheduled', label: 'Schedule for later' },
                      { value: 'recipient', label: 'Let recipient activate' },
                    ].map(option => (
                      <label key={option.value} className="flex items-center">
                        <input
                          type="radio"
                          name="activationMode"
                          value={option.value}
                          checked={formData.activationMode === option.value}
                          onChange={e =>
                            setFormData({
                              ...formData,
                              activationMode: e.target
                                .value as typeof formData.activationMode,
                            })
                          }
                          className="mr-2"
                        />
                        <span className="text-sm text-slate-700">
                          {option.label}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                {formData.activationMode === 'scheduled' && (
                  <div>
                    <label className="block text-sm font-medium text-slate-900 mb-1">
                      Scheduled Time
                    </label>
                    <input
                      type="datetime-local"
                      value={formData.scheduledAt}
                      onChange={e =>
                        setFormData({
                          ...formData,
                          scheduledAt: e.target.value,
                        })
                      }
                      className="input-field"
                    />
                  </div>
                )}

                {formData.activationMode === 'recipient' && (
                  <div>
                    <label className="block text-sm font-medium text-slate-900 mb-1">
                      Available For
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
                      {AVAILABLE_DAYS_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-slate-900 mb-1">
                    Duration
                  </label>
                  <select
                    value={formData.durationSeconds}
                    onChange={e =>
                      setFormData({
                        ...formData,
                        durationSeconds: parseInt(e.target.value),
                      })
                    }
                    className="input-field"
                  >
                    {DURATION_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={handleCreateKey}
                  disabled={!formData.name.trim() || loading}
                  className="flex-1 btn-primary disabled:opacity-50"
                >
                  {loading ? 'Creating...' : 'Create API Key'}
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
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                      Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                      Source
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                      Created
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                      Expires
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-200">
                  {initialLoading ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-6 py-4 text-center text-slate-500"
                      >
                        Loading...
                      </td>
                    </tr>
                  ) : activeKeys.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-6 py-4 text-center text-slate-500"
                      >
                        No active API keys
                      </td>
                    </tr>
                  ) : (
                    activeKeys.map(key => (
                      <tr
                        key={key.id}
                        className={
                          key.status === 'orphan' ? 'bg-orange-50' : ''
                        }
                      >
                        <td className="px-6 py-4">
                          <div className="text-sm font-medium text-slate-900">
                            {key.status === 'orphan' && (
                              <span className="mr-1">⚠️</span>
                            )}
                            {key.name}
                          </div>
                          {key.description && (
                            <div className="text-sm text-slate-500">
                              {key.description}
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <span
                            className={`status-badge ${getStatusBadgeClass(key.status)}`}
                          >
                            {key.status}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span
                            className={`text-xs px-2 py-1 rounded ${getSourceBadgeClass(key.source)}`}
                          >
                            {key.source}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-900">
                          {formatDate(key.createdAt)}
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-900">
                          {key.expiresAt ? formatDate(key.expiresAt) : '-'}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex gap-2">
                            {key.source === 'standalone' &&
                              key.accessToken &&
                              key.status === 'available' && (
                                <button
                                  onClick={() => {
                                    const url = `${window.location.origin}/apikey/${key.accessToken}`
                                    navigator.clipboard.writeText(url)
                                    setNotification('Link copied!')
                                    setTimeout(
                                      () => setNotification(null),
                                      2000
                                    )
                                  }}
                                  className="btn-primary text-sm px-3 py-1"
                                >
                                  Copy Link
                                </button>
                              )}
                            {(key.source === 'standalone' ||
                              key.status === 'orphan') && (
                              <button
                                onClick={() => handleRevoke(key)}
                                disabled={revokingId === key.id}
                                className="btn-danger text-sm px-3 py-1 disabled:opacity-50"
                              >
                                {revokingId === key.id
                                  ? 'Deleting...'
                                  : key.status === 'orphan'
                                    ? 'Delete'
                                    : 'Revoke'}
                              </button>
                            )}
                            {key.source === 'interview' && key.sourceId && (
                              <a
                                href="/interviews"
                                className="text-blue-600 text-sm hover:underline"
                              >
                                View Interview
                              </a>
                            )}
                            {key.source === 'takehome' && key.sourceId && (
                              <a
                                href="/takehomes"
                                className="text-blue-600 text-sm hover:underline"
                              >
                                View Take-home
                              </a>
                            )}
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
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                      Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                      Source
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                      Created
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                      Expired
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-200">
                  {historicalKeys.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-6 py-4 text-center text-slate-500"
                      >
                        No historical API keys
                      </td>
                    </tr>
                  ) : (
                    historicalKeys.map(key => (
                      <tr key={key.id}>
                        <td className="px-6 py-4">
                          <div className="text-sm font-medium text-slate-900">
                            {key.name}
                          </div>
                          {key.description && (
                            <div className="text-sm text-slate-500">
                              {key.description}
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <span
                            className={`status-badge ${getStatusBadgeClass(key.status)}`}
                          >
                            {key.status}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span
                            className={`text-xs px-2 py-1 rounded ${getSourceBadgeClass(key.source)}`}
                          >
                            {key.source}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-900">
                          {formatDate(key.createdAt)}
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-900">
                          {key.expiredAt ? formatDate(key.expiredAt) : '-'}
                        </td>
                        <td className="px-6 py-4">
                          {key.source === 'standalone' && (
                            <button
                              onClick={() => handleDelete(key)}
                              className="btn-outline text-sm px-3 py-1"
                            >
                              Delete
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
