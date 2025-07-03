#!/bin/bash

echo "🔍 Checking ECS Interview Tasks Status"
echo "======================================"

# Set AWS profile
export AWS_PROFILE=${AWS_PROFILE:-your-aws-profile}
export AWS_REGION=${AWS_REGION:-your-aws-region}

echo "AWS Profile: $AWS_PROFILE"
echo "AWS Region: $AWS_REGION"
echo ""

# Check if we can access AWS
echo "1. Testing AWS access..."
aws sts get-caller-identity > /dev/null 2>&1
if [ $? -ne 0 ]; then
    echo "❌ AWS authentication failed. Please run: aws sso login --profile $AWS_PROFILE"
    exit 1
fi
echo "✅ AWS access confirmed"
echo ""

# Get ECS cluster name from infrastructure outputs
echo "2. Getting ECS cluster name..."
cd ../infra
CLUSTER_NAME=$(terraform output -raw ecs_cluster_name 2>/dev/null)
if [ $? -ne 0 ] || [ -z "$CLUSTER_NAME" ]; then
    echo "❌ Could not get cluster name from terraform output"
    echo "Trying default name..."
    CLUSTER_NAME="prequel-ecs-cluster"
fi
echo "✅ Using cluster: $CLUSTER_NAME"
cd ../portal
echo ""

# List all services in the cluster
echo "3. Listing ECS services..."
aws ecs list-services --cluster "$CLUSTER_NAME" --query 'serviceArns[*]' --output table
echo ""

# List all tasks in the cluster
echo "4. Listing ECS tasks..."
TASK_ARNS=$(aws ecs list-tasks --cluster "$CLUSTER_NAME" --query 'taskArns[*]' --output text)

if [ -z "$TASK_ARNS" ]; then
    echo "❌ No tasks found in cluster $CLUSTER_NAME"
    echo ""
    echo "Possible issues:"
    echo "- Interview creation failed before reaching ECS"
    echo "- Tasks failed to start and were stopped"
    echo "- Wrong cluster name"
    exit 1
fi

echo "✅ Found tasks, getting details..."
echo ""

# Describe tasks
echo "5. Task details..."
for TASK_ARN in $TASK_ARNS; do
    echo "📋 Task: $(basename $TASK_ARN)"
    
    # Get task details
    aws ecs describe-tasks --cluster "$CLUSTER_NAME" --tasks "$TASK_ARN" \
        --query 'tasks[0].{Status:lastStatus,Health:healthStatus,Created:createdAt,TaskDef:taskDefinitionArn,Containers:containers[].{Name:name,Status:lastStatus,Reason:reason,ExitCode:exitCode}}' \
        --output table
    echo ""
done

# Check CloudWatch log groups
echo "6. Checking CloudWatch logs..."
LOG_GROUP="/aws/ecs/prequel"

aws logs describe-log-groups --log-group-name-prefix "$LOG_GROUP" --query 'logGroups[*].logGroupName' --output table

echo ""
echo "7. Recent log streams for interview tasks..."
LOG_STREAMS=$(aws logs describe-log-streams --log-group-name "$LOG_GROUP" --order-by LastEventTime --descending --max-items 5 --query 'logStreams[?contains(logStreamName, `interview-`)].{StreamName:logStreamName,LastEvent:lastEventTime}' --output table)

if [ -z "$LOG_STREAMS" ]; then
    echo "❌ No interview log streams found"
else
    echo "$LOG_STREAMS"
fi

echo ""
echo "🔍 Debug complete. If no tasks are found, check:"
echo "1. Portal logs for terraform execution errors"
echo "2. Interview creation operation logs"
echo "3. IAM permissions for ECS task execution role"