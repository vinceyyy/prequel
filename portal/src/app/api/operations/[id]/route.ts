import { NextRequest, NextResponse } from 'next/server'
import { operationManager } from '@/lib/operations'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const operationId = id
    const operation = operationManager.getOperation(operationId)

    if (!operation) {
      return NextResponse.json(
        { error: 'Operation not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ operation })
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error: 'Failed to get operation',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
