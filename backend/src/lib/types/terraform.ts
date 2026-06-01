/**
 * Result of a Terraform command execution.
 *
 * Contains the execution status, output, and any error information
 * from running Terraform commands like init, plan, apply, or destroy.
 */
export interface TerraformExecutionResult {
  success: boolean // Whether the command executed successfully
  output: string // Primary command output (usually stdout)
  error?: string // Error message if command failed
  fullOutput?: string // Complete output including stderr and metadata
  command?: string // The original command that was executed
}

/**
 * Represents a coding interview instance with its infrastructure and metadata.
 *
 * This interface defines the complete structure of an interview including
 * AWS infrastructure details, candidate information, and current status.
 */
export interface InterviewInstance {
  id: string // Unique interview identifier (8-character UUID)
  candidateName: string // Name of the candidate taking the interview
  challenge: string // Challenge name (e.g., 'javascript', 'python')
  password: string // Generated password for VS Code access
  openaiApiKey?: string // Optional OpenAI API key
  accessUrl?: string // Full URL to access the VS Code instance
  status:
    | 'scheduled' // Waiting for scheduled start time
    | 'initializing' // Terraform provisioning AWS resources
    | 'configuring' // Infrastructure ready, ECS container booting
    | 'active' // Fully ready for candidate access
    | 'destroying' // Infrastructure being torn down
    | 'destroyed' // Infrastructure completely removed
    | 'error' // Failed state requiring manual intervention
  createdAt: Date // When the interview was created
}
