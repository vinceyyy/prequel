import { NextRequest, NextResponse } from 'next/server'
import { terraformManager } from '@/lib/terraform'
import { operationManager } from '@/lib/operations'
import { v4 as uuidv4 } from 'uuid'

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

    // Create operation to track progress
    const operationId = operationManager.createOperation(
      'create',
      interviewId,
      candidateName,
      scenario
    )

    const instance = {
      id: interviewId,
      candidateName,
      scenario,
      password,
    }

    // Start background operation
    setImmediate(async () => {
      try {
        operationManager.updateOperationStatus(operationId, 'running')
        operationManager.addOperationLog(operationId, `Starting interview creation for ${candidateName}`)
        operationManager.addOperationLog(operationId, `Interview ID: ${interviewId}`)
        operationManager.addOperationLog(operationId, `Scenario: ${scenario}`)

        const result = await terraformManager.createInterviewStreaming(instance, (data: string) => {
          // Add each line to operation logs
          const lines = data.split('\n').filter(line => line.trim())
          lines.forEach(line => {
            operationManager.addOperationLog(operationId, line)
          })
        })

        if (result.success) {
          operationManager.addOperationLog(operationId, '✅ Interview created successfully!')
          operationManager.addOperationLog(operationId, `Access URL: ${result.accessUrl}`)
          
          operationManager.setOperationResult(operationId, {
            success: true,
            accessUrl: result.accessUrl,
            fullOutput: result.fullOutput
          })
        } else {
          operationManager.addOperationLog(operationId, '❌ Interview creation failed')
          operationManager.addOperationLog(operationId, `Error: ${result.error}`)
          
          operationManager.setOperationResult(operationId, {
            success: false,
            error: result.error,
            fullOutput: result.fullOutput
          })
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error'
        operationManager.addOperationLog(operationId, `❌ Error: ${errorMsg}`)
        operationManager.setOperationResult(operationId, {
          success: false,
          error: errorMsg
        })
      }
    })

    return NextResponse.json({
      operationId,
      interviewId,
      candidateName,
      scenario,
      password,
      message: 'Interview creation started in background'
    })
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error: 'Failed to start interview creation',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}