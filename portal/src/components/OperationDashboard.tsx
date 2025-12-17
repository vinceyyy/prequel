'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

interface Operation {
  id: string
  type: 'create' | 'destroy'
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  interviewId: string
  candidateName?: string
  challenge?: string
  createdAt?: string // When the operation was scheduled/created
  startedAt?: string // Legacy field for backward compatibility
  executionStartedAt?: string // When execution actually began
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
  const [cancellingOperations, setCancellingOperations] = useState<Set<string>>(
    new Set()
  )
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

  const cancelOperation = async (operationId: string) => {
    setCancellingOperations(prev => new Set(prev).add(operationId))
    try {
      const response = await fetch(`/api/operations/${operationId}/cancel`, {
        method: 'POST',
      })

      if (response.ok) {
        // Refresh operations to see the updated status
        await loadOperations()
      } else {
        const data = await response.json()
        console.error('Failed to cancel operation:', data.error)
        alert(`Failed to cancel operation: ${data.error}`)
      }
    } catch (error) {
      console.error('Error cancelling operation:', error)
      alert('Error cancelling operation')
    } finally {
      setCancellingOperations(prev => {
        const newSet = new Set(prev)
        newSet.delete(operationId)
        return newSet
      })
    }
  }

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

  // Poll logs for active operations
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
        }, 3000) // Poll every 3 seconds for active operations
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
      case 'cancelled':
        return '🚫'
      default:
        return '❓'
    }
  }

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  const formatLogTimestamp = (logLine: string) => {
    // Log format: [2024-01-15T09:00:00Z] Message
    const timestampMatch = logLine.match(/^\[([^\]]+)\](.*)$/)
    if (timestampMatch) {
      const utcTimestamp = timestampMatch[1]
      const message = timestampMatch[2]
      try {
        const localTime = new Date(utcTimestamp).toLocaleString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
        return `[${localTime}]${message}`
      } catch {
        // If timestamp parsing fails, return original
        return logLine
      }
    }
    return logLine
  }

  const getDuration = (executionStartedAt?: string, completedAt?: string) => {
    if (!executionStartedAt) {
      return 'Not started'
    }

    const start = new Date(executionStartedAt)
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
    <div className={`card ${className}`}>
      <div className="p-6 border-b border-slate-200 flex justify-between items-center">
        <h2 className="text-xl font-semibold text-slate-900">
          {interviewFilter
            ? `Operations for Interview ${interviewFilter}`
            : 'All Operations'}
        </h2>
        <button
          onClick={loadOperations}
          className="btn-secondary text-sm px-3 py-1"
        >
          Refresh
        </button>
      </div>

      <div className="flex h-[500px]">
        {/* Operations List */}
        <div className="w-1/4 border-r border-slate-200 overflow-y-auto">
          {operations.length === 0 ? (
            <div className="p-4 text-slate-500 text-center">
              No operations found
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {operations.map(operation => (
                <div
                  key={operation.id}
                  className={`p-4 cursor-pointer hover:bg-slate-50 transition-colors ${
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
                      <span className="font-medium text-slate-900">
                        {operation.type === 'create' ? 'Create' : 'Destroy'}{' '}
                        Interview
                      </span>
                    </div>
                    <span className={`status-badge status-${operation.status}`}>
                      {operation.status}
                    </span>
                  </div>

                  <div className="text-sm text-slate-600 space-y-1">
                    <div>Interview ID: {operation.interviewId}</div>
                    {operation.candidateName && (
                      <div>Candidate: {operation.candidateName}</div>
                    )}
                    {operation.challenge && (
                      <div>Challenge: {operation.challenge}</div>
                    )}
                    <div>
                      Created:{' '}
                      {formatTime(
                        operation.createdAt ||
                          operation.startedAt ||
                          new Date().toISOString()
                      )}
                    </div>
                    {operation.executionStartedAt && (
                      <div>
                        Execution started:{' '}
                        {formatTime(operation.executionStartedAt)}
                      </div>
                    )}
                    <div>
                      Duration:{' '}
                      {getDuration(
                        operation.executionStartedAt,
                        operation.completedAt
                      )}
                    </div>
                  </div>

                  <div className="mt-2 flex items-center justify-between">
                    {operation.result?.accessUrl && (
                      <a
                        href={operation.result.accessUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800 text-sm transition-colors"
                        onClick={e => e.stopPropagation()}
                      >
                        🔗 Access Interview
                      </a>
                    )}

                    {(operation.status === 'pending' ||
                      operation.status === 'running') && (
                      <button
                        onClick={e => {
                          e.stopPropagation()
                          cancelOperation(operation.id)
                        }}
                        disabled={cancellingOperations.has(operation.id)}
                        className="text-red-600 hover:text-red-800 text-sm px-2 py-1 rounded-md border border-red-200 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {cancellingOperations.has(operation.id)
                          ? 'Cancelling...'
                          : 'Cancel'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Logs Panel */}
        <div className="w-3/4 flex flex-col">
          <div className="p-4 border-b border-slate-200 bg-slate-50">
            <h3 className="font-medium text-slate-900">
              {selectedOperation
                ? 'Operation Logs'
                : 'Select an operation to view logs'}
            </h3>
          </div>

          <div className="flex-1 p-4 flex flex-col overflow-y-scroll">
            {selectedOperation ? (
              <div
                ref={terminalRef}
                className="bg-slate-900 text-green-400 p-4 rounded-md font-mono text-sm whitespace-pre-wrap"
              >
                {logs.length > 0
                  ? logs.map(formatLogTimestamp).join('\n')
                  : 'No logs available yet...'}
              </div>
            ) : (
              <div className="flex items-center justify-center flex-1 text-slate-500">
                Select an operation to view its logs
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
