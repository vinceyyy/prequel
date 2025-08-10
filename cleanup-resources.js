#!/usr/bin/env node

/**
 * AWS Resource Cleanup Script
 * 
 * This script provides a command-line interface for cleaning up dangling
 * AWS resources and terraform workspaces that may be left behind due to
 * failed operations or corrupted state.
 * 
 * Usage:
 *   node cleanup-resources.js [options]
 * 
 * Options:
 *   --dry-run              Preview what would be cleaned up (default: false)
 *   --force-destroy        Clean up active interviews too (default: false)
 *   --max-concurrency=N    Max concurrent operations (default: 3)
 *   --timeout=N            Timeout per operation in seconds (default: 300)
 *   --list-only            Only list dangling resources (default: false)
 *   --help                 Show this help message
 * 
 * Examples:
 *   # Preview what would be cleaned up
 *   node cleanup-resources.js --dry-run
 * 
 *   # Clean up only dangling resources
 *   node cleanup-resources.js
 * 
 *   # Clean up all workspaces including active ones
 *   node cleanup-resources.js --force-destroy
 * 
 *   # List dangling resources without cleanup
 *   node cleanup-resources.js --list-only
 * 
 * Environment Variables:
 *   AWS_PROFILE            AWS profile for authentication
 *   AWS_REGION             AWS region (default: us-east-1)
 *   PROJECT_PREFIX         Project prefix for resource naming
 *   ENVIRONMENT            Environment (dev/staging/prod)
 *   LOG_LEVEL              Log level (debug/info/warn/error)
 */

const fs = require('fs')
const path = require('path')

// Check if we're in the portal directory
const portalDir = path.join(__dirname, 'portal')
const isInPortal = fs.existsSync(path.join(portalDir, 'package.json'))
const workingDir = isInPortal ? portalDir : __dirname

// Load environment variables from .env.local if it exists
const envPath = path.join(workingDir, '.env.local')
if (fs.existsSync(envPath)) {
  console.log(`Loading environment from: ${envPath}`)
  require('dotenv').config({ path: envPath })
} else {
  console.log('No .env.local file found, using system environment variables')
}

// Validate required environment variables
const requiredEnvVars = ['AWS_PROFILE', 'PROJECT_PREFIX', 'ENVIRONMENT']
const missingVars = requiredEnvVars.filter(varName => !process.env[varName])

if (missingVars.length > 0) {
  console.error('❌ Missing required environment variables:')
  missingVars.forEach(varName => {
    console.error(`   - ${varName}`)
  })
  console.error('')
  console.error('Please set these variables in your .env.local file or environment.')
  process.exit(1)
}

console.log('🔧 Configuration:')
console.log(`   AWS_PROFILE: ${process.env.AWS_PROFILE}`)
console.log(`   AWS_REGION: ${process.env.AWS_REGION || 'us-east-1'}`)
console.log(`   PROJECT_PREFIX: ${process.env.PROJECT_PREFIX}`)
console.log(`   ENVIRONMENT: ${process.env.ENVIRONMENT}`)
console.log('')

// Parse command line arguments
const args = process.argv.slice(2)
const options = {
  dryRun: args.includes('--dry-run'),
  forceDestroy: args.includes('--force-destroy'),
  listOnly: args.includes('--list-only'),
  help: args.includes('--help'),
  maxConcurrency: 3,
  timeout: 300,
}

// Parse numeric options
const maxConcurrencyArg = args.find(arg => arg.startsWith('--max-concurrency='))
if (maxConcurrencyArg) {
  options.maxConcurrency = parseInt(maxConcurrencyArg.split('=')[1], 10)
  if (isNaN(options.maxConcurrency) || options.maxConcurrency < 1 || options.maxConcurrency > 10) {
    console.error('❌ --max-concurrency must be a number between 1 and 10')
    process.exit(1)
  }
}

const timeoutArg = args.find(arg => arg.startsWith('--timeout='))
if (timeoutArg) {
  options.timeout = parseInt(timeoutArg.split('=')[1], 10)
  if (isNaN(options.timeout) || options.timeout < 60 || options.timeout > 1800) {
    console.error('❌ --timeout must be a number between 60 and 1800 seconds')
    process.exit(1)
  }
}

// Show help
if (options.help) {
  console.log(`
AWS Resource Cleanup Script

This script cleans up dangling AWS resources and terraform workspaces.

Usage:
  node cleanup-resources.js [options]

Options:
  --dry-run              Preview what would be cleaned up (default: false)
  --force-destroy        Clean up active interviews too (default: false)
  --max-concurrency=N    Max concurrent operations (default: 3, max: 10)
  --timeout=N            Timeout per operation in seconds (default: 300, max: 1800)
  --list-only            Only list dangling resources (default: false)
  --help                 Show this help message

Examples:
  # Preview what would be cleaned up
  node cleanup-resources.js --dry-run

  # Clean up only dangling resources
  node cleanup-resources.js

  # Clean up all workspaces including active ones
  node cleanup-resources.js --force-destroy

  # List dangling resources without cleanup
  node cleanup-resources.js --list-only

Environment Variables Required:
  AWS_PROFILE            AWS profile for authentication
  PROJECT_PREFIX         Project prefix for resource naming  
  ENVIRONMENT            Environment (dev/staging/prod)

Optional Environment Variables:
  AWS_REGION             AWS region (default: us-east-1)
  LOG_LEVEL              Log level (default: info)
`)
  process.exit(0)
}

// Main execution
async function main() {
  console.log('🧹 AWS Resource Cleanup Script')
  console.log('================================')
  console.log('')

  if (options.dryRun) {
    console.log('🔍 DRY RUN MODE - No resources will be destroyed')
  } else if (options.listOnly) {
    console.log('📋 LIST ONLY MODE - Only showing dangling resources')
  } else {
    console.log('🔥 DESTRUCTIVE MODE - Resources will be destroyed')
    if (options.forceDestroy) {
      console.log('⚠️  FORCE DESTROY ENABLED - Active interviews will be destroyed too')
    }
  }
  
  console.log(`⚙️  Max Concurrency: ${options.maxConcurrency}`)
  console.log(`⏱️  Timeout: ${options.timeout} seconds`)
  console.log('')

  // Prompt for confirmation if not dry run or list only
  if (!options.dryRun && !options.listOnly) {
    const readline = require('readline')
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    })

    const answer = await new Promise(resolve => {
      rl.question('⚠️  This will destroy AWS resources. Are you sure? (yes/no): ', resolve)
    })
    rl.close()

    if (answer.toLowerCase() !== 'yes') {
      console.log('❌ Cleanup cancelled by user')
      process.exit(0)
    }
    console.log('')
  }

  try {
    // Change to portal directory for imports to work
    if (isInPortal) {
      process.chdir(portalDir)
    }

    // Dynamic import of the cleanup service
    const { cleanupService } = await import('./src/lib/cleanup.js')

    if (options.listOnly) {
      console.log('📋 Listing dangling resources...')
      const resources = await cleanupService.listDanglingResources()
      
      console.log('')
      console.log('📊 Results:')
      console.log(`   Total workspaces in S3: ${resources.workspaces.length}`)
      console.log(`   Active interviews in DB: ${resources.existingInterviews.length}`)
      console.log(`   Dangling workspaces: ${resources.danglingWorkspaces.length}`)
      console.log('')

      if (resources.danglingWorkspaces.length > 0) {
        console.log('🗑️  Dangling workspaces that would be cleaned up:')
        resources.danglingWorkspaces.forEach(id => {
          console.log(`   - ${id}`)
        })
      } else {
        console.log('✅ No dangling workspaces found')
      }

      if (resources.existingInterviews.length > 0) {
        console.log('')
        console.log('⚡ Active workspaces (would be skipped unless --force-destroy):')
        resources.existingInterviews.forEach(id => {
          console.log(`   - ${id}`)
        })
      }
    } else {
      console.log('🚀 Starting cleanup operation...')
      const result = await cleanupService.performCleanup({
        dryRun: options.dryRun,
        forceDestroy: options.forceDestroy,
        maxConcurrency: options.maxConcurrency,
        timeout: options.timeout,
      })

      // Print detailed results
      console.log('')
      console.log('📋 Cleanup Details:')
      result.details.forEach(detail => {
        console.log(`   ${detail}`)
      })

      console.log('')
      console.log('📊 Summary:')
      console.log(`   Workspaces found: ${result.summary.workspacesFound}`)
      console.log(`   Workspaces destroyed: ${result.summary.workspacesDestroyed}`)
      console.log(`   Workspaces skipped: ${result.summary.workspacesSkipped}`)
      console.log(`   Workspaces errored: ${result.summary.workspacesErrored}`)
      console.log(`   Dangling resources found: ${result.summary.danglingResourcesFound}`)
      console.log(`   Dangling resources cleaned: ${result.summary.danglingResourcesCleaned}`)

      if (result.workspaceResults.length > 0) {
        console.log('')
        console.log('📋 Individual Results:')
        result.workspaceResults.forEach(ws => {
          const status = ws.status === 'destroyed' ? '✅' : 
                        ws.status === 'skipped' ? '⏭️' : '❌'
          console.log(`   ${status} ${ws.interviewId}: ${ws.status}`)
          if (ws.reason) console.log(`      Reason: ${ws.reason}`)
          if (ws.error) console.log(`      Error: ${ws.error}`)
        })
      }

      console.log('')
      if (result.success) {
        console.log('✅ Cleanup completed successfully!')
      } else {
        console.log(`❌ Cleanup completed with errors: ${result.error}`)
        process.exit(1)
      }
    }
  } catch (error) {
    console.error('')
    console.error('❌ Cleanup script failed:')
    console.error(`   Error: ${error.message}`)
    if (process.env.LOG_LEVEL === 'debug') {
      console.error('')
      console.error('Stack trace:')
      console.error(error.stack)
    }
    process.exit(1)
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled promise rejection:', reason)
  process.exit(1)
})

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught exception:', error.message)
  if (process.env.LOG_LEVEL === 'debug') {
    console.error(error.stack)
  }
  process.exit(1)
})

// Run the script
main().catch(console.error)