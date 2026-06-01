import { type Challenge, type TakeHome } from './types'

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

interface HistoryTakeHomesTableProps {
  takeHomes: TakeHome[]
  challenges: Challenge[]
  initialLoading: boolean
  onDownloadFiles: (takeHomeId: string) => void
  onDelete: (takeHomeId: string) => void
  onShowLogs: (takeHomeId: string) => void
}

export default function HistoryTakeHomesTable({
  takeHomes,
  challenges,
  initialLoading,
  onDownloadFiles,
  onDelete,
  onShowLogs,
}: HistoryTakeHomesTableProps) {
  return (
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
                <td colSpan={7} className="px-3 sm:px-6 py-4 text-center text-slate-500">
                  <div className="flex items-center justify-center space-x-2">
                    <div className="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full"></div>
                    <span>Loading history...</span>
                  </div>
                </td>
              </tr>
            ) : takeHomes.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 sm:px-6 py-4 text-center text-slate-500">
                  No historical take-homes found
                </td>
              </tr>
            ) : (
              takeHomes.map((takeHome) => (
                <tr key={takeHome.id}>
                  <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-slate-900">
                      {takeHome.candidateName || 'Unknown'}
                    </div>
                    {takeHome.candidateEmail && (
                      <div className="text-sm text-slate-500">{takeHome.candidateEmail}</div>
                    )}
                  </td>
                  <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-sm text-slate-900">
                    {challenges.find((c) => c.id === takeHome.challengeId)?.name}
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
                    <div>{new Date(takeHome.createdAt).toLocaleDateString()}</div>
                    <div className="text-slate-500">
                      {new Date(takeHome.createdAt).toLocaleTimeString()}
                    </div>
                  </td>
                  <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-sm text-slate-900">
                    {takeHome.activatedAt ? (
                      <div>
                        <div>{new Date(takeHome.activatedAt).toLocaleDateString()}</div>
                        <div className="text-slate-500">
                          {new Date(takeHome.activatedAt).toLocaleTimeString()}
                        </div>
                      </div>
                    ) : (
                      <span className="text-slate-400">Not activated</span>
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
                          onClick={() => onDownloadFiles(takeHome.id)}
                          className="btn-primary text-sm px-3 py-1"
                        >
                          Download
                        </button>
                      )}
                      <button
                        onClick={() => onDelete(takeHome.id)}
                        className="btn-outline text-sm px-3 py-1"
                      >
                        Delete
                      </button>
                      <button
                        onClick={() => onShowLogs(takeHome.id)}
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
  )
}
