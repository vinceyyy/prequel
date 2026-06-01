import OperationDashboard from '@/components/OperationDashboard'

interface LogsModalProps {
  selectedInterviewForLogs: string | null
  onClose: () => void
}

export default function LogsModal({ selectedInterviewForLogs, onClose }: LogsModalProps) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="card p-4 sm:p-6 w-full max-w-6xl h-5/6 max-h-screen overflow-hidden fade-in">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-slate-900">
            Operation Logs
            {selectedInterviewForLogs ? ` - Interview ${selectedInterviewForLogs}` : ''}
          </h2>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-700 cursor-pointer transition-colors"
          >
            ✕
          </button>
        </div>

        <OperationDashboard interviewFilter={selectedInterviewForLogs} />

        <div className="flex justify-end mt-4">
          <button onClick={onClose} className="btn-outline">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
