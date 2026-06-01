/**
 * Gets the AWS CLI prefix for commands.
 * For local development, returns empty string since AWS_PROFILE env var is set.
 * For ECS, returns empty string since IAM roles are used.
 */
export function getAwsCliPrefix(): string {
  return ''
}

/**
 * Processes and formats Terraform command output for streaming display.
 *
 * Cleans ANSI color codes and prefixes each line with [Terraform] for
 * clear identification in mixed log output. Preserves line structure
 * and handles empty lines appropriately.
 *
 * @param output - Raw Terraform command output
 * @param onData - Optional callback to receive formatted output
 */
export function processTerraformOutput(output: string, onData?: (data: string) => void): void {
  if (!onData) return

  // Strip ANSI color codes for clean display
  // eslint-disable-next-line no-control-regex -- intentionally matching the ESC control char
  const cleanOutput = output.replaceAll(/\x1b\[[0-9;]*m/g, '')
  // Split into lines and prefix each line with [Terraform]
  const lines = cleanOutput.split('\n')
  lines.forEach((line, index) => {
    // Only send non-empty lines, and preserve the last newline if it exists
    if (line || (index === lines.length - 1 && cleanOutput.endsWith('\n'))) {
      onData(
        '[Terraform] ' +
          line +
          (index < lines.length - 1 || cleanOutput.endsWith('\n') ? '\n' : ''),
      )
    }
  })
}
