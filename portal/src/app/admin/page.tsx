'use client'

import Link from 'next/link'
import CleanupDashboard from '@/components/CleanupDashboard'

export default function AdminPage() {
  return (
    <div className="min-h-screen bg-gray-900 p-4 sm:p-8 w-full overflow-x-hidden text-white">
      <div className="max-w-7xl mx-auto w-full">
        <header className="mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white">Admin Dashboard</h1>
            <p className="text-gray-400 mt-2">
              Manage challenges and clean up AWS resources
            </p>
          </div>
        </header>

        <div className="space-y-8">
          {/* Challenge Management Section */}
          <section className="p-6 bg-gray-800 border border-gray-700 rounded-lg">
            <h2 className="text-2xl font-bold text-white mb-4">
              Challenge Management
            </h2>
            <p className="text-gray-400 mb-6">
              Create, edit, and manage interview challenges. Upload challenge
              files, configure ECS resources, and organize your interview
              content.
            </p>
            <Link
              href="/challenges"
              className="inline-flex items-center px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Manage Challenges →
            </Link>
          </section>

          {/* Resource Cleanup Section */}
          <section className="p-6 bg-gray-800 border border-gray-700 rounded-lg">
            <CleanupDashboard />
          </section>
        </div>
      </div>
    </div>
  )
}
