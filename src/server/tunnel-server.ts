import http from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { IncomingMessage, ServerResponse } from 'http'
import { v4 as uuidv4 } from 'uuid'
import { URL } from 'url'

interface TunnelClient {
    id: string
    subdomain: string
    ws: WebSocket
    connectedAt: Date
}

interface PendingRequest {
    resolve: (value: any) => void
    reject: (reason?: any) => void
    timeoutId: NodeJS.Timeout
}

export class TunnelServer {
    private server: http.Server
    private wss: WebSocketServer
    private clients: Map<string, TunnelClient>
    private pendingRequests: Map<string, PendingRequest>
    private domain: string
    private port: number

    constructor(options: { port: number; domain: string }) {
        this.port = options.port
        this.domain = options.domain
        this.clients = new Map()
        this.pendingRequests = new Map()

        // Create HTTP server
        this.server = http.createServer(this.handleRequest.bind(this))

        // Create WebSocket server
        this.wss = new WebSocketServer({ server: this.server })
        this.wss.on('connection', this.handleConnection.bind(this))
        console.log(`Tunnel server initalized with domain: ${this.domain}`)
    }

    public start(): void {
        this.server.listen(this.port, () => {
            console.log(`Tunnel server running on port ${this.port}`)
        })
    }

    private async handleConnection(
        ws: WebSocket,
        req: IncomingMessage
    ): Promise<void> {
        try {
            const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
            let subdomain = url.searchParams.get('subdomain')

            // Generate a random subdomain if not specified
            if (!subdomain) {
                subdomain = this.generateSubdomain()
            }

            // Check if subdomain is already in use
            if (this.clients.has(subdomain)) {
                ws.send(
                    JSON.stringify({
                        type: 'error',
                        message: 'Subdomain already in use',
                    })
                )
                ws.close()
                return
            }

            const clientId = uuidv4()

            // Register client
            this.clients.set(subdomain, {
                id: clientId,
                subdomain,
                ws,
                connectedAt: new Date(),
            })

            console.log(
                `Client connected: ${subdomain}.${this.domain} (ID: ${clientId})`
            )

            // Send connection confirmation to client
            ws.send(
                JSON.stringify({
                    type: 'connected',
                    subdomain,
                    url: `http://${subdomain}.${this.domain}`,
                })
            )

            // Handle message from client
            ws.on(
                'message',
                (data: string | Buffer | ArrayBuffer | Buffer[]) => {
                    this.handleClientMessage(clientId, data)
                }
            )

            // Handle WebSocket close
            ws.on('close', () => {
                this.handleClientDisconnect(clientId)
            })

            // Handle WebSocket error
            ws.on('error', (err) => {
                console.error(`WebSocket error for client ${clientId}: `, err)
                this.handleClientDisconnect(clientId)
            })
        } catch (err) {
            console.error('Error handling WebSocket connection:', err)
            ws.close()
        }
    }

    private handleClientMessage(
        clientId: string,
        data: string | Buffer | ArrayBuffer | Buffer[]
    ) {
        try {
            const message = JSON.parse(data.toString())
            if (message.type === 'response') {
                const { requestId, status, headers, body } = message

                // Find and resolve the pending request
                const pendingRequest = this.pendingRequests.get(requestId)
                if (pendingRequest) {
                    clearTimeout(pendingRequest.timeoutId)
                    pendingRequest.resolve({ status, headers, body })
                    this.pendingRequests.delete(requestId)
                }
            }
        } catch (err) {
            console.error(
                `Error handling client message from ${clientId}:`,
                err
            )
        }
    }

    private handleClientDisconnect(clientId: string): void {
        // Find the client by ID
        for (const [subdomain, client] of this.clients.entries()) {
            if (client.id === clientId) {
                this.clients.delete(subdomain)
                console.log(
                    `Client disconnected: ${subdomain}.${this.domain} (ID: ${clientId})`
                )
                break
            }
        }
    }

    private async handleRequest(
        req: IncomingMessage,
        res: ServerResponse
    ): Promise<void> {
        const host = req.headers.host ?? ''

        // Extract subdomain from host
        const subdomain = host.split('.')[0]

        if (!subdomain || !this.clients.has(subdomain)) {
            res.writeHead(404)
            res.end('Tunnel not found')
            return
        }

        try {
            const client = this.clients.get(subdomain)!
            const requestId = uuidv4()

            // Create a promise for this request
            const responsePromise = new Promise<any>((resolve, reject) => {
                // Set a timeout for the request
                const timeoutId = setTimeout(() => {
                    if (this.pendingRequests.has(requestId)) {
                        this.pendingRequests.delete(requestId)
                        reject(new Error('Request timed out'))
                    }
                }, 30000) // 30 second timeout

                // Store the promise resolvers
                this.pendingRequests.set(requestId, {
                    resolve,
                    reject,
                    timeoutId,
                })
            })

            // Read the request body
            let body = ''
            req.on('data', (chunk) => {
                body += chunk.toString()
            })

            req.on('end', () => {
                // Forward the request to the client
                client.ws.send(
                    JSON.stringify({
                        type: 'request',
                        requestId,
                        method: req.method,
                        path: req.url,
                        Headers: req.headers,
                        body,
                    })
                )

                // Wait for the response and send it back
                responsePromise
                    .then(({ status, headers, body }) => {
                        res.writeHead(status, headers)
                        res.end(body)
                    })
                    .catch((err) => {
                        console.log(
                            `Error handling request for ${subdomain}`,
                            err
                        )
                        res.writeHead(502)
                        res.end('Bad Gateway')
                    })
            })
        } catch (err) {
            console.error(`Error handling HTTP request for ${subdomain}:`, err)
            res.writeHead(500)
            res.end('Internal Server Error')
        }
    }

    private generateSubdomain(): string {
        return Math.random().toString(36).substring(2, 8)
    }
}
