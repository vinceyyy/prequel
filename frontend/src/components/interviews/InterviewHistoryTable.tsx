import { type Challenge, type Interview } from './types'

interface InterviewHistoryTableProps {
  historicalInterviews: Interview[]
  challenges: Challenge[]
  historyLoading: boolean
  onDownload: (id: string) => void
  onDelete: (id: string) => void
  onShowLogs: (id: string) => void
}

export default function InterviewHistoryTable({
  historicalInterviews,
  challenges,
  historyLoading,
  onDownload,
  onDelete,
  onShowLogs,
}: InterviewHistoryTableProps) {
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
                Duration
              </th>
              <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                Completed
              </th>
              <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-slate-200">
            {historyLoading ? (
              <tr>
                <td colSpan={6} className="px-3 sm:px-6 py-4 text-center text-slate-500">
                  <div className="flex items-center justify-center space-x-2">
                    <div className="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full"></div>
                    <span>Loading history...</span>
                  </div>
                </td>
              </tr>
            ) : historicalInterviews.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 sm:px-6 py-4 text-center text-slate-500">
                  No historical interviews found
                </td>
              </tr>
            ) : (
              historicalInterviews.map((interview) => (
                <tr key={interview.id}>
                  <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-slate-900">
                      {interview.candidateName}
                    </div>
                    <div className="text-sm text-slate-500">
                      {new Date(interview.createdAt).toLocaleDateString()}
                    </div>
                  </td>
                  <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-sm text-slate-900">
                    {challenges.find((c) => c.id === interview.challenge)?.name ||
                      interview.challenge}
                  </td>
                  <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                    <span
                      className={`status-badge ${
                        interview.status === 'destroyed'
                          ? 'bg-green-100 text-green-800'
                          : 'status-error'
                      }`}
                    >
                      {interview.status === 'destroyed' ? 'completed' : interview.status}
                    </span>
                  </td>
                  <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-sm text-slate-900">
                    {interview.createdAt && interview.destroyedAt ? (
                      <div>
                        {Math.round(
                          (new Date(interview.destroyedAt).getTime() -
                            new Date(interview.createdAt).getTime()) /
                            (1000 * 60),
                        )}{' '}
                        minutes
                      </div>
                    ) : (
                      <span className="text-slate-400">-</span>
                    )}
                  </td>
                  <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-sm text-slate-900">
                    {interview.destroyedAt ? (
                      <div>
                        <div className="font-medium">
                          {new Date(interview.destroyedAt).toLocaleDateString()}
                        </div>
                        <div className="text-slate-500">
                          {new Date(interview.destroyedAt).toLocaleTimeString()}
                        </div>
                      </div>
                    ) : interview.completedAt ? (
                      <div>
                        <div className="font-medium">
                          {new Date(interview.completedAt).toLocaleDateString()}
                        </div>
                        <div className="text-slate-500">
                          {new Date(interview.completedAt).toLocaleTimeString()}
                        </div>
                      </div>
                    ) : (
                      <span className="text-slate-400">-</span>
                    )}
                  </td>
                  <td className="px-3 sm:px-6 py-4 text-sm font-medium">
                    <div className="flex flex-wrap gap-2 items-center">
                      {interview.saveFiles ? (
                        <button
                          onClick={() => onDownload(interview.id)}
                          className="btn-secondary text-sm px-3 py-1"
                          title="Download saved interview files"
                        >
                          Download Files
                        </button>
                      ) : (
                        <span className="text-xs text-gray-500 bg-gray-50 px-2 py-1 rounded border">
                          Files not saved
                        </span>
                      )}
                      <button
                        onClick={() => onShowLogs(interview.id)}
                        className="btn-primary text-sm px-3 py-1"
                      >
                        Logs
                      </button>
                      <button
                        onClick={() => onDelete(interview.id)}
                        className="btn-danger text-sm px-3 py-1"
                        title="Permanently delete this interview record and history files"
                      >
                        Delete
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
