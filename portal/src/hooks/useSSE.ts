import { useEffect, useRef, useState } from 'react'

export interface SSEEvent {
  type:
    | 'connection'
    | 'heartbeat'
    | 'operation_status'
    | 'scheduler_event'
    | 'operation_update'
  timestamp: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  operations?: any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  event?: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  operation?: any
}

export function useSSE(url: string) {
  const [connected, setConnected] = useState(false)
  const [lastEvent, setLastEvent] = useState<SSEEvent | null>(null)
  const [events, setEvents] = useState<SSEEvent[]>([])
  const eventSourceRef = useRef<EventSource | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const connect = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
    }

    try {
      const eventSource = new EventSource(url)
      eventSourceRef.current = eventSource

      eventSource.onopen = () => {
        console.log('SSE connected')
        setConnected(true)
        // Clear any pending reconnect
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current)
          reconnectTimeoutRef.current = null
        }
      }

      eventSource.onmessage = event => {
        try {
          const data = JSON.parse(event.data) as SSEEvent
          setLastEvent(data)

          // Only keep the last 100 events
          setEvents(prev => {
            const newEvents = [...prev, data]
            return newEvents.slice(-100)
          })
        } catch (error) {
          console.error('Error parsing SSE message:', error, event.data)
        }
      }

      eventSource.onerror = error => {
        console.error('SSE error:', error)
        setConnected(false)
        eventSource.close()

        // Attempt to reconnect after 5 seconds
        if (!reconnectTimeoutRef.current) {
          reconnectTimeoutRef.current = setTimeout(() => {
            console.log('Attempting to reconnect SSE...')
            connect()
          }, 5000)
        }
      }

      // EventSource doesn't have onclose event in standard API
      // Connection close is handled via onerror
    } catch (error) {
      console.error('Error creating SSE connection:', error)
      setConnected(false)
    }
  }

  const disconnect = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
    setConnected(false)
  }

  useEffect(() => {
    connect()

    return () => {
      disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  return {
    connected,
    lastEvent,
    events,
    reconnect: connect,
    disconnect,
  }
}
