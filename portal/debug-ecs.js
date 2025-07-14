#!/usr/bin/env node

// Debug script to check ECS task status and logs
const {
  ECSClient,
  ListTasksCommand,
  DescribeTasksCommand,
} = require('@aws-sdk/client-ecs')
const {
  CloudWatchLogsClient,
  DescribeLogGroupsCommand,
  DescribeLogStreamsCommand,
  GetLogEventsCommand,
} = require('@aws-sdk/client-cloudwatch-logs')

const ecsClient = new ECSClient({
  region: process.env.AWS_REGION || 'us-east-1',
})
const logsClient = new CloudWatchLogsClient({
  region: process.env.AWS_REGION || 'us-east-1',
})

async function debugECS() {
  try {
    console.log('🔍 Debugging ECS Tasks and Logs...\n')

    // 1. List all tasks in the cluster
    console.log('1. Listing ECS tasks...')
    const listTasksResponse = await ecsClient.send(
      new ListTasksCommand({
        cluster: 'prequel-ecs-cluster', // Replace with actual cluster name
        maxResults: 10,
      })
    )

    if (listTasksResponse.taskArns.length === 0) {
      console.log('❌ No tasks found in cluster')
      return
    }

    console.log(`✅ Found ${listTasksResponse.taskArns.length} tasks`)

    // 2. Describe tasks to get details
    console.log('\n2. Describing tasks...')
    const describeTasksResponse = await ecsClient.send(
      new DescribeTasksCommand({
        cluster: 'prequel-ecs-cluster',
        tasks: listTasksResponse.taskArns,
      })
    )

    for (const task of describeTasksResponse.tasks) {
      console.log(`\n📋 Task: ${task.taskArn.split('/').pop()}`)
      console.log(`   Status: ${task.lastStatus}`)
      console.log(`   Health: ${task.healthStatus}`)
      console.log(`   Created: ${task.createdAt}`)

      if (task.taskDefinitionArn.includes('interview-')) {
        console.log(`   🎯 This is an interview task!`)

        // Check container status
        for (const container of task.containers) {
          console.log(`   Container ${container.name}: ${container.lastStatus}`)
          if (container.reason) {
            console.log(`   Reason: ${container.reason}`)
          }
          if (container.exitCode) {
            console.log(`   Exit Code: ${container.exitCode}`)
          }
        }
      }
    }

    // 3. Check CloudWatch log groups
    console.log('\n3. Checking CloudWatch log groups...')
    const logGroupsResponse = await logsClient.send(
      new DescribeLogGroupsCommand({
        logGroupNamePrefix: '/aws/ecs/prequel',
      })
    )

    if (logGroupsResponse.logGroups.length === 0) {
      console.log('❌ No log groups found with prefix /aws/ecs/prequel')
      return
    }

    for (const logGroup of logGroupsResponse.logGroups) {
      console.log(`📁 Log Group: ${logGroup.logGroupName}`)

      // Check log streams in this group
      const logStreamsResponse = await logsClient.send(
        new DescribeLogStreamsCommand({
          logGroupName: logGroup.logGroupName,
          orderBy: 'LastEventTime',
          descending: true,
          limit: 5,
        })
      )

      if (logStreamsResponse.logStreams.length === 0) {
        console.log('   ❌ No log streams found')
        continue
      }

      for (const logStream of logStreamsResponse.logStreams) {
        if (logStream.logStreamName.includes('interview-')) {
          console.log(`   📄 Stream: ${logStream.logStreamName}`)
          console.log(
            `   Last Event: ${logStream.lastEventTime ? new Date(logStream.lastEventTime).toISOString() : 'Never'}`
          )

          // Get recent log events
          try {
            const logEventsResponse = await logsClient.send(
              new GetLogEventsCommand({
                logGroupName: logGroup.logGroupName,
                logStreamName: logStream.logStreamName,
                limit: 10,
                startFromHead: false,
              })
            )

            if (logEventsResponse.events.length > 0) {
              console.log('   Recent logs:')
              for (const event of logEventsResponse.events.slice(-3)) {
                console.log(
                  `     ${new Date(event.timestamp).toISOString()}: ${event.message.trim()}`
                )
              }
            } else {
              console.log('   ❌ No log events found')
            }
          } catch (error) {
            console.log(`   ❌ Error reading logs: ${error.message}`)
          }
        }
      }
    }
  } catch (error) {
    console.error('❌ Debug failed:', error.message)
  }
}

debugECS()
