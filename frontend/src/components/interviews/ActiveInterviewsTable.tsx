import { type Challenge, type Interview } from './types'

interface ActiveInterviewsTableProps {
  interviews: Interview[]
  challenges: Challenge[]
  initialLoading: boolean
  onStop: (id: string) => void
  onCancel: (interview: Interview) => void
  onShowLogs: (id: string) => void
}

export default function ActiveInterviewsTable({
  interviews,
  challenges,
  initialLoading,
  onStop,
  onCancel,
  onShowLogs,
}: ActiveInterviewsTableProps) {
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
                Access Details
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
                    <span>Loading interviews...</span>
                  </div>
                </td>
              </tr>
            ) : interviews.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 sm:px-6 py-4 text-center text-slate-500">
                  No active interviews
                </td>
              </tr>
            ) : (
              interviews.map((interview) => (
                <tr key={interview.id}>
                  <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-slate-900">
                      {interview.candidateName}
                    </div>
                  </td>
                  <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-sm text-slate-900">
                    {challenges.find((c) => c.id === interview.challenge)?.name}
                  </td>
                  <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                    <div>
                      <span className={`status-badge status-${interview.status}`}>
                        {interview.status}
                      </span>
                      {interview.status === 'error' && (
                        <div className="text-xs text-red-600 mt-1">Resources may need cleanup</div>
                      )}
                    </div>
                  </td>
                  <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-sm text-slate-900">
                    {interview.status === 'scheduled' && interview.scheduledAt ? (
                      <div className="space-y-2">
                        <div className="bg-purple-50 p-2 rounded-md border border-purple-200">
                          <div className="text-xs font-medium text-purple-700">Starts:</div>
                          <div className="text-sm font-semibold text-purple-900">
                            {new Date(interview.scheduledAt).toLocaleString()}
                          </div>
                        </div>
                        {interview.autoDestroyAt && (
                          <div className="bg-red-50 p-2 rounded-md border border-red-200">
                            <div className="text-xs font-medium text-red-700">Auto-destroy:</div>
                            <div className="text-sm font-semibold text-red-900">
                              {new Date(interview.autoDestroyAt).toLocaleString()}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div>
                        {interview.scheduledAt && (
                          <div className="mb-1">
                            <div className="text-xs text-slate-500">Started:</div>
                            <div className="text-sm">
                              {new Date(interview.scheduledAt).toLocaleString()}
                            </div>
                          </div>
                        )}
                        {interview.autoDestroyAt && (
                          <div className="bg-amber-50 p-1 rounded-md border border-amber-200">
                            <div className="text-xs text-amber-700">Auto-destroy:</div>
                            <div className="text-xs font-medium text-amber-900">
                              {new Date(interview.autoDestroyAt).toLocaleString()}
                            </div>
                          </div>
                        )}
                        {!interview.scheduledAt && !interview.autoDestroyAt && (
                          <span className="text-slate-400">Immediate</span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-3 sm:px-6 py-4 text-sm text-slate-900">
                    {interview.status === 'scheduled' &&
                    interview.accessUrl &&
                    interview.password ? (
                      <div className="max-w-xs">
                        <div className="bg-purple-50 p-2 rounded-md border border-purple-200 mb-2">
                          <div className="text-xs text-purple-700 mb-1 flex items-center">
                            <span className="mr-1">⏰</span>
                            <span>Available at scheduled time</span>
                          </div>
                          <div className="text-blue-600 break-all font-mono text-xs">
                            {interview.accessUrl}
                          </div>
                          <div className="text-slate-700 break-all mt-1 font-mono text-xs">
                            Password: {interview.password}
                          </div>
                        </div>
                      </div>
                    ) : interview.status === 'active' && interview.accessUrl ? (
                      <div className="max-w-xs">
                        <a
                          className="text-blue-600 underline cursor-pointer break-all hover:text-blue-700 transition-colors"
                          href={interview.accessUrl}
                          target="_blank"
                        >
                          {interview.accessUrl}
                        </a>
                        <div className="text-slate-500 break-all">
                          Password: {interview.password}
                        </div>
                      </div>
                    ) : interview.status === 'configuring' ? (
                      <span className="text-slate-400">Configuring...</span>
                    ) : interview.status === 'scheduled' ? (
                      <span className="text-slate-400">Scheduled (credentials loading...)</span>
                    ) : interview.status === 'initializing' ? (
                      <span className="text-slate-400">Initializing...</span>
                    ) : (
                      <span className="text-slate-400">Not available</span>
                    )}
                  </td>
                  <td className="px-3 sm:px-6 py-4 text-sm font-medium">
                    <div className="flex flex-wrap gap-2 items-center">
                      {interview.status === 'active' && (
                        <button onClick={() => onStop(interview.id)} className="btn-danger text-sm">
                          Destroy
                        </button>
                      )}
                      {interview.status === 'scheduled' && (
                        <button onClick={() => onCancel(interview)} className="btn-danger text-sm">
                          Cancel
                        </button>
                      )}
                      {interview.status === 'initializing' && (
                        <span className="text-blue-600 font-medium">Initializing...</span>
                      )}
                      {interview.status === 'configuring' && (
                        <span className="text-amber-600 font-medium">Configuring...</span>
                      )}
                      {interview.status === 'destroying' && (
                        <span className="text-orange-600 font-medium">Destroying...</span>
                      )}
                      {interview.status === 'error' && (
                        <button
                          onClick={() => onStop(interview.id)}
                          className="btn-danger text-sm px-3 py-1"
                        >
                          Retry Destroy
                        </button>
                      )}
                      <button
                        onClick={() => onShowLogs(interview.id)}
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
