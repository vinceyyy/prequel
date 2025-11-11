import '@testing-library/jest-dom'

// Mock Next.js server-side modules in tests
global.Request =
  global.Request ||
  class Request {
    constructor(input, init) {
      this._url = input
      this.method = init?.method || 'GET'
      this.headers = new Headers(init?.headers)
      this._body = init?.body
    }

    get url() {
      return this._url
    }

    async json() {
      return JSON.parse(this._body || '{}')
    }
  }

global.Response =
  global.Response ||
  class Response {
    constructor(body, init) {
      this.body = body
      this.status = init?.status || 200
      this.headers = new Headers(init?.headers)
    }

    async json() {
      return JSON.parse(this.body || '{}')
    }

    static json(data, init) {
      return new Response(JSON.stringify(data), {
        ...init,
        headers: {
          'content-type': 'application/json',
          ...init?.headers,
        },
      })
    }
  }

global.Headers =
  global.Headers ||
  class Headers {
    constructor(init) {
      this._headers = new Map()
      if (init) {
        Object.entries(init).forEach(([key, value]) => {
          this._headers.set(key.toLowerCase(), value)
        })
      }
    }

    get(name) {
      return this._headers.get(name.toLowerCase())
    }

    set(name, value) {
      this._headers.set(name.toLowerCase(), value)
    }
  }

// Mock EventSource for SSE tests
global.EventSource =
  global.EventSource ||
  class EventSource {
    constructor(url) {
      this.url = url
      this.readyState = 1
      setTimeout(() => {
        this.onopen?.()
      }, 0)
    }

    close() {
      this.readyState = 2
    }
  }
