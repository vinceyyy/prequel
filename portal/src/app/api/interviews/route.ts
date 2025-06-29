import { NextRequest, NextResponse } from 'next/server'
import { terraformManager } from '@/lib/terraform'
import { v4 as uuidv4 } from 'uuid'

export async function GET() {
  try {
    const activeInterviews = await terraformManager.listActiveInterviews()

    const interviews = await Promise.all(
      activeInterviews.map(async id => {
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

        return {
          id,
          candidateName: 'Unknown',
          scenario: 'unknown',
          status: 'error',
          createdAt: new Date().toISOString(),
        }
      })
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
