'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

interface Operation {
  id: string
  type: 'create' | 'destroy'
  status: 'pending' | 'running' | 'completed' | 'failed'
  interviewId: string
  candidateName?: string
  scenario?: string
  startedAt: string
  completedAt?: string
  logs: string[]
  result?: {
    success: boolean
    accessUrl?: string
    error?: string
    fullOutput?: string
  }
}

interface OperationDashboardProps {
  interviewFilter?: string | null // If provided, only show operations for this interview
  className?: string
}

export default function OperationDashboard({
  interviewFilter,
  className = '',
}: OperationDashboardProps) {
  const [operations, setOperations] = useState<Operation[]>([])
  const [selectedOperation, setSelectedOperation] = useState<string | null>(
    null
  )
  const [logs, setLogs] = useState<string[]>([])
  const terminalRef = useRef<HTMLDivElement>(null)
  const pollInterval = useRef<NodeJS.Timeout | null>(null)
  const logsPollInterval = useRef<NodeJS.Timeout | null>(null)

  const loadOperations = useCallback(async () => {
    try {
      const url = interviewFilter
        ? `/api/operations?interviewId=${interviewFilter}`
        : '/api/operations'
      const response = await fetch(url)
      if (response.ok) {
        const data = await response.json()
        setOperations(data.operations || [])
      }
    } catch (error) {
      console.error('Failed to load operations:', error)
    }
  }, [interviewFilter])

  const loadOperationLogs = useCallback(async (operationId: string) => {
    try {
      const response = await fetch(`/api/operations/${operationId}/logs`)
      if (response.ok) {
        const data = await response.json()
        const newLogs = data.logs || []

        // Use functional update to avoid dependency issues
        setLogs(currentLogs => {
          // Only update if logs actually changed to prevent flickering
          if (JSON.stringify(newLogs) !== JSON.stringify(currentLogs)) {
            return newLogs
          }
          return currentLogs
        })
      }
    } catch (error) {
      console.error('Failed to load operation logs:', error)
    }
  }, [])

  useEffect(() => {
    loadOperations()
  }, [interviewFilter, loadOperations])

  // Only poll when there are running or pending operations
  useEffect(() => {
    const hasActiveOperations = operations.some(
      op => op.status === 'running' || op.status === 'pending'
    )

    if (hasActiveOperations) {
      console.log(
        '[DEBUG] OperationDashboard: Active operations detected, starting operations polling...'
      )
      pollInterval.current = setInterval(loadOperations, 3000)
    } else {
      if (pollInterval.current) {
        console.log(
          '[DEBUG] OperationDashboard: No active operations, stopping polling'
        )
        clearInterval(pollInterval.current)
        pollInterval.current = null
      }
    }

    return () => {
      if (pollInterval.current) {
        clearInterval(pollInterval.current)
        pollInterval.current = null
      }
    }
  }, [operations, loadOperations])

  useEffect(() => {
    if (selectedOperation) {
      loadOperationLogs(selectedOperation)
    }

    return () => {
      if (logsPollInterval.current) {
        clearInterval(logsPollInterval.current)
        logsPollInterval.current = null
      }
    }
  }, [selectedOperation, loadOperationLogs])

  // Only poll logs when the selected operation is running or pending
  useEffect(() => {
    if (selectedOperation) {
      const operation = operations.find(op => op.id === selectedOperation)
      if (
        operation &&
        (operation.status === 'running' || operation.status === 'pending')
      ) {
        console.log(
          `[DEBUG] Starting log polling for active operation: ${selectedOperation}`
        )
        logsPollInterval.current = setInterval(() => {
          loadOperationLogs(selectedOperation)
        }, 2000)
      } else {
        if (logsPollInterval.current) {
          console.log(
            `[DEBUG] Stopping log polling for completed operation: ${selectedOperation}`
          )
          clearInterval(logsPollInterval.current)
          logsPollInterval.current = null
        }
      }
    }

    return () => {
      if (logsPollInterval.current) {
        clearInterval(logsPollInterval.current)
        logsPollInterval.current = null
      }
    }
  }, [selectedOperation, operations, loadOperationLogs])

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (terminalRef.current && logs.length > 0) {
      const element = terminalRef.current
      // Check if user is near the bottom (within 100px) - if so, auto-scroll
      // This prevents auto-scroll if user is scrolling up to read previous logs
      const isNearBottom =
        element.scrollHeight - element.scrollTop - element.clientHeight < 100

      if (isNearBottom) {
        element.scrollTop = element.scrollHeight
      }
    }
  }, [logs]) // Trigger whenever logs change

  // Always scroll to bottom when switching operations
  useEffect(() => {
    if (terminalRef.current && selectedOperation) {
      // Small delay to ensure logs are loaded
      const timer = setTimeout(() => {
        if (terminalRef.current) {
          terminalRef.current.scrollTop = terminalRef.current.scrollHeight
        }
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [selectedOperation])

  const getStatusIcon = (status: Operation['status']) => {
    switch (status) {
      case 'pending':
        return '⏳'
      case 'running':
        return '🔄'
      case 'completed':
        return '✅'
      case 'failed':
        return '❌'
      default:
        return '❓'
    }
  }

  const getStatusColor = (status: Operation['status']) => {
    switch (status) {
      case 'pending':
        return 'text-yellow-600 bg-yellow-50 border-yellow-200'
      case 'running':
        return 'text-blue-600 bg-blue-50 border-blue-200'
      case 'completed':
        return 'text-green-600 bg-green-50 border-green-200'
      case 'failed':
        return 'text-red-600 bg-red-50 border-red-200'
      default:
        return 'text-gray-600 bg-gray-50 border-gray-200'
    }
  }

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleString()
  }

  const getDuration = (startedAt: string, completedAt?: string) => {
    const start = new Date(startedAt)
    const end = completedAt ? new Date(completedAt) : new Date()
    const duration = Math.floor((end.getTime() - start.getTime()) / 1000)

    if (duration < 60) return `${duration}s`
    if (duration < 3600)
      return `${Math.floor(duration / 60)}m ${duration % 60}s`
    return `${Math.floor(duration / 3600)}h ${Math.floor(
      (duration % 3600) / 60
    )}m`
  }

  return (
    <div className={`bg-white rounded-lg shadow-md ${className}`}>
      <div className="p-6 border-b border-gray-200 flex justify-between items-center">
        <h2 className="text-xl font-semibold text-gray-900">
          {interviewFilter
            ? `Operations for Interview ${interviewFilter}`
            : 'All Operations'}
        </h2>
        <button
          onClick={loadOperations}
          className="bg-gray-600 text-white px-3 py-1 rounded text-sm hover:bg-gray-700 transition-colors"
        >
          Refresh
        </button>
      </div>

      <div className="flex h-[500px]">
        {/* Operations List */}
        <div className="w-1/4 border-r border-gray-200 overflow-y-auto">
          {operations.length === 0 ? (
            <div className="p-4 text-gray-500 text-center">
              No operations found
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {operations.map(operation => (
                <div
                  key={operation.id}
                  className={`p-4 cursor-pointer hover:bg-gray-50 transition-colors ${
                    selectedOperation === operation.id
                      ? 'bg-blue-50 border-l-4 border-blue-500'
                      : ''
                  }`}
                  onClick={() => setSelectedOperation(operation.id)}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-2">
                      <span className="text-lg">
                        {getStatusIcon(operation.status)}
                      </span>
                      <span className="font-medium text-gray-900">
                        {operation.type === 'create' ? 'Create' : 'Destroy'}{' '}
                        Interview
                      </span>
                    </div>
                    <span
                      className={`px-2 py-1 text-xs rounded-full border ${getStatusColor(
                        operation.status
                      )}`}
                    >
                      {operation.status}
                    </span>
                  </div>

                  <div className="text-sm text-gray-600 space-y-1">
                    <div>Interview ID: {operation.interviewId}</div>
                    {operation.candidateName && (
                      <div>Candidate: {operation.candidateName}</div>
                    )}
                    {operation.scenario && (
                      <div>Scenario: {operation.scenario}</div>
                    )}
                    <div>Started: {formatTime(operation.startedAt)}</div>
                    <div>
                      Duration:{' '}
                      {getDuration(operation.startedAt, operation.completedAt)}
                    </div>
                  </div>

                  {operation.result?.accessUrl && (
                    <div className="mt-2">
                      <a
                        href={operation.result.accessUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800 text-sm"
                        onClick={e => e.stopPropagation()}
                      >
                        🔗 Access Interview
                      </a>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Logs Panel */}
        <div className="w-3/4 flex flex-col">
          <div className="p-4 border-b border-gray-200 bg-gray-50">
            <h3 className="font-medium text-gray-900">
              {selectedOperation
                ? 'Operation Logs'
                : 'Select an operation to view logs'}
            </h3>
          </div>

          <div className="flex-1 p-4 flex flex-col overflow-y-scroll">
            {selectedOperation ? (
              <div
                ref={terminalRef}
                className="bg-black text-green-400 p-4 rounded-lg font-mono text-sm whitespace-pre-wrap"
              >
                {logs.length > 0 ? logs.join('\n') : 'No logs available yet...'}
              </div>
            ) : (
              <div className="flex items-center justify-center flex-1 text-gray-500">
                Select an operation to view its logs
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
