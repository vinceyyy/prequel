'use client'

import React, { useState } from 'react'

interface CleanupSummary {
  workspacesFound: number
  workspacesDestroyed: number
  workspacesSkipped: number
  workspacesErrored: number
  danglingResourcesFound: number
  danglingResourcesCleaned: number
}

interface WorkspaceResult {
  interviewId: string
  status: 'destroyed' | 'skipped' | 'error'
  reason?: string
  error?: string
}

interface CleanupResult {
  success: boolean
  error?: string
  summary: CleanupSummary
  details: string[]
  workspaceResults: WorkspaceResult[]
}

interface DanglingResources {
  totalWorkspaces: number
  existingInterviews: number
  danglingWorkspaces: number
  workspaces: string[]
  existingInterviewsList: string[]
  danglingWorkspacesList: string[]
}

export default function CleanupDashboard() {
  const [loading, setLoading] = useState(false)
  const [danglingResources, setDanglingResources] =
    useState<DanglingResources | null>(null)
  const [cleanupResult, setCleanupResult] = useState<CleanupResult | null>(null)
  const [showDetails, setShowDetails] = useState(false)

  const loadDanglingResources = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/admin/cleanup')
      const data = await response.json()

      if (data.success) {
        setDanglingResources(data.data)
      } else {
        alert(`Error: ${data.error}`)
      }
    } catch (error) {
      alert(
        `Error loading resources: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      )
    } finally {
      setLoading(false)
    }
  }

  const performCleanup = async (options: {
    dryRun?: boolean
    forceDestroy?: boolean
    maxConcurrency?: number
    timeout?: number
  }) => {
    const {
      dryRun = false,
      forceDestroy = false,
      maxConcurrency = 3,
      timeout = 300,
    } = options

    if (
      !dryRun &&
      !confirm(
        `This will ${
          forceDestroy
            ? 'destroy ALL workspaces including active interviews'
            : 'destroy dangling workspaces'
        }. Are you sure?`
      )
    ) {
      return
    }

    setLoading(true)
    setCleanupResult(null)

    try {
      const params = new URLSearchParams({
        dryRun: dryRun.toString(),
        forceDestroy: forceDestroy.toString(),
        maxConcurrency: maxConcurrency.toString(),
        timeout: timeout.toString(),
      })

      const response = await fetch(`/api/admin/cleanup?${params}`, {
        method: 'POST',
      })

      const data = await response.json()
      setCleanupResult(data)

      // Refresh dangling resources after cleanup
      if (!dryRun) {
        setTimeout(() => {
          loadDanglingResources()
        }, 1000)
      }
    } catch (error) {
      alert(
        `Error during cleanup: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">
          AWS Resource Cleanup
        </h2>
        <button
          onClick={loadDanglingResources}
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Loading...' : 'Scan for Dangling Resources'}
        </button>
      </div>

      <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4">
        <div className="flex">
          <div className="flex-shrink-0">
            <svg
              className="h-5 w-5 text-yellow-400"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <div className="ml-3">
            <h3 className="text-sm font-medium text-yellow-800">Important</h3>
            <div className="mt-2 text-sm text-yellow-700">
              <p>
                This tool cleans up AWS resources and terraform workspaces that
                may be left behind due to failed operations. Use with caution in
                production environments.
              </p>
            </div>
          </div>
        </div>
      </div>

      {danglingResources && (
        <div className="bg-white shadow rounded-lg p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">
            Resource Overview
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="text-center p-4 bg-blue-50 rounded-lg">
              <div className="text-2xl font-bold text-blue-600">
                {danglingResources.totalWorkspaces || 0}
              </div>
              <div className="text-sm text-gray-600">Total Workspaces</div>
            </div>
            <div className="text-center p-4 bg-green-50 rounded-lg">
              <div className="text-2xl font-bold text-green-600">
                {danglingResources.existingInterviews || 0}
              </div>
              <div className="text-sm text-gray-600">Active Interviews</div>
            </div>
            <div className="text-center p-4 bg-red-50 rounded-lg">
              <div className="text-2xl font-bold text-red-600">
                {danglingResources.danglingWorkspaces || 0}
              </div>
              <div className="text-sm text-gray-600">Dangling Workspaces</div>
            </div>
          </div>

          {danglingResources.danglingWorkspaces > 0 && (
            <div className="mt-6">
              <h4 className="text-md font-medium text-gray-900 mb-3">
                Dangling Workspaces
              </h4>
              <div className="max-h-40 overflow-y-auto bg-gray-50 rounded-md p-3">
                {danglingResources.danglingWorkspacesList?.map(
                  (workspaceId, index) => (
                    <div
                      key={index}
                      className="text-sm text-gray-700 font-mono"
                    >
                      {workspaceId}
                    </div>
                  )
                )}
              </div>
            </div>
          )}

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              onClick={() => performCleanup({ dryRun: true })}
              disabled={loading}
              className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Preview Cleanup (Dry Run)
            </button>

            {danglingResources.danglingWorkspaces > 0 && (
              <button
                onClick={() => performCleanup({})}
                disabled={loading}
                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Clean Dangling Resources
              </button>
            )}

            {danglingResources.existingInterviews > 0 && (
              <button
                onClick={() => performCleanup({ forceDestroy: true })}
                disabled={loading}
                className="px-4 py-2 bg-red-800 text-white rounded-md hover:bg-red-900 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Force Clean All Resources
              </button>
            )}
          </div>
        </div>
      )}

      {cleanupResult && (
        <div className="bg-white shadow rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium text-gray-900">
              Cleanup Results
            </h3>
            <span
              className={`px-3 py-1 rounded-full text-sm font-medium ${
                cleanupResult.success
                  ? 'bg-green-100 text-green-800'
                  : 'bg-red-100 text-red-800'
              }`}
            >
              {cleanupResult.success ? 'Success' : 'Partial Failure'}
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
            <div className="text-center p-3 bg-gray-50 rounded-lg">
              <div className="text-lg font-bold text-gray-800">
                {cleanupResult.summary.workspacesFound}
              </div>
              <div className="text-xs text-gray-600">Found</div>
            </div>
            <div className="text-center p-3 bg-green-50 rounded-lg">
              <div className="text-lg font-bold text-green-600">
                {cleanupResult.summary.workspacesDestroyed}
              </div>
              <div className="text-xs text-gray-600">Destroyed</div>
            </div>
            <div className="text-center p-3 bg-yellow-50 rounded-lg">
              <div className="text-lg font-bold text-yellow-600">
                {cleanupResult.summary.workspacesSkipped}
              </div>
              <div className="text-xs text-gray-600">Skipped</div>
            </div>
            <div className="text-center p-3 bg-red-50 rounded-lg">
              <div className="text-lg font-bold text-red-600">
                {cleanupResult.summary.workspacesErrored}
              </div>
              <div className="text-xs text-gray-600">Errors</div>
            </div>
            <div className="text-center p-3 bg-blue-50 rounded-lg">
              <div className="text-lg font-bold text-blue-600">
                {cleanupResult.summary.danglingResourcesFound}
              </div>
              <div className="text-xs text-gray-600">Dangling</div>
            </div>
            <div className="text-center p-3 bg-green-50 rounded-lg">
              <div className="text-lg font-bold text-green-600">
                {cleanupResult.summary.danglingResourcesCleaned}
              </div>
              <div className="text-xs text-gray-600">Cleaned</div>
            </div>
          </div>

          {cleanupResult.error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-700">{cleanupResult.error}</p>
            </div>
          )}

          <div className="mb-4">
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="text-blue-600 hover:text-blue-800 text-sm font-medium"
            >
              {showDetails ? 'Hide Details' : 'Show Details'}
            </button>
          </div>

          {showDetails && (
            <div className="space-y-4">
              <div>
                <h4 className="text-md font-medium text-gray-900 mb-2">
                  Execution Log
                </h4>
                <div className="max-h-60 overflow-y-auto bg-gray-900 text-green-400 text-sm font-mono p-3 rounded-md">
                  {cleanupResult.details.map((detail, index) => (
                    <div key={index}>{detail}</div>
                  ))}
                </div>
              </div>

              {cleanupResult.workspaceResults.length > 0 && (
                <div>
                  <h4 className="text-md font-medium text-gray-900 mb-2">
                    Individual Results
                  </h4>
                  <div className="max-h-60 overflow-y-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Interview ID
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Status
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Details
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {cleanupResult.workspaceResults.map((result, index) => (
                          <tr key={index}>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-900">
                              {result.interviewId}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span
                                className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                                  result.status === 'destroyed'
                                    ? 'bg-green-100 text-green-800'
                                    : result.status === 'skipped'
                                      ? 'bg-yellow-100 text-yellow-800'
                                      : 'bg-red-100 text-red-800'
                                }`}
                              >
                                {result.status}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-500">
                              {result.reason || result.error || '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
