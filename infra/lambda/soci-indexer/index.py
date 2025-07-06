import json
import boto3
import subprocess
import os
import tempfile
import logging
from typing import Dict, Any

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler that generates SOCI index for newly pushed ECR images.
    """
    try:
        logger.info(f"Received event: {json.dumps(event)}")
        
        # Parse the EventBridge event
        detail = event.get('detail', {})
        repository_name = detail.get('repository-name')
        image_digest = detail.get('image-digest')
        image_tag = detail.get('image-tag', 'latest')
        
        if not repository_name or not image_digest:
            logger.error("Missing required event data")
            return {
                'statusCode': 400,
                'body': json.dumps('Missing repository name or image digest')
            }
        
        logger.info(f"Processing SOCI index for {repository_name}:{image_tag}")
        
        # Get ECR repository URI
        ecr_client = boto3.client('ecr')
        sts_client = boto3.client('sts')
        
        account_id = sts_client.get_caller_identity()['Account']
        region = boto3.Session().region_name
        
        repository_uri = f"{account_id}.dkr.ecr.{region}.amazonaws.com/{repository_name}"
        image_uri = f"{repository_uri}:{image_tag}"
        
        logger.info(f"Repository URI: {repository_uri}")
        logger.info(f"Image URI: {image_uri}")
        
        # Install SOCI CLI in Lambda environment
        install_soci()
        
        # Authenticate with ECR
        authenticate_ecr(ecr_client, repository_uri)
        
        # Generate SOCI index
        generate_soci_index(image_uri)
        
        logger.info("SOCI index generated successfully")
        
        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': 'SOCI index generated successfully',
                'repository': repository_name,
                'image_tag': image_tag
            })
        }
        
    except Exception as e:
        logger.error(f"Error processing event: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps(f'Error: {str(e)}')
        }

def install_soci():
    """Install SOCI CLI in Lambda environment"""
    logger.info("Installing SOCI CLI...")
    
    # Create temp directory
    with tempfile.TemporaryDirectory() as temp_dir:
        soci_path = os.path.join(temp_dir, 'soci.tar.gz')
        
        # Download SOCI CLI binary using urllib instead of curl
        import urllib.request
        
        try:
            logger.info("Downloading SOCI CLI...")
            urllib.request.urlretrieve(
                'https://github.com/awslabs/soci-snapshotter/releases/latest/download/soci-snapshotter-0.11.1-linux-amd64.tar.gz',
                soci_path
            )
            logger.info("SOCI CLI downloaded successfully")
            
            # Extract the tar.gz
            extract_cmd = ['tar', '-xzf', soci_path, '-C', temp_dir]
            subprocess.run(extract_cmd, check=True, capture_output=True)
            
            # Make it executable and move to /tmp (which is writable in Lambda)
            soci_binary = os.path.join(temp_dir, 'soci-snapshotter-0.11.1-linux-amd64', 'soci')
            final_soci_path = '/tmp/soci'
            
            subprocess.run(['cp', soci_binary, final_soci_path], check=True)
            subprocess.run(['chmod', '+x', final_soci_path], check=True)
            
            # Add to PATH
            os.environ['PATH'] = f"/tmp:{os.environ.get('PATH', '')}"
            
            logger.info("SOCI CLI installed successfully")
            
        except subprocess.CalledProcessError as e:
            logger.error(f"Failed to install SOCI CLI: {e}")
            raise

def authenticate_ecr(ecr_client, repository_uri: str):
    """Authenticate Docker with ECR"""
    logger.info("Authenticating with ECR...")
    
    try:
        # Get ECR authorization token
        auth_response = ecr_client.get_authorization_token()
        auth_data = auth_response['authorizationData'][0]
        
        # Decode the authorization token
        import base64
        auth_token = base64.b64decode(auth_data['authorizationToken']).decode('utf-8')
        username, password = auth_token.split(':')
        
        # Login to ECR using Docker
        login_cmd = [
            'docker', 'login',
            '--username', username,
            '--password-stdin',
            auth_data['proxyEndpoint']
        ]
        
        process = subprocess.Popen(login_cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        stdout, stderr = process.communicate(input=password.encode())
        
        if process.returncode != 0:
            raise Exception(f"Docker login failed: {stderr.decode()}")
            
        logger.info("ECR authentication successful")
        
    except Exception as e:
        logger.error(f"ECR authentication failed: {str(e)}")
        raise

def generate_soci_index(image_uri: str):
    """Generate SOCI index for the given image"""
    logger.info(f"Generating SOCI index for {image_uri}")
    
    try:
        # Create SOCI index
        create_cmd = ['/tmp/soci', 'create', image_uri]
        result = subprocess.run(create_cmd, check=True, capture_output=True, text=True)
        logger.info(f"SOCI create output: {result.stdout}")
        
        # Push SOCI index
        push_cmd = ['/tmp/soci', 'push', image_uri]
        result = subprocess.run(push_cmd, check=True, capture_output=True, text=True)
        logger.info(f"SOCI push output: {result.stdout}")
        
        logger.info("SOCI index created and pushed successfully")
        
    except subprocess.CalledProcessError as e:
        logger.error(f"SOCI index generation failed: {e}")
        logger.error(f"SOCI stderr: {e.stderr}")
        raise Exception(f"SOCI index generation failed: {e.stderr}")