import json
import boto3
import logging
from typing import Dict, Any

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler that logs ECR image pushes and provides foundation for SOCI indexing.
    Note: Full SOCI index generation requires containerd which is not available in Lambda.
    For production SOCI indexing, consider using AWS's official SOCI Index Builder.
    """
    try:
        logger.info(f"Received event: {json.dumps(event)}")
        
        # Parse the EventBridge event
        detail = event.get('detail', {})
        repository_name = detail.get('repository-name')
        image_digest = detail.get('image-digest')
        image_tag = detail.get('image-tag') or 'latest'  # Handle empty string
        result = detail.get('result')
        action_type = detail.get('action-type')
        
        if not repository_name:
            logger.error("Missing repository name in event")
            return {
                'statusCode': 400,
                'body': json.dumps('Missing repository name')
            }
            
        if result != 'SUCCESS':
            logger.info(f"Skipping non-successful event: result={result}")
            return {
                'statusCode': 200,
                'body': json.dumps('Skipped non-successful push event')
            }
            
        if action_type != 'PUSH':
            logger.info(f"Skipping non-push event: action_type={action_type}")
            return {
                'statusCode': 200,
                'body': json.dumps('Skipped non-push event')
            }
        
        logger.info(f"Successfully processed ECR image push for {repository_name}")
        logger.info(f"Image digest: {image_digest}")
        logger.info(f"Image tag: {image_tag}")
        
        # Get ECR repository URI for logging
        sts_client = boto3.client('sts')
        account_id = sts_client.get_caller_identity()['Account']
        region = boto3.Session().region_name or 'your-aws-region'
        
        repository_uri = f"{account_id}.dkr.ecr.{region}.amazonaws.com/{repository_name}"
        
        # Use image digest if tag is not available or is empty
        if image_tag and image_tag != 'latest':
            image_uri = f"{repository_uri}:{image_tag}"
        elif image_digest:
            image_uri = f"{repository_uri}@{image_digest}"
        else:
            image_uri = f"{repository_uri}:latest"
        
        logger.info(f"Image URI: {image_uri}")
        logger.info("ECR image push event processed successfully")
        logger.info("Note: SOCI index generation requires AWS SOCI Index Builder for production use")
        
        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': 'ECR image push event processed successfully',
                'repository': repository_name,
                'image_tag': image_tag,
                'image_digest': image_digest,
                'image_uri': image_uri,
                'note': 'For SOCI indexing, consider using AWS SOCI Index Builder'
            })
        }
        
    except Exception as e:
        logger.error(f"Error processing event: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps(f'Error: {str(e)}')
        }

# Note: SOCI CLI functions removed as they require containerd which is not available in Lambda
# For production SOCI indexing, use AWS's official SOCI Index Builder CloudFormation template