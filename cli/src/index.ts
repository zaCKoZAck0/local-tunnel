#!/usr/bin/env node
import chalk from 'chalk'
import { Command } from 'commander'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { TunnelClient } from './tunnel-client'

// Simple configuration management
const configPath = path.join(os.homedir(), '.tunnel-cli-config.json')
const defaultConfig = {
    serverUrl: 'ws://localhost:8000',
    localPort: '8000',
    localHost: 'localhost',
}

// Function to load configuration
function loadConfig() {
    try {
        if (fs.existsSync(configPath)) {
            const configData = fs.readFileSync(configPath, 'utf8')
            return JSON.parse(configData)
        }
    } catch (error) {
        console.error(
            chalk.yellow('Warning: Could not load config file, using defaults')
        )
    }
    return defaultConfig
}

// Function to save configuration
function saveConfig(config: any) {
    try {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
        return true
    } catch (error) {
        console.error(chalk.yellow('Warning: Could not save config file'))
        return false
    }
}

// Load current config
const currentConfig = loadConfig()

// Setup CLI
const program = new Command()

program
    .name('tunnel-cli')
    .description('Create a tunnel to expose your local service to the internet')
    .version('1.0.0')
    .option(
        '-p, --port <number>',
        'Local port to forward',
        currentConfig.localPort
    )
    .option(
        '-h, --host <hostname>',
        'Local host to forward',
        currentConfig.localHost
    )
    .option('-s, --server <url>', 'Tunnel server URL', currentConfig.serverUrl)
    .option('-d, --subdomain <name>', 'Custom subdomain to use')
    .option('--save', 'Save configuration as default')
    .action(async (options) => {
        // Save configuration if requested
        if (options.save) {
            const newConfig = {
                ...currentConfig,
                serverUrl: options.server,
                localPort: options.port,
                localHost: options.host,
            }

            if (saveConfig(newConfig)) {
                console.log(chalk.green('✓ Configuration saved'))
            }
        }

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
