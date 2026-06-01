// Vitest setup: make the suite hermetic regardless of local AWS config.
//
// Several lib modules instantiate AWS SDK clients at import time via
// config.aws.getCredentials(), which throws when no AWS_PROFILE is set and the
// process isn't in ECS (e.g. CI). Tests mock the AWS SDK, so they only need
// module load to succeed — pin the ECS branch (returns region only) and disable
// the scheduler's polling loop.
process.env.AWS_EXECUTION_ENV ||= 'AWS_ECS_FARGATE'
process.env.AWS_REGION ||= 'us-east-1'
process.env.DISABLE_SCHEDULER ||= 'true'
