import { config } from './config'

/**
 * @deprecated Use config.aws instead. This module is kept for backward compatibility.
 *
 * Legacy AWS client configuration. Redirects to the centralized config module.
 */

/**
 * Gets AWS credentials configuration for SDK clients.
 * @deprecated Use config.aws.getCredentials() instead
 */
export const getAWSCredentials = () => {
  return config.aws.getCredentials()
}

/**
 * Gets the AWS region from environment variables.
 * @deprecated Use config.aws.region instead
 */
export const getAWSRegion = (): string => {
  return config.aws.region
}

/**
 * Gets the current deployment context for logging.
 * @deprecated Use config.aws.deploymentContext instead
 */
export const getDeploymentContext = (): 'ecs' | 'local' => {
  return config.aws.deploymentContext
}
