#!/usr/bin/env node
import chalk from 'chalk'
import { Command } from 'commander'
import { TunnelClient } from './tunnel-client'

const config = {
    serverUrl: 'ws://localhost:8000',
    localPort: '8000',
    localHost: 'localhost',
}

// Setup CLI
const program = new Command()

program
    .name('tunnel-cli')
    .description('Create a tunnel to expose your local service to the internet')
    .version('1.0.0')
    .option('-p, --port <number>', 'Local port to forward', config.localPort)
    .option('-h, --host <hostname>', 'Local host to forward', config.localHost)
    .option('-s, --server <url>', 'Tunnel server URL', config.serverUrl)
    .option('-d, --subdomain <name>', 'Custom subdomain to use')
    .option('--save', 'Save configuration as default')
    .action(async (options) => {
        const client = new TunnelClient({
            serverUrl: options.server,
            localPort: options.port,
            localHost: options.host,
            subdomain: options.subdomain,
        })

        try {
            console.log(chalk.blue('Establishing tunnel connection...'))
            const tunnelUrl = await client.connect()

            console.log(chalk.green('✓ Tunnel established successfully!'))
            console.log(
                chalk.bold(
                    `Your local service is now available at: ${chalk.cyan(tunnelUrl)}`
                )
            )
            console.log(
                chalk.gray(
                    `Forwarding requests to: http://${options.host}:${options.port}`
                )
            )

            // Keep the process running
            process.on('SIGINT', () => {
                console.log(chalk.yellow('\nDisconnecting tunnel...'))
                client.disconnect()
                process.exit(0)
            })
        } catch (err) {
            console.error(chalk.red('Failed to establish tunnel:'), err)
            process.exit(1)
        }
    })

program.parse()
