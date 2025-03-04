import axios from 'axios'
import WebSocket from 'ws'

interface TunnelOptions {
    serverUrl: string
    localPort: number
    localHost?: string
    subdomain?: string
}

export class TunnelClient {
    private options: TunnelOptions
    private socket: WebSocket | null = null
    private connected: boolean = false
    private tunnelUrl: string = ''
    private reconnectAttempts: number = 0
    private maxReconnectAttempts: number = 10
    private reconnectTimeout: NodeJS.Timeout | null = null

    constructor(options: TunnelOptions) {
        this.options = {
            localHost: 'localhost',
            ...options,
        }
    }

    public async connect(): Promise<string> {
        return new Promise((resolve, reject) => {
            // Construct the WebSocket URL
            let wsUrl = this.options.serverUrl
            if (this.options.subdomain) {
                wsUrl += `?subdomain=${this.options.subdomain}`
            }

            // Connect to the tunnel server
            this.socket = new WebSocket(wsUrl)

            // Handle connection open
            this.socket.on('open', () => {
                console.log('Connected to tunnel server')
                this.connected = true
                this.reconnectAttempts = 0
            })

            // Handle messages from the server
            this.socket.on('message', async (data: Buffer) => {
                try {
                    const message = JSON.parse(data.toString())

                    if (message.type === 'connected') {
                        console.log(`Tunnel established at: ${message.url}`)
                        this.tunnelUrl = message.url
                        resolve(message.url)
                    } else if (message.type === 'error') {
                        console.error(`Tunnel error: ${message.message}`)
                        reject(new Error(message.message))
                    } else if (message.type === 'request') {
                        await this.handleRequest(message)
                    }
                } catch (err) {
                    console.error('Error processing server message:', err)
                }
            })

            // Handle connection close
            this.socket.on('close', () => {
                this.connected = false
                console.log('Connection to tunnel server closed')
                this.attemptReconnect()
            })

            // Handle connection errors
            this.socket.on('error', (err) => {
                console.error('WebSocket error:', err)
                reject(err)
            })
        })
    }

    public disconnect(): void {
        if (this.socket) {
            this.socket.close()
            this.socket = null
            this.connected = false
        }

        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout)
            this.reconnectTimeout = null
        }
    }

    private async handleRequest(message: any): Promise<void> {
        if (!this.socket || !this.connected) {
            return
        }

        const { requestId, method, path, headers, body } = message

        try {
            // Forward request to local service
            const response = await axios({
                method: method?.toLowerCase() || 'get',
                url: `http://${this.options.localHost}:${this.options.localPort}${path}`,
                headers: this.filterHeaders(headers),
                data: body,
                validateStatus: () => true, // Accept any status code
                maxRedirects: 0, // Don't follow redirects
            })

            // Send response back to server
            this.socket.send(
                JSON.stringify({
                    type: 'response',
                    requestId,
                    status: response.status,
                    headers: response.headers,
                    body:
                        typeof response.data === 'string'
                            ? response.data
                            : JSON.stringify(response.data),
                })
            )
        } catch (err) {
            console.error('Error forwarding request:', err)

            // Send error response back to server
            this.socket.send(
                JSON.stringify({
                    type: 'response',
                    requestId,
                    status: 502,
                    headers: {},
                    body: 'Bad Gateway: Could not connect to local service',
                })
            )
        }
    }

    private filterHeaders(headers: Record<string, any>): Record<string, any> {
        const filtered: Record<string, any> = { ...headers }

        // Remove headers that might cause conflicts
        delete filtered.host
        delete filtered.connection
        delete filtered['content-length']

        return filtered
    }

    private attemptReconnect(): void {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.log('Max reconnect attempts reached, giving up')
            return
        }

        const delay = Math.min(
            1000 * Math.pow(2, this.reconnectAttempts),
            30000
        )
        console.log(`Attempting to reconnect in ${delay / 1000} seconds...`)

        this.reconnectAttempts++
        this.reconnectTimeout = setTimeout(() => {
            console.log('Reconnecting...')
            this.connect().catch((err) => {
                console.error('Reconnection failed:', err)
            })
        }, delay)
    }
}
