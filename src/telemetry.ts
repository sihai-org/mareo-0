/**
 * Anonymous operational telemetry: installs, launches, harness exits and sign-in
 * results. It exists so we can see whether the app installs, starts and signs in
 * on real machines. Nothing else is sent — no conversation content, no prompts,
 * no email, no device identifier — and sending never blocks or fails a launch.
 */
export type TelemetryEventName = 'install_confirmed' | 'launch' | 'harness_exit' | 'signin'

export interface TelemetryEvent {
  name: TelemetryEventName
  /** Short, content-free context, stored as text by the gateway. */
  detail?: Record<string, unknown>
}

export interface TelemetryOptions {
  endpoint: string
  version: string
  enabled: boolean
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

interface Envelope {
  name: TelemetryEventName
  version: string
  platform: string
  detail?: string
}

const MAX_DETAIL_LENGTH = 500

export class Telemetry {
  private readonly endpoint: string
  private readonly version: string
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number
  private enabled: boolean
  private token: string | undefined
  private queue: Envelope[] = []
  private sending: Promise<boolean> | undefined

  constructor(options: TelemetryOptions) {
    this.endpoint = options.endpoint
    this.version = options.version
    this.fetchImpl = options.fetchImpl ?? fetch
    this.timeoutMs = options.timeoutMs ?? 5_000
    this.enabled = options.enabled
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (!enabled) this.queue = []
  }

  /** Signed-in events are tied to the account; before that they stay anonymous. */
  setToken(token: string | undefined): void {
    this.token = token
  }

  /** Queues an event and sends it in the background. */
  record(event: TelemetryEvent): void {
    if (!this.enabled) return
    this.queue.push(this.envelope(event))
    void this.flush()
  }

  /**
   * Sends one event immediately and reports whether it arrived. Used for
   * one-time events whose local marker must not be written on a failed send.
   */
  sendNow(event: TelemetryEvent): Promise<boolean> {
    if (!this.enabled) return Promise.resolve(false)
    return this.post([this.envelope(event)])
  }

  /** Best-effort flush of the queue; events recorded during a send stay queued. */
  async flush(): Promise<void> {
    if (!this.enabled || this.sending !== undefined || this.queue.length === 0) return
    const batch = this.queue.splice(0, this.queue.length)
    this.sending = this.post(batch)
    try {
      await this.sending
    } finally {
      this.sending = undefined
    }
  }

  private async post(events: Envelope[]): Promise<boolean> {
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.token === undefined ? {} : { authorization: `Bearer ${this.token}` }),
        },
        body: JSON.stringify({ events }),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
      return response.ok
    } catch {
      // Telemetry is best-effort: a failed send is dropped, never retried in a loop.
      return false
    }
  }

  private envelope(event: TelemetryEvent): Envelope {
    const envelope: Envelope = { name: event.name, version: this.version, platform: process.platform }
    if (event.detail !== undefined) {
      const text = JSON.stringify(event.detail)
      envelope.detail = text.length > MAX_DETAIL_LENGTH ? text.slice(0, MAX_DETAIL_LENGTH) : text
    }
    return envelope
  }
}
