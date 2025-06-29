import { NextRequest, NextResponse } from 'next/server'
import { terraformManager } from '@/lib/terraform'
import { operationManager } from '@/lib/operations'
import { v4 as uuidv4 } from 'uuid'

export async function GET() {
  try {
    // Get ongoing operations to include interviews being created/destroyed
    const operations = operationManager.getAllOperations()

    // Use S3 workspaces as source of truth for what interviews exist
    const workspaceInterviews = await terraformManager.listActiveInterviews()

    const completedInterviews = await Promise.all(
      workspaceInterviews.map(async id => {
        // Try to get Terraform status first
        const status = await terraformManager.getInterviewStatus(id)

        if (status.success && status.outputs) {
          const outputs = status.outputs as Record<string, { value: string }>
          return {
            id,
            candidateName: outputs.candidate_name?.value || 'Unknown',
            scenario: outputs.scenario?.value || 'unknown',
            status: 'active',
            accessUrl: outputs.access_url?.value,
            password: outputs.password?.value,
            createdAt: outputs.created_at?.value || new Date().toISOString(),
          }
        }

        // If Terraform status fails, this might be a failed destroy attempt
        // Check if there's a recent destroy operation for this interview
        const destroyOperation = operations
          .filter(op => op.type === 'destroy' && op.interviewId === id)
          .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0]

        if (destroyOperation) {
          return {
            id,
            candidateName: destroyOperation.candidateName || 'Unknown',
            scenario: destroyOperation.scenario || 'unknown',
            status:
              destroyOperation.status === 'running'
                ? 'destroying'
                : destroyOperation.status === 'failed'
                  ? 'error'
                  : 'error',
            createdAt: destroyOperation.startedAt.toISOString(),
          }
        }

        // Fallback for interviews with workspace but no valid state or operations
        return {
          id,
          candidateName: 'Unknown',
          scenario: 'unknown',
          status: 'error',
          createdAt: new Date().toISOString(),
        }
      })
    )

    // Add interviews from operations that aren't completed yet
    const operationInterviews = operations
      .filter(op => op.type === 'create')
      .map(op => ({
        id: op.interviewId,
        candidateName: op.candidateName || 'Unknown',
        scenario: op.scenario || 'unknown',
        status:
          op.status === 'pending'
            ? 'creating'
            : op.status === 'running'
              ? 'creating'
              : op.status === 'completed'
                ? op.result?.success
                  ? 'active'
                  : 'error'
                : 'error',
        accessUrl: op.result?.accessUrl,
        password: op.result?.password || '',
        createdAt: op.startedAt.toISOString(),
      }))

    // Merge and deduplicate (operations take precedence for interviews in progress)
    const interviewMap = new Map()

    // Add completed interviews first
    completedInterviews.forEach(interview => {
      interviewMap.set(interview.id, interview)
    })

    // Add/update with operation interviews (this will override if same ID)
    operationInterviews.forEach(interview => {
      const existing = interviewMap.get(interview.id)
      if (
        existing &&
        existing.status === 'active' &&
        interview.status !== 'active'
      ) {
        // Keep the active one if it exists
        return
      }
      interviewMap.set(interview.id, interview)
    })

    const interviews = Array.from(interviewMap.values()).sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )

    return NextResponse.json({ interviews })
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error: 'Failed to list interviews',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { candidateName, scenario } = body

    if (!candidateName || !scenario) {
      return NextResponse.json(
        { error: 'candidateName and scenario are required' },
        { status: 400 }
      )
    }

    const interviewId = uuidv4().substring(0, 8)
    const password = Math.random().toString(36).substring(2, 12)

    const instance = {
      id: interviewId,
      candidateName,
      scenario,
      password,
    }

    console.log(instance)

    // Start Terraform provisioning in background
    const result = await terraformManager.createInterview(instance)

    if (!result.success) {
      return NextResponse.json(
        {
          error: 'Failed to create interview infrastructure',
          details: result.error,
          terraformOutput: result.output,
          fullOutput: result.fullOutput,
          executionLog: result.executionLog,
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      interview: {
        id: interviewId,
        candidateName,
        scenario,
        status: 'active',
        accessUrl: result.accessUrl,
        password,
        createdAt: new Date().toISOString(),
      },
      terraformOutput: result.output,
      fullOutput: result.fullOutput,
      executionLog: result.executionLog,
    })
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error: 'Failed to create interview',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
