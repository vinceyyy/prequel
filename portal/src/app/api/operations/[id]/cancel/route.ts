import { NextRequest, NextResponse } from 'next/server'
import { operationManager } from '@/lib/operations'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const operationId = id

    if (!operationId) {
      return NextResponse.json(
        { success: false, error: 'Operation ID is required' },
        { status: 400 }
      )
    }

    const operation = operationManager.getOperation(operationId)
    if (!operation) {
      return NextResponse.json(
        { success: false, error: 'Operation not found' },
        { status: 404 }
      )
    }

    // Check if operation can be cancelled
    if (operation.status !== 'pending' && operation.status !== 'running') {
      return NextResponse.json(
        {
          success: false,
          error: `Cannot cancel operation with status: ${operation.status}`,
        },
        { status: 400 }
      )
    }

    const cancelled = operationManager.cancelOperation(operationId)

    if (cancelled) {
      return NextResponse.json({
        success: true,
        message: 'Operation cancelled successfully',
        operation: operationManager.getOperation(operationId),
      })
    } else {
      return NextResponse.json(
        { success: false, error: 'Failed to cancel operation' },
        { status: 500 }
      )
    }
  } catch (error) {
    console.error('Error cancelling operation:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
