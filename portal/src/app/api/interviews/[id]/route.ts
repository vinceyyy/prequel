import { NextRequest, NextResponse } from 'next/server'
import { terraformManager } from '@/lib/terraform'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const status = await terraformManager.getInterviewStatus(id)

    if (!status.success) {
      return NextResponse.json(
        {
          error: 'Interview not found or failed to get status',
          details: status.error,
        },
        { status: 404 }
      )
    }

    const outputs = status.outputs as Record<string, { value: string }>
    const interview = {
      id,
      candidateName: outputs?.candidate_name?.value || 'Unknown',
      challenge: outputs?.challenge?.value || 'unknown',
      status: 'active',
      accessUrl: outputs?.access_url?.value,
      password: outputs?.password?.value,
      createdAt: outputs?.created_at?.value || new Date().toISOString(),
    }

    return NextResponse.json({ interview })
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error: 'Failed to get interview status',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const result = await terraformManager.destroyInterviewStreaming(id)

    if (!result.success) {
      return NextResponse.json(
        {
          error: 'Failed to destroy interview infrastructure',
          details: result.error,
          terraformOutput: result.output,
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      message: 'Interview infrastructure destroyed successfully',
      terraformOutput: result.output,
    })
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error: 'Failed to destroy interview',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
