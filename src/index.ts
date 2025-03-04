import { TunnelServer } from './tunnel-server'

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 8000
const DOMAIN = process.env.DOMAIN || 'localhost:8000'

const server = new TunnelServer({
    port: PORT,
    domain: DOMAIN,
})

server.start()

// Handle termination
process.on('SIGINT', () => {
    console.log('Shutting down server...')
    process.exit(0)
})
