import { type Challenge, type TakeHome } from './types'

interface ActiveTakeHomesTableProps {
  takeHomes: TakeHome[]
  challenges: Challenge[]
  initialLoading: boolean
  onRevoke: (takeHomeId: string) => void
  onShowLogs: (takeHomeId: string) => void
}

export default function ActiveTakeHomesTable({
  takeHomes,
  challenges,
  initialLoading,
  onRevoke,
  onShowLogs,
}: ActiveTakeHomesTableProps) {
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
                <td colSpan={6} className="px-3 sm:px-6 py-4 text-center text-slate-500">
                  <div className="flex items-center justify-center space-x-2">
                    <div className="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full"></div>
                    <span>Loading take-homes...</span>
                  </div>
                </td>
              </tr>
            ) : takeHomes.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 sm:px-6 py-4 text-center text-slate-500">
                  No active take-homes
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
                    <div className="space-y-1">
                      <div>
                        <div className="text-xs text-slate-500 mb-1">Session:</div>
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
                      </div>
                      {takeHome.sessionStatus === 'activated' && (
                        <div>
                          <div className="text-xs text-slate-500 mb-1">Instance:</div>
                          <span className={`status-badge status-${takeHome.instanceStatus}`}>
                            {takeHome.instanceStatus}
                          </span>
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-sm text-slate-900">
                    <div>
                      <div className="text-xs text-slate-500">Available until:</div>
                      <div className="text-sm">
                        {new Date(takeHome.availableUntil).toLocaleString()}
                      </div>
                    </div>
                    {takeHome.activatedAt && takeHome.autoDestroyAt && (
                      <div className="bg-amber-50 p-1 rounded-md border border-amber-200 mt-1">
                        <div className="text-xs text-amber-700">Auto-destroy:</div>
                        <div className="text-xs font-medium text-amber-900">
                          {new Date(takeHome.autoDestroyAt).toLocaleString()}
                        </div>
                      </div>
                    )}
                  </td>
                  <td className="px-3 sm:px-6 py-4 text-sm text-slate-900">
                    <div className="space-y-2">
                      {/* Candidate-facing page URL - always shown */}
                      <div className="text-sm">
                        <div className="text-xs text-slate-500 mb-1">Candidate Page:</div>
                        <a
                          href={`${window.location.protocol}//${window.location.host}/takehome/${takeHome.accessToken}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-700 underline break-all"
                        >
                          {`${window.location.protocol}//${window.location.host}/takehome/${takeHome.accessToken}`}
                        </a>
                      </div>

                      {/* Instance access URL - shown only when activated and active */}
                      {takeHome.sessionStatus === 'activated' &&
                        takeHome.instanceStatus === 'active' &&
                        takeHome.url && (
                          <div className="text-sm pt-2 border-t border-slate-200">
                            <div className="text-xs text-slate-500 mb-1">Instance Access:</div>
                            <a
                              className="text-blue-600 underline cursor-pointer break-all hover:text-blue-700 transition-colors"
                              href={takeHome.url}
                              target="_blank"
                            >
                              {takeHome.url}
                            </a>
                            <div className="text-slate-500 break-all mt-1">
                              Password: {takeHome.password}
                            </div>
                          </div>
                        )}
                    </div>
                  </td>
                  <td className="px-3 sm:px-6 py-4 text-sm font-medium">
                    <div className="flex flex-wrap gap-2 items-center">
                      <button
                        onClick={() => onRevoke(takeHome.id)}
                        disabled={takeHome.instanceStatus === 'destroying'}
                        className="btn-danger text-sm px-3 py-1 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {takeHome.instanceStatus === 'destroying' ? 'Destroying...' : 'Revoke'}
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
