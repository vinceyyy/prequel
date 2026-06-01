import {
  ChallengeValidator,
  challengeService,
  getCpuCores,
  terraformManager
} from "./chunk-4VZXAOJ5.js";
import {
  apiKeyManager,
  assessmentManager,
  generateId,
  generateSecureString,
  interviewManager,
  openaiService,
  operationManager
} from "./chunk-4AJFIXKU.js";
import {
  authLogger,
  logger
} from "./chunk-QOQWQKGY.js";
import {
  config
} from "./chunk-BJRZHASW.js";

// src/server.ts
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono as Hono12 } from "hono";
import { logger as honoLogger } from "hono/logger";

// src/middleware/auth.ts
import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";

// src/lib/auth.ts
import { createHmac, randomBytes } from "crypto";
var SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1e3;
function getSecret() {
  const passcode = process.env.AUTH_PASSCODE || "";
  const additionalSecret = process.env.AUTH_SECRET || "default-secret-change-me";
  return `${passcode}:${additionalSecret}`;
}
function createSessionToken() {
  const expiresAt = Date.now() + SESSION_DURATION_MS;
  const payload = String(expiresAt);
  const signature = createHmac("sha256", getSecret()).update(payload).digest("hex");
  return `${payload}.${signature}`;
}
function validateSessionToken(token) {
  if (!token || typeof token !== "string") {
    return false;
  }
  const parts = token.split(".");
  if (parts.length !== 2) {
    return false;
  }
  const [timestampStr, providedSignature] = parts;
  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp)) {
    return false;
  }
  if (Date.now() > timestamp) {
    return false;
  }
  const expectedSignature = createHmac("sha256", getSecret()).update(timestampStr).digest("hex");
  if (providedSignature.length !== expectedSignature.length) {
    return false;
  }
  let isValid = true;
  for (let i = 0; i < providedSignature.length; i++) {
    if (providedSignature[i] !== expectedSignature[i]) {
      isValid = false;
    }
  }
  return isValid;
}
function validatePasscode(passcode) {
  const expectedPasscode = process.env.AUTH_PASSCODE;
  if (!expectedPasscode || !passcode) {
    return false;
  }
  if (passcode.length !== expectedPasscode.length) {
    return false;
  }
  let isValid = true;
  for (let i = 0; i < passcode.length; i++) {
    if (passcode[i] !== expectedPasscode[i]) {
      isValid = false;
    }
  }
  return isValid;
}

// src/middleware/auth.ts
var AUTH_COOKIE = "auth-token";
function isPublicPath(path) {
  if (path === "/api/auth/login" || path === "/api/auth/logout" || path === "/api/health") {
    return true;
  }
  return path.startsWith("/api/apikey/") || path.startsWith("/api/takehome/");
}
var authMiddleware = createMiddleware(async (c, next) => {
  if (!config.auth.enabled) {
    return next();
  }
  if (isPublicPath(c.req.path)) {
    return next();
  }
  const token = getCookie(c, AUTH_COOKIE);
  if (!token || !validateSessionToken(token)) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return next();
});

// src/routes/index.ts
import { Hono as Hono11 } from "hono";

// src/routes/admin.ts
import { Hono } from "hono";

// src/lib/cleanup.ts
import { exec } from "child_process";
import { promisify } from "util";
var execAsync = promisify(exec);
var CleanupService = class {
  isRunningInECS;
  awsProfile;
  constructor() {
    this.isRunningInECS = config.aws.deploymentContext === "ecs";
    this.awsProfile = config.aws.profile || "";
  }
  /**
   * Performs comprehensive cleanup of dangling AWS resources and workspace files.
   *
   * @param options - Cleanup configuration options
   * @returns Promise with detailed cleanup results
   */
  async performCleanup(options = {}) {
    const {
      dryRun = false,
      forceDestroy = false,
      maxConcurrency = 3,
      timeout = 300
    } = options;
    const result = {
      success: true,
      summary: {
        workspacesFound: 0,
        workspacesDestroyed: 0,
        workspacesSkipped: 0,
        workspacesErrored: 0,
        danglingResourcesFound: 0,
        danglingResourcesCleaned: 0
      },
      details: [],
      workspaceResults: []
    };
    try {
      logger.info("Starting comprehensive cleanup operation", {
        dryRun,
        forceDestroy,
        maxConcurrency,
        timeout
      });
      result.details.push(`\u{1F9F9} Starting cleanup operation (dry run: ${dryRun})`);
      result.details.push(
        "\u{1F4CB} Step 1: Discovering terraform workspaces in S3..."
      );
      const workspaceIds = await this.listAllWorkspaces();
      result.summary.workspacesFound = workspaceIds.length;
      result.details.push(`Found ${workspaceIds.length} workspaces in S3`);
      if (workspaceIds.length === 0) {
        result.details.push("\u2705 No workspaces found - nothing to clean up");
        return result;
      }
      result.details.push("\u{1F50D} Step 2: Checking interview status in DynamoDB...");
      const existingInterviews = await this.getExistingInterviews(workspaceIds);
      result.details.push(
        `${existingInterviews.size} interviews still exist in DynamoDB`
      );
      const danglingWorkspaces = workspaceIds.filter(
        (id) => !existingInterviews.has(id)
      );
      const activeWorkspaces = workspaceIds.filter(
        (id) => existingInterviews.has(id)
      );
      result.summary.danglingResourcesFound = danglingWorkspaces.length;
      result.details.push(
        `${danglingWorkspaces.length} dangling workspaces found`
      );
      result.details.push(
        `${activeWorkspaces.length} workspaces still have active interviews`
      );
      if (danglingWorkspaces.length === 0 && !forceDestroy) {
        result.details.push(
          "\u2705 No dangling workspaces found - nothing to clean up"
        );
        return result;
      }
      if (activeWorkspaces.length > 0 && forceDestroy) {
        result.details.push(
          `\u26A0\uFE0F  Force destroy enabled - will clean up ${activeWorkspaces.length} active workspaces`
        );
        danglingWorkspaces.push(...activeWorkspaces);
      } else if (activeWorkspaces.length > 0) {
        result.details.push(
          `\u23ED\uFE0F  Skipping ${activeWorkspaces.length} active workspaces (use forceDestroy to clean these)`
        );
        activeWorkspaces.forEach((id) => {
          result.workspaceResults.push({
            interviewId: id,
            status: "skipped",
            reason: "Active interview exists in DynamoDB"
          });
          result.summary.workspacesSkipped++;
        });
      }
      if (dryRun) {
        result.details.push(
          `\u{1F50D} DRY RUN: Would clean up ${danglingWorkspaces.length} workspaces:`
        );
        danglingWorkspaces.forEach((id) => {
          result.details.push(`  - ${id}`);
          result.workspaceResults.push({
            interviewId: id,
            status: "skipped",
            reason: "Dry run mode"
          });
        });
        return result;
      }
      result.details.push(
        `\u{1F680} Step 5: Cleaning up ${danglingWorkspaces.length} dangling workspaces...`
      );
      await this.cleanupWorkspacesConcurrently(
        danglingWorkspaces,
        maxConcurrency,
        timeout,
        result
      );
      result.details.push("\u2705 Step 6: Cleanup completed");
      result.details.push(
        `Summary: ${result.summary.workspacesDestroyed} destroyed, ${result.summary.workspacesSkipped} skipped, ${result.summary.workspacesErrored} errors`
      );
      if (result.summary.workspacesErrored > 0) {
        result.success = false;
        result.error = `${result.summary.workspacesErrored} workspaces failed to clean up`;
      }
      logger.info("Cleanup operation completed", result.summary);
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      logger.error("Cleanup operation failed", { error: errorMsg });
      result.success = false;
      result.error = errorMsg;
      result.details.push(`\u274C Cleanup failed: ${errorMsg}`);
      return result;
    }
  }
  /**
   * Lists all terraform workspaces stored in S3.
   */
  async listAllWorkspaces() {
    try {
      const checkResult = await execAsync(
        `aws s3api head-bucket --bucket ${config.storage.instanceBucket} 2>/dev/null && echo "exists" || echo "not-exists"`,
        {
          env: process.env,
          timeout: 1e4
        }
      ).catch(() => ({ stdout: "not-exists", stderr: "" }));
      if (checkResult.stdout.trim() === "not-exists") {
        logger.info(
          "Instance bucket does not exist - no workspaces to clean up"
        );
        return [];
      }
      const { stdout } = await execAsync(
        `aws s3 ls s3://${config.storage.instanceBucket}/workspaces/ --recursive`,
        {
          env: process.env,
          timeout: 3e4
        }
      );
      if (!stdout || stdout.trim() === "") {
        logger.info("No workspaces found in S3 bucket");
        return [];
      }
      const workspaceIds = /* @__PURE__ */ new Set();
      const lines = stdout.split("\n").filter((line) => line.trim());
      for (const line of lines) {
        const match = line.match(/workspaces\/([^\/]+)\//);
        if (match && match[1] && match[1] !== ".directory") {
          workspaceIds.add(match[1]);
        }
      }
      logger.info(`Found ${workspaceIds.size} workspaces in S3`, {
        workspaceIds: Array.from(workspaceIds)
      });
      return Array.from(workspaceIds);
    } catch (error) {
      if (error instanceof Error) {
        const errorMessage = error.message || "";
        if (errorMessage.includes("NoSuchBucket")) {
          logger.info(
            "Instance bucket does not exist - no workspaces to clean up"
          );
          return [];
        }
        if (errorMessage.includes("NoSuchKey") || errorMessage.includes("does not exist") || errorMessage.includes("Command failed: aws s3 ls")) {
          logger.info("No workspaces found in S3 - nothing to clean up");
          return [];
        }
        if (errorMessage.includes("AccessDenied") || errorMessage.includes("Forbidden")) {
          logger.warn("Access denied to S3 bucket - check AWS permissions", {
            bucket: config.storage.instanceBucket
          });
          throw new Error(
            `Access denied to S3 bucket: ${config.storage.instanceBucket}. Check AWS permissions.`
          );
        }
      }
      logger.info("No workspaces found or unable to list S3 contents", {
        error: error instanceof Error ? error.message : "Unknown error"
      });
      return [];
    }
  }
  /**
   * Gets the set of interview IDs that still exist in DynamoDB.
   */
  async getExistingInterviews(workspaceIds) {
    const existingInterviews = /* @__PURE__ */ new Set();
    const batchSize = 25;
    for (let i = 0; i < workspaceIds.length; i += batchSize) {
      const batch = workspaceIds.slice(i, i + batchSize);
      const batchPromises = batch.map(async (interviewId) => {
        try {
          const interview = await interviewManager.getInterview(interviewId);
          if (interview) {
            existingInterviews.add(interviewId);
          }
        } catch (error) {
          logger.debug(`Interview ${interviewId} not found in DynamoDB`, {
            error
          });
        }
      });
      await Promise.all(batchPromises);
      if (i + batchSize < workspaceIds.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    return existingInterviews;
  }
  /**
   * Cleans up workspaces with controlled concurrency.
   */
  async cleanupWorkspacesConcurrently(workspaceIds, maxConcurrency, timeoutSeconds, result) {
    let activeOperations = 0;
    const processWorkspace = async (interviewId) => {
      while (activeOperations >= maxConcurrency) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      activeOperations++;
      try {
        result.details.push(`\u{1F525} Destroying workspace: ${interviewId}`);
        const destroyResult = await Promise.race([
          terraformManager.destroyInterviewStreaming(interviewId, (output) => {
            logger.debug(`Terraform output for ${interviewId}`, {
              output: output.trim()
            });
          }),
          // Timeout after specified seconds
          new Promise(
            (_, reject) => setTimeout(
              () => reject(new Error("Operation timed out")),
              timeoutSeconds * 1e3
            )
          )
        ]);
        if (destroyResult.success) {
          result.workspaceResults.push({
            interviewId,
            status: "destroyed"
          });
          result.summary.workspacesDestroyed++;
          result.summary.danglingResourcesCleaned++;
          result.details.push(`\u2705 Successfully destroyed: ${interviewId}`);
        } else {
          result.workspaceResults.push({
            interviewId,
            status: "error",
            error: destroyResult.error
          });
          result.summary.workspacesErrored++;
          result.details.push(
            `\u274C Failed to destroy: ${interviewId} - ${destroyResult.error}`
          );
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        result.workspaceResults.push({
          interviewId,
          status: "error",
          error: errorMsg
        });
        result.summary.workspacesErrored++;
        result.details.push(`\u274C Error destroying: ${interviewId} - ${errorMsg}`);
      } finally {
        activeOperations--;
      }
    };
    await Promise.all(workspaceIds.map(processWorkspace));
  }
  /**
   * Lists all dangling resources without cleaning them up.
   * Useful for reporting and monitoring.
   */
  async listDanglingResources() {
    const workspaces = await this.listAllWorkspaces();
    const existingInterviews = await this.getExistingInterviews(workspaces);
    const danglingWorkspaces = workspaces.filter(
      (id) => !existingInterviews.has(id)
    );
    return {
      workspaces,
      existingInterviews: Array.from(existingInterviews),
      danglingWorkspaces
    };
  }
};
var cleanupService = new CleanupService();

// src/routes/admin.ts
var adminRouter = new Hono();
adminRouter.get("/cleanup", async (c) => {
  try {
    logger.info("[Cleanup API] Listing dangling resources");
    const danglingResources = await cleanupService.listDanglingResources();
    logger.info("[Cleanup API] Found dangling resources", {
      totalWorkspaces: danglingResources.workspaces.length,
      existingInterviews: danglingResources.existingInterviews.length,
      danglingWorkspaces: danglingResources.danglingWorkspaces.length
    });
    return c.json({
      success: true,
      message: "Dangling resources listed successfully",
      data: {
        totalWorkspaces: danglingResources.workspaces.length,
        existingInterviews: danglingResources.existingInterviews.length,
        danglingWorkspaces: danglingResources.danglingWorkspaces.length,
        workspaces: danglingResources.workspaces,
        existingInterviewsList: danglingResources.existingInterviews,
        danglingWorkspacesList: danglingResources.danglingWorkspaces
      }
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    logger.error("[Cleanup API] Failed to list dangling resources", {
      error: errorMsg
    });
    return c.json(
      {
        success: false,
        error: "Failed to list dangling resources",
        details: errorMsg
      },
      500
    );
  }
});
adminRouter.post("/cleanup", async (c) => {
  try {
    const dryRun = c.req.query("dryRun") === "true";
    const forceDestroy = c.req.query("forceDestroy") === "true";
    const maxConcurrency = parseInt(c.req.query("maxConcurrency") || "3", 10);
    const timeout = parseInt(c.req.query("timeout") || "300", 10);
    if (maxConcurrency < 1 || maxConcurrency > 10) {
      return c.json(
        {
          success: false,
          error: "maxConcurrency must be between 1 and 10"
        },
        400
      );
    }
    if (timeout < 60 || timeout > 1800) {
      return c.json(
        {
          success: false,
          error: "timeout must be between 60 and 1800 seconds"
        },
        400
      );
    }
    logger.info("[Cleanup API] Starting cleanup operation", {
      dryRun,
      forceDestroy,
      maxConcurrency,
      timeout
    });
    const result = await cleanupService.performCleanup({
      dryRun,
      forceDestroy,
      maxConcurrency,
      timeout
    });
    logger.info("[Cleanup API] Cleanup operation completed", result.summary);
    const status = result.success ? 200 : 207;
    return c.json(
      {
        success: result.success,
        message: result.success ? "Cleanup completed successfully" : "Cleanup completed with some errors",
        error: result.error,
        summary: result.summary,
        details: result.details,
        workspaceResults: result.workspaceResults
      },
      status
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    logger.error("[Cleanup API] Cleanup operation failed", { error: errorMsg });
    return c.json(
      {
        success: false,
        error: "Cleanup operation failed",
        details: errorMsg
      },
      500
    );
  }
});

// src/routes/apikeyPublic.ts
import { Hono as Hono2 } from "hono";
var apikeyPublicRouter = new Hono2();
apikeyPublicRouter.get("/:token", async (c) => {
  try {
    const token = c.req.param("token");
    const apiKey = await apiKeyManager.getApiKeyByToken(token);
    if (!apiKey) {
      return c.json({ error: "Invalid or expired access link" }, 404);
    }
    const now = Math.floor(Date.now() / 1e3);
    if (apiKey.status === "available" && apiKey.availableUntil && apiKey.availableUntil < now) {
      return c.json({
        key: {
          status: "expired",
          name: apiKey.name
        }
      });
    }
    let timeRemaining;
    if (apiKey.status === "active" && apiKey.expiresAt) {
      timeRemaining = Math.max(0, apiKey.expiresAt - now);
    }
    return c.json({
      key: {
        status: apiKey.status,
        name: apiKey.name,
        apiKey: apiKey.status === "active" ? apiKey.apiKey : void 0,
        durationSeconds: apiKey.durationSeconds,
        availableUntil: apiKey.availableUntil,
        activatedAt: apiKey.activatedAt,
        expiresAt: apiKey.expiresAt,
        expiredAt: apiKey.expiredAt,
        scheduledAt: apiKey.scheduledAt,
        timeRemaining
      }
    });
  } catch (error) {
    console.error("Error getting API key status:", error);
    return c.json({ error: "Failed to get API key status" }, 500);
  }
});
apikeyPublicRouter.post("/:token/activate", async (c) => {
  try {
    const token = c.req.param("token");
    const apiKey = await apiKeyManager.getApiKeyByToken(token);
    if (!apiKey) {
      return c.json({ error: "Invalid or expired access link" }, 404);
    }
    const now = Math.floor(Date.now() / 1e3);
    if (apiKey.status !== "available") {
      if (apiKey.status === "active") {
        return c.json({
          success: true,
          apiKey: apiKey.apiKey,
          expiresAt: apiKey.expiresAt,
          timeRemaining: apiKey.expiresAt ? apiKey.expiresAt - now : void 0
        });
      } else if (apiKey.status === "scheduled") {
        return c.json(
          {
            error: "This API key is scheduled for future availability and cannot be activated yet"
          },
          400
        );
      } else if (apiKey.status === "expired") {
        return c.json(
          { error: "This API key has expired and cannot be activated" },
          400
        );
      } else if (apiKey.status === "revoked") {
        return c.json(
          { error: "This API key has been revoked and cannot be activated" },
          400
        );
      } else {
        return c.json(
          {
            error: `API key cannot be activated from status: ${apiKey.status}`
          },
          400
        );
      }
    }
    if (apiKey.availableUntil && apiKey.availableUntil < now) {
      await apiKeyManager.updateStatus(apiKey.id, "expired", {
        expiredAt: now
      });
      return c.json({ error: "This API key is no longer available" }, 400);
    }
    const result = await openaiService.createServiceAccount(
      config.services.openaiProjectId,
      `interview-${config.project.environment}-apikey-${apiKey.id}-${apiKey.name}`
    );
    if (!result.success) {
      await apiKeyManager.updateStatus(apiKey.id, "error");
      return c.json({ error: `Failed to create API key: ${result.error}` }, 500);
    }
    const expiresAt = now + apiKey.durationSeconds;
    await apiKeyManager.updateStatus(apiKey.id, "active", {
      activatedAt: now,
      expiresAt,
      serviceAccountId: result.serviceAccountId,
      apiKey: result.apiKey
    });
    return c.json({
      success: true,
      apiKey: result.apiKey,
      expiresAt,
      timeRemaining: apiKey.durationSeconds
    });
  } catch (error) {
    console.error("Error activating API key:", error);
    return c.json({ error: "Failed to activate API key" }, 500);
  }
});

// src/routes/apikeys.ts
import { Hono as Hono3 } from "hono";

// src/lib/apiKeyListService.ts
var openaiAccountsCache = null;
var CACHE_TTL_MS = 3e4;
function mapInterviewStatusToKeyStatus(status) {
  switch (status) {
    case "scheduled":
      return "scheduled";
    case "initializing":
    case "configuring":
    case "active":
      return "active";
    case "destroying":
    case "destroyed":
      return "expired";
    case "error":
      return "error";
    default:
      return "expired";
  }
}
function mapTakeHomeStatusToKeyStatus(sessionStatus, instanceStatus) {
  if (sessionStatus === "available") return "available";
  if (sessionStatus === "activated") {
    if (["initializing", "configuring", "active"].includes(instanceStatus))
      return "active";
    if (["destroying", "destroyed"].includes(instanceStatus)) return "expired";
  }
  if (["completed", "expired", "revoked"].includes(sessionStatus))
    return "expired";
  return "error";
}
async function getOpenAIAccounts() {
  const now = Date.now();
  if (openaiAccountsCache && now - openaiAccountsCache.timestamp < CACHE_TTL_MS) {
    return { accounts: openaiAccountsCache.accounts, success: true };
  }
  try {
    const result = await openaiService.listServiceAccounts(
      config.services.openaiProjectId
    );
    if (result.success && result.accounts) {
      openaiAccountsCache = { accounts: result.accounts, timestamp: now };
      return { accounts: result.accounts, success: true };
    }
    return { accounts: [], success: false };
  } catch (error) {
    logger.warn("Failed to fetch OpenAI accounts for orphan detection", {
      error
    });
    return { accounts: [], success: false };
  }
}
async function listAllApiKeys() {
  const keys = [];
  let orphanCheckFailed = false;
  try {
    const [standaloneKeys, interviews, takeHomes, openaiResult] = await Promise.all([
      apiKeyManager.getActiveKeys().catch(() => []),
      interviewManager.getActiveInterviews().catch(() => []),
      assessmentManager.listTakeHomes().catch(() => []),
      getOpenAIAccounts()
    ]);
    const historicalKeys = await apiKeyManager.getHistoricalKeys().catch(() => []);
    const knownServiceAccountIds = /* @__PURE__ */ new Set();
    for (const key of [...standaloneKeys, ...historicalKeys]) {
      if (key.serviceAccountId) {
        knownServiceAccountIds.add(key.serviceAccountId);
      }
      keys.push({
        id: key.id,
        name: key.name,
        description: key.description,
        status: key.status,
        provider: key.provider,
        source: "standalone",
        apiKey: key.apiKey,
        accessToken: key.accessToken,
        createdAt: key.createdAt,
        scheduledAt: key.scheduledAt,
        activatedAt: key.activatedAt,
        expiresAt: key.expiresAt,
        expiredAt: key.expiredAt
      });
    }
    for (const interview of interviews) {
      if (interview.openaiServiceAccountId) {
        knownServiceAccountIds.add(interview.openaiServiceAccountId);
        keys.push({
          id: `interview-${interview.id}`,
          name: interview.candidateName,
          description: `Interview: ${interview.challenge}`,
          status: mapInterviewStatusToKeyStatus(interview.status),
          provider: "openai",
          source: "interview",
          sourceId: interview.id,
          createdAt: Math.floor(interview.createdAt.getTime() / 1e3),
          expiresAt: interview.autoDestroyAt ? Math.floor(interview.autoDestroyAt.getTime() / 1e3) : void 0
        });
      }
    }
    for (const takeHome of takeHomes) {
      if (takeHome.openaiServiceAccount?.serviceAccountId) {
        knownServiceAccountIds.add(
          takeHome.openaiServiceAccount.serviceAccountId
        );
        keys.push({
          id: `takehome-${takeHome.id}`,
          name: takeHome.candidateName || "Unknown",
          description: `Take-home: ${takeHome.challengeId}`,
          status: mapTakeHomeStatusToKeyStatus(
            takeHome.sessionStatus,
            takeHome.instanceStatus
          ),
          provider: "openai",
          source: "takehome",
          sourceId: takeHome.id,
          createdAt: takeHome.createdAt,
          activatedAt: takeHome.activatedAt,
          expiresAt: takeHome.autoDestroyAt
        });
      }
    }
    if (openaiResult.success) {
      for (const account of openaiResult.accounts) {
        if (!knownServiceAccountIds.has(account.id)) {
          keys.push({
            id: `orphan-${account.id}`,
            name: account.name || account.id,
            description: "Orphan service account - not tracked in database",
            status: "orphan",
            provider: "openai",
            source: "unknown",
            createdAt: account.created_at
          });
        }
      }
    } else {
      orphanCheckFailed = true;
    }
    keys.sort((a, b) => {
      if (a.status === "orphan" && b.status !== "orphan") return -1;
      if (a.status !== "orphan" && b.status === "orphan") return 1;
      return b.createdAt - a.createdAt;
    });
    const activeCount = keys.filter((k) => k.status === "active").length;
    return { keys, activeCount, orphanCheckFailed };
  } catch (error) {
    logger.error("Failed to list API keys", { error });
    throw error;
  }
}
function clearOpenAICache() {
  openaiAccountsCache = null;
}

// src/routes/apikeys.ts
var apikeysRouter = new Hono3();
apikeysRouter.get("/", async (c) => {
  try {
    const result = await listAllApiKeys();
    return c.json(result);
  } catch (error) {
    console.error("Error listing API keys:", error);
    return c.json({ error: "Failed to list API keys" }, 500);
  }
});
apikeysRouter.post("/create", async (c) => {
  try {
    const body = await c.req.json();
    const {
      name,
      description,
      activationMode,
      durationSeconds,
      scheduledAt,
      availableDays
    } = body;
    if (!name?.trim()) {
      return c.json({ error: "Name is required" }, 400);
    }
    if (!durationSeconds || durationSeconds <= 0) {
      return c.json({ error: "Duration is required" }, 400);
    }
    const maxDuration = 7 * 24 * 60 * 60;
    if (durationSeconds > maxDuration) {
      return c.json({ error: "Maximum duration is 7 days" }, 400);
    }
    const apiKeyId = generateId();
    const now = Math.floor(Date.now() / 1e3);
    let status;
    let serviceAccountId;
    let apiKey;
    let activatedAt;
    let expiresAt;
    let availableUntil;
    let scheduledAtTimestamp;
    if (activationMode === "immediate") {
      if (!config.services.openaiProjectId || !config.services.openaiAdminKey) {
        return c.json({ error: "OpenAI not configured" }, 500);
      }
      const result = await openaiService.createServiceAccount(
        config.services.openaiProjectId,
        `interview-${config.project.environment}-apikey-${apiKeyId}-${name.trim()}`
      );
      if (!result.success) {
        return c.json(
          { error: `Failed to create OpenAI key: ${result.error}` },
          500
        );
      }
      status = "active";
      serviceAccountId = result.serviceAccountId;
      apiKey = result.apiKey;
      activatedAt = now;
      expiresAt = now + durationSeconds;
    } else if (activationMode === "scheduled") {
      if (!scheduledAt) {
        return c.json(
          { error: "scheduledAt is required for scheduled mode" },
          400
        );
      }
      scheduledAtTimestamp = Math.floor(new Date(scheduledAt).getTime() / 1e3);
      if (scheduledAtTimestamp <= now) {
        return c.json({ error: "scheduledAt must be in the future" }, 400);
      }
      status = "scheduled";
    } else if (activationMode === "recipient") {
      const days = availableDays || 7;
      availableUntil = now + days * 24 * 60 * 60;
      status = "available";
    } else {
      return c.json({ error: "Invalid activation mode" }, 400);
    }
    const createdKey = await apiKeyManager.createApiKey({
      id: apiKeyId,
      name: name.trim(),
      description: description?.trim(),
      status,
      provider: "openai",
      activationMode,
      durationSeconds,
      serviceAccountId,
      apiKey,
      activatedAt,
      expiresAt,
      availableUntil,
      scheduledAt: scheduledAtTimestamp
    });
    return c.json({
      success: true,
      apiKey: createdKey
    });
  } catch (error) {
    console.error("Error creating API key:", error);
    return c.json({ error: "Failed to create API key" }, 500);
  }
});
apikeysRouter.post("/:id/revoke", async (c) => {
  try {
    const id = c.req.param("id");
    if (id.startsWith("orphan-")) {
      const serviceAccountId = id.replace("orphan-", "");
      if (config.services.openaiProjectId) {
        const result = await openaiService.deleteServiceAccount(
          config.services.openaiProjectId,
          serviceAccountId
        );
        if (!result.success) {
          return c.json(
            { error: `Failed to delete orphan: ${result.error}` },
            500
          );
        }
        clearOpenAICache();
      }
      return c.json({ success: true });
    }
    const apiKey = await apiKeyManager.getApiKey(id);
    if (!apiKey) {
      return c.json({ error: "API key not found" }, 404);
    }
    if (apiKey.serviceAccountId && config.services.openaiProjectId) {
      const result = await openaiService.deleteServiceAccount(
        config.services.openaiProjectId,
        apiKey.serviceAccountId
      );
      if (!result.success) {
        console.error("Failed to delete OpenAI service account:", result.error);
      }
    }
    const now = Math.floor(Date.now() / 1e3);
    await apiKeyManager.updateStatus(apiKey.id, "revoked", { expiredAt: now });
    return c.json({ success: true });
  } catch (error) {
    console.error("Error revoking API key:", error);
    return c.json({ error: "Failed to revoke API key" }, 500);
  }
});
apikeysRouter.get("/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const apiKey = await apiKeyManager.getApiKey(id);
    if (!apiKey) {
      return c.json({ error: "API key not found" }, 404);
    }
    return c.json({ apiKey });
  } catch (error) {
    console.error("Error getting API key:", error);
    return c.json({ error: "Failed to get API key" }, 500);
  }
});
apikeysRouter.delete("/:id", async (c) => {
  try {
    const id = c.req.param("id");
    await apiKeyManager.deleteApiKey(id);
    return c.json({ success: true });
  } catch (error) {
    console.error("Error deleting API key:", error);
    return c.json({ error: "Failed to delete API key" }, 500);
  }
});

// src/routes/auth.ts
import { Hono as Hono4 } from "hono";
import { setCookie } from "hono/cookie";
var SESSION_MAX_AGE = 30 * 24 * 60 * 60;
var authRouter = new Hono4();
authRouter.post("/login", async (c) => {
  const clientIp = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "unknown";
  try {
    const { passcode } = await c.req.json();
    if (process.env.ENABLE_AUTH === "false") {
      authLogger.info("Login attempt - auth disabled, allowing access", {
        clientIp
      });
      return c.json({ success: true });
    }
    if (!passcode || !validatePasscode(passcode)) {
      authLogger.warn("Login attempt failed - invalid passcode", {
        clientIp,
        hasPasscode: !!passcode
      });
      return c.json({ error: "Invalid passcode" }, 401);
    }
    const sessionToken = createSessionToken();
    setCookie(c, AUTH_COOKIE, sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Strict",
      maxAge: SESSION_MAX_AGE,
      path: "/"
    });
    authLogger.info("Login successful - session token created", {
      clientIp,
      cookieMaxAge: "30d",
      secure: process.env.NODE_ENV === "production"
    });
    return c.json({ success: true });
  } catch (error) {
    authLogger.error("Login error - unexpected exception", {
      clientIp,
      error: error instanceof Error ? error.message : "Unknown error"
    });
    return c.json({ error: "Internal server error" }, 500);
  }
});
authRouter.post("/logout", (c) => {
  setCookie(c, AUTH_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Strict",
    maxAge: 0,
    path: "/"
  });
  return c.json({ success: true });
});

// src/routes/challenges.ts
import { Hono as Hono5 } from "hono";
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand
} from "@aws-sdk/client-s3";
import JSZip from "jszip";
var s3Client = new S3Client(config.aws.getCredentials());
var BUCKET_NAME = config.storage.challengeBucket;
var challengesRouter = new Hono5();
challengesRouter.get("/", async (c) => {
  try {
    logger.info("[API] Getting available challenges from DynamoDB");
    const challenges = await challengeService.listChallenges("newest");
    const challengeOptions = challenges.map((challenge) => ({
      id: challenge.id,
      name: challenge.name,
      description: challenge.description,
      ecsConfig: {
        cpu: challenge.ecsConfig.cpu,
        cpuCores: getCpuCores(challenge.ecsConfig.cpu),
        memory: challenge.ecsConfig.memory,
        storage: challenge.ecsConfig.storage
      },
      usageCount: challenge.usageCount,
      createdAt: challenge.createdAt.toISOString(),
      lastUsedAt: challenge.lastUsedAt?.toISOString()
    }));
    logger.info(`[API] Found ${challengeOptions.length} active challenges`);
    return c.json({
      success: true,
      challenges: challengeOptions
    });
  } catch (error) {
    logger.error(
      `[API] Error fetching challenges: ${error instanceof Error ? error.message : "Unknown error"}`
    );
    return c.json({
      success: true,
      // Keep success true to avoid breaking the UI
      challenges: [],
      warning: "Challenge database unavailable, no challenges loaded"
    });
  }
});
challengesRouter.get("/manage", async (c) => {
  try {
    const sortBy = c.req.query("sortBy") || "newest";
    logger.info(`[API] Listing challenges for management (sortBy: ${sortBy})`);
    const challenges = await challengeService.listChallenges(sortBy);
    return c.json({
      success: true,
      challenges,
      count: challenges.length
    });
  } catch (error) {
    logger.error(
      `[API] Error listing challenges for management: ${error instanceof Error ? error.message : "Unknown error"}`
    );
    return c.json(
      {
        success: false,
        error: "Failed to list challenges",
        challenges: []
      },
      500
    );
  }
});
challengesRouter.post("/manage", async (c) => {
  try {
    const body = await c.req.json();
    logger.info("[API] Creating new challenge:", { name: body.name });
    const validationErrors = ChallengeValidator.validateCreateInput(body);
    if (validationErrors.length > 0) {
      return c.json(
        {
          success: false,
          error: "Validation failed",
          validationErrors
        },
        400
      );
    }
    const challenge = await challengeService.createChallenge(
      body
    );
    logger.info(`[API] Challenge created successfully: ${challenge.id}`);
    return c.json(
      {
        success: true,
        challenge
      },
      201
    );
  } catch (error) {
    logger.error(
      `[API] Error creating challenge: ${error instanceof Error ? error.message : "Unknown error"}`
    );
    if (error instanceof Error && error.message.includes("ConditionalCheckFailedException")) {
      return c.json(
        {
          success: false,
          error: "Challenge already exists"
        },
        409
      );
    }
    return c.json(
      {
        success: false,
        error: "Failed to create challenge",
        details: error instanceof Error ? error.message : "Unknown error"
      },
      500
    );
  }
});
challengesRouter.post("/manage/upload", async (c) => {
  try {
    const formData = await c.req.formData();
    const files = formData.getAll("files");
    const filePaths = formData.getAll("filePaths");
    const challengeId = formData.get("challengeId");
    const overwrite = formData.get("overwrite") === "true";
    logger.info(
      `[API] Uploading ${files.length} files for challenge: ${challengeId}`
    );
    files.forEach((file, index) => {
      logger.info(
        `[API] File ${index}: name=${file.name}, relativePath=${filePaths[index] || "undefined"}`
      );
    });
    if (!challengeId || challengeId.trim().length === 0) {
      return c.json(
        {
          success: false,
          error: "Challenge ID is required"
        },
        400
      );
    }
    if (!files || files.length === 0) {
      return c.json(
        {
          success: false,
          error: "No files provided"
        },
        400
      );
    }
    const maxFileSize = 10 * 1024 * 1024;
    const maxTotalSize = 100 * 1024 * 1024;
    let totalSize = 0;
    const invalidFiles = [];
    for (const file of files) {
      totalSize += file.size;
      if (file.size > maxFileSize) {
        invalidFiles.push(
          `${file.name} (too large: ${Math.round(file.size / 1024 / 1024)}MB)`
        );
      }
    }
    if (totalSize > maxTotalSize) {
      return c.json(
        {
          success: false,
          error: `Total upload size too large: ${Math.round(totalSize / 1024 / 1024)}MB (max: 100MB)`
        },
        400
      );
    }
    if (invalidFiles.length > 0) {
      return c.json(
        {
          success: false,
          error: "Invalid files detected",
          invalidFiles
        },
        400
      );
    }
    const fileData = files.map((file, index) => {
      const relativePath = filePaths[index] || file.name;
      return {
        file,
        relativePath,
        s3Key: `${challengeId}/${relativePath}`
      };
    });
    if (!overwrite) {
      const existingFiles = [];
      for (const fileInfo of fileData) {
        try {
          await s3Client.send(
            new HeadObjectCommand({
              Bucket: BUCKET_NAME,
              Key: fileInfo.s3Key
            })
          );
          existingFiles.push(fileInfo.relativePath);
        } catch {
        }
      }
      if (existingFiles.length > 0) {
        return c.json(
          {
            success: false,
            error: "Files already exist",
            existingFiles,
            message: "Set overwrite=true to replace existing files"
          },
          409
        );
      }
    }
    const uploadedFiles = [];
    const uploadErrors = [];
    for (const fileInfo of fileData) {
      try {
        const { file, relativePath, s3Key } = fileInfo;
        const buffer = Buffer.from(await file.arrayBuffer());
        const command = new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: s3Key,
          Body: buffer,
          ContentType: file.type || "application/octet-stream",
          Metadata: {
            originalName: file.name,
            relativePath,
            uploadedAt: (/* @__PURE__ */ new Date()).toISOString(),
            challengeId
          }
        });
        await s3Client.send(command);
        uploadedFiles.push({
          path: relativePath,
          // Store the relative path to preserve folder structure
          size: file.size,
          mimeType: file.type || "application/octet-stream",
          lastModified: /* @__PURE__ */ new Date()
        });
        logger.info(`[API] Uploaded file: ${s3Key}`);
      } catch (error) {
        logger.error(
          `[API] Failed to upload file ${fileInfo.relativePath}: ${error instanceof Error ? error.message : "Unknown error"}`
        );
        uploadErrors.push(
          `${fileInfo.relativePath}: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
    }
    if (uploadErrors.length > 0 && uploadedFiles.length === 0) {
      return c.json(
        {
          success: false,
          error: "All file uploads failed",
          uploadErrors
        },
        500
      );
    }
    logger.info(
      `[API] Successfully uploaded ${uploadedFiles.length} files for challenge: ${challengeId}`
    );
    return c.json({
      success: true,
      challengeId,
      uploadedFiles,
      uploadErrors: uploadErrors.length > 0 ? uploadErrors : void 0,
      message: uploadErrors.length > 0 ? `Partially successful: ${uploadedFiles.length} uploaded, ${uploadErrors.length} failed` : `Successfully uploaded ${uploadedFiles.length} files`
    });
  } catch (error) {
    logger.error(
      `[API] Error uploading challenge files: ${error instanceof Error ? error.message : "Unknown error"}`
    );
    return c.json(
      {
        success: false,
        error: "Failed to upload files",
        details: error instanceof Error ? error.message : "Unknown error"
      },
      500
    );
  }
});
challengesRouter.post("/manage/:id/usage", async (c) => {
  try {
    const id = c.req.param("id");
    logger.info(`[API] Incrementing usage for challenge: ${id}`);
    await challengeService.incrementUsage(id);
    logger.info(`[API] Challenge usage incremented successfully: ${id}`);
    return c.json({
      success: true,
      message: "Challenge usage incremented"
    });
  } catch (error) {
    const paramId = c.req.param("id");
    logger.error(
      `[API] Error incrementing usage for challenge ${paramId}: ${error instanceof Error ? error.message : "Unknown error"}`
    );
    if (error instanceof Error && error.message.includes("ConditionalCheckFailedException")) {
      return c.json(
        {
          success: false,
          error: "Challenge not found or inactive"
        },
        404
      );
    }
    return c.json(
      {
        success: false,
        error: "Failed to increment challenge usage",
        details: error instanceof Error ? error.message : "Unknown error"
      },
      500
    );
  }
});
challengesRouter.get("/manage/:id/files/:path{.+}", async (c) => {
  try {
    const challengeId = c.req.param("id");
    const filePath = c.req.param("path");
    const isDownload = c.req.query("download") === "true";
    logger.info(
      `[API] Getting file content: ${challengeId}/${filePath}${isDownload ? " (download)" : " (preview)"}`
    );
    if (filePath.includes("..") || filePath.includes("//") || filePath.startsWith("/")) {
      return c.json(
        {
          success: false,
          error: "Invalid file path"
        },
        400
      );
    }
    const s3Key = `${challengeId}/${filePath}`;
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key
    });
    const response = await s3Client.send(command);
    if (!response.Body) {
      return c.json(
        {
          success: false,
          error: "File has no content"
        },
        404
      );
    }
    const chunks = [];
    const reader = response.Body.transformToWebStream().getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const buffer = Buffer.concat(chunks);
    if (isDownload) {
      const fileName = filePath.split("/").pop() || "file";
      const mimeType2 = getFileMimeType(filePath);
      logger.info(
        `[API] Downloading file: ${challengeId}/${filePath} (${buffer.length} bytes)`
      );
      return c.body(buffer, 200, {
        "Content-Type": mimeType2,
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": buffer.length.toString(),
        "Cache-Control": "private, max-age=3600"
      });
    }
    const maxTextSize = 1024 * 1024;
    if (buffer.length > maxTextSize) {
      return c.json(
        {
          success: false,
          error: "File too large to display",
          size: buffer.length,
          maxSize: maxTextSize
        },
        413
      );
    }
    const content = buffer.toString("utf-8");
    const mimeType = getFileMimeType(filePath);
    logger.info(
      `[API] Retrieved file content: ${challengeId}/${filePath} (${buffer.length} bytes)`
    );
    return c.json({
      success: true,
      challengeId,
      filePath,
      content,
      size: buffer.length,
      mimeType,
      lastModified: response.LastModified?.toISOString(),
      metadata: response.Metadata || {}
    });
  } catch (error) {
    const id = c.req.param("id");
    const paramPath = c.req.param("path");
    logger.error(
      `[API] Error getting file content ${id}/${paramPath}: ${error instanceof Error ? error.message : "Unknown error"}`
    );
    if (error instanceof Error) {
      if (error.name === "NoSuchKey") {
        return c.json(
          {
            success: false,
            error: "File not found"
          },
          404
        );
      }
      if (error.name === "AccessDenied") {
        return c.json(
          {
            success: false,
            error: "Access denied"
          },
          403
        );
      }
    }
    return c.json(
      {
        success: false,
        error: "Failed to get file content",
        details: error instanceof Error ? error.message : "Unknown error"
      },
      500
    );
  }
});
challengesRouter.get("/manage/:id/files", async (c) => {
  try {
    const challengeId = c.req.param("id");
    const path = c.req.query("path") || "";
    logger.info(
      `[API] Listing files for challenge: ${challengeId}, path: ${path}`
    );
    const cleanPath = path ? path.replace(/\/+$/, "") : "";
    const prefix = cleanPath ? `${challengeId}/${cleanPath}/` : `${challengeId}/`;
    logger.info(
      `[API] S3 ListObjects: bucket=${BUCKET_NAME}, prefix="${prefix}"`
    );
    const command = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: prefix,
      Delimiter: "/"
      // Get immediate children only
    });
    const response = await s3Client.send(command);
    const files = [];
    logger.info(
      `[API] S3 response for ${challengeId}: CommonPrefixes=${response.CommonPrefixes?.length || 0}, Contents=${response.Contents?.length || 0}, IsTruncated=${response.IsTruncated}`
    );
    if (response.Contents && response.Contents.length > 0) {
      logger.info(
        `[API] S3 keys found: ${response.Contents.map((obj) => obj.Key).join(", ")}`
      );
    }
    if (response.CommonPrefixes) {
      for (const commonPrefix of response.CommonPrefixes) {
        if (commonPrefix.Prefix) {
          const dirName = commonPrefix.Prefix.replace(prefix, "").replace(
            /\/$/,
            ""
          );
          if (dirName) {
            files.push({
              name: dirName,
              path: commonPrefix.Prefix.replace(`${challengeId}/`, "").replace(
                /\/+$/,
                ""
              ),
              // Remove trailing slash
              size: 0,
              lastModified: "",
              isDirectory: true
            });
          }
        }
      }
    }
    if (response.Contents) {
      for (const object of response.Contents) {
        if (object.Key && object.Key !== prefix) {
          const fileName = object.Key.replace(prefix, "");
          if (fileName && !fileName.includes("/")) {
            files.push({
              name: fileName,
              path: object.Key.replace(`${challengeId}/`, ""),
              size: object.Size || 0,
              lastModified: object.LastModified?.toISOString() || "",
              isDirectory: false,
              mimeType: getListMimeType(fileName)
            });
          }
        }
      }
    }
    files.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });
    logger.info(
      `[API] Found ${files.length} files/folders for challenge: ${challengeId}`
    );
    return c.json({
      success: true,
      challengeId,
      path,
      files,
      count: files.length
    });
  } catch (error) {
    const paramId = c.req.param("id");
    logger.error(
      `[API] Error listing files for challenge ${paramId}: ${error instanceof Error ? error.message : "Unknown error"}`
    );
    return c.json(
      {
        success: false,
        error: "Failed to list challenge files",
        details: error instanceof Error ? error.message : "Unknown error"
      },
      500
    );
  }
});
challengesRouter.get("/manage/:id/download", async (c) => {
  try {
    const challengeId = c.req.param("id");
    logger.info(`[API] Downloading challenge: ${challengeId}`);
    let challengeName = "Challenge";
    try {
      const challenge = await challengeService.getChallenge(challengeId);
      if (challenge) {
        challengeName = challenge.name;
      }
    } catch (error) {
      logger.warn(
        `Failed to get challenge name for ${challengeId}: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
    const listCommand = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: `${challengeId}/`
    });
    const listResponse = await s3Client.send(listCommand);
    if (!listResponse.Contents || listResponse.Contents.length === 0) {
      return c.json(
        {
          success: false,
          error: "No files found in challenge"
        },
        404
      );
    }
    const zip = new JSZip();
    for (const object of listResponse.Contents) {
      if (!object.Key || object.Key === `${challengeId}/`) {
        continue;
      }
      try {
        const getCommand = new GetObjectCommand({
          Bucket: BUCKET_NAME,
          Key: object.Key
        });
        const getResponse = await s3Client.send(getCommand);
        if (getResponse.Body) {
          const chunks = [];
          const reader = getResponse.Body.transformToWebStream().getReader();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              chunks.push(value);
            }
          } finally {
            reader.releaseLock();
          }
          const buffer = Buffer.concat(chunks);
          const relativePath = object.Key.replace(`${challengeId}/`, "");
          zip.file(relativePath, buffer);
        }
      } catch (error) {
        logger.error(
          `Failed to download file ${object.Key}: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
    }
    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
    const sanitizedName = challengeName.replace(/[^a-zA-Z0-9\s-]/g, "").replace(/\s+/g, "_").substring(0, 50);
    logger.info(
      `[API] Generated ZIP for challenge: ${challengeId} (${zipBuffer.length} bytes)`
    );
    return c.body(new Uint8Array(zipBuffer), 200, {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${sanitizedName}.zip"`,
      "Content-Length": zipBuffer.length.toString(),
      "Cache-Control": "private, max-age=3600"
    });
  } catch (error) {
    const paramId = c.req.param("id");
    logger.error(
      `[API] Error downloading challenge ${paramId}: ${error instanceof Error ? error.message : "Unknown error"}`
    );
    return c.json(
      {
        success: false,
        error: "Failed to download challenge",
        details: error instanceof Error ? error.message : "Unknown error"
      },
      500
    );
  }
});
challengesRouter.get("/manage/:id", async (c) => {
  try {
    const id = c.req.param("id");
    logger.info(`[API] Getting challenge: ${id}`);
    const challenge = await challengeService.getChallenge(id);
    if (!challenge) {
      return c.json(
        {
          success: false,
          error: "Challenge not found"
        },
        404
      );
    }
    return c.json({
      success: true,
      challenge
    });
  } catch (error) {
    const paramId = c.req.param("id");
    logger.error(
      `[API] Error getting challenge ${paramId}: ${error instanceof Error ? error.message : "Unknown error"}`
    );
    return c.json(
      {
        success: false,
        error: "Failed to get challenge",
        details: error instanceof Error ? error.message : "Unknown error"
      },
      500
    );
  }
});
challengesRouter.put("/manage/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json();
    logger.info(`[API] Updating challenge: ${id}`);
    if (body.ecsConfig) {
      const configErrors = ChallengeValidator.validateECSConfig(body.ecsConfig);
      if (configErrors.length > 0) {
        return c.json(
          {
            success: false,
            error: "ECS configuration validation failed",
            validationErrors: configErrors
          },
          400
        );
      }
    }
    const errors = [];
    if (body.name !== void 0 && (!body.name || body.name.trim().length === 0)) {
      errors.push("Challenge name cannot be empty");
    }
    if (body.description !== void 0 && (!body.description || body.description.trim().length === 0)) {
      errors.push("Challenge description cannot be empty");
    }
    if (errors.length > 0) {
      return c.json(
        {
          success: false,
          error: "Validation failed",
          validationErrors: errors
        },
        400
      );
    }
    const updatedChallenge = await challengeService.updateChallenge(
      id,
      body
    );
    logger.info(`[API] Challenge updated successfully: ${id}`);
    return c.json({
      success: true,
      challenge: updatedChallenge
    });
  } catch (error) {
    const paramId = c.req.param("id");
    logger.error(
      `[API] Error updating challenge ${paramId}: ${error instanceof Error ? error.message : "Unknown error"}`
    );
    if (error instanceof Error && error.message.includes("ConditionalCheckFailedException")) {
      return c.json(
        {
          success: false,
          error: "Challenge not found or already deleted"
        },
        404
      );
    }
    return c.json(
      {
        success: false,
        error: "Failed to update challenge",
        details: error instanceof Error ? error.message : "Unknown error"
      },
      500
    );
  }
});
challengesRouter.delete("/manage/:id", async (c) => {
  try {
    const id = c.req.param("id");
    logger.info(`[API] Deleting challenge: ${id}`);
    await challengeService.deleteChallenge(id);
    logger.info(`[API] Challenge deleted successfully: ${id}`);
    return c.json({
      success: true,
      message: "Challenge deleted successfully"
    });
  } catch (error) {
    const paramId = c.req.param("id");
    logger.error(
      `[API] Error deleting challenge ${paramId}: ${error instanceof Error ? error.message : "Unknown error"}`
    );
    if (error instanceof Error && error.message.includes("ConditionalCheckFailedException")) {
      return c.json(
        {
          success: false,
          error: "Challenge not found or already deleted"
        },
        404
      );
    }
    return c.json(
      {
        success: false,
        error: "Failed to delete challenge",
        details: error instanceof Error ? error.message : "Unknown error"
      },
      500
    );
  }
});
function getListMimeType(fileName) {
  const extension = fileName.toLowerCase().split(".").pop();
  const mimeTypes = {
    // Text files
    txt: "text/plain",
    md: "text/markdown",
    json: "application/json",
    xml: "application/xml",
    yml: "application/x-yaml",
    yaml: "application/x-yaml",
    // Programming languages
    js: "text/javascript",
    ts: "text/typescript",
    jsx: "text/javascript",
    tsx: "text/typescript",
    py: "text/x-python",
    java: "text/x-java-source",
    cpp: "text/x-c++src",
    c: "text/x-csrc",
    h: "text/x-chdr",
    hpp: "text/x-c++hdr",
    php: "text/x-php",
    rb: "text/x-ruby",
    go: "text/x-go",
    rs: "text/x-rustsrc",
    swift: "text/x-swift",
    kt: "text/x-kotlin",
    dart: "text/x-dart",
    // Web files
    html: "text/html",
    css: "text/css",
    sql: "text/x-sql",
    // Shell scripts
    sh: "text/x-shellscript",
    bat: "text/x-msdos-batch",
    // Config files
    dockerfile: "text/x-dockerfile",
    gitignore: "text/plain",
    env: "text/plain",
    example: "text/plain",
    config: "text/plain"
  };
  return mimeTypes[extension || ""] || "application/octet-stream";
}
function getFileMimeType(filePath) {
  const extension = filePath.toLowerCase().split(".").pop();
  const mimeTypes = {
    txt: "text/plain",
    md: "text/markdown",
    json: "application/json",
    xml: "application/xml",
    yml: "application/x-yaml",
    yaml: "application/x-yaml",
    js: "text/javascript",
    ts: "text/typescript",
    jsx: "text/javascript",
    tsx: "text/typescript",
    py: "text/x-python",
    java: "text/x-java-source",
    cpp: "text/x-c++src",
    c: "text/x-csrc",
    h: "text/x-chdr",
    hpp: "text/x-c++hdr",
    php: "text/x-php",
    rb: "text/x-ruby",
    go: "text/x-go",
    rs: "text/x-rustsrc",
    swift: "text/x-swift",
    kt: "text/x-kotlin",
    dart: "text/x-dart",
    html: "text/html",
    css: "text/css",
    sql: "text/x-sql",
    sh: "text/x-shellscript",
    bat: "text/x-msdos-batch",
    dockerfile: "text/x-dockerfile"
  };
  return mimeTypes[extension || ""] || "text/plain";
}

// src/routes/health.ts
import { Hono as Hono6 } from "hono";
var healthRouter = new Hono6();
healthRouter.get("/", (c) => c.json({ status: "ok" }));

// src/routes/interviews.ts
import { Hono as Hono7 } from "hono";
import { streamSSE } from "hono/streaming";
var interviewsRouter = new Hono7();
interviewsRouter.get("/", async (c) => {
  try {
    const activeInterviews = await interviewManager.getActiveInterviews();
    const operations = await operationManager.getActiveOperations();
    const dynamoInterviews = activeInterviews.map((interview) => ({
      id: interview.id,
      candidateName: interview.candidateName,
      challenge: interview.challenge,
      status: interview.status,
      accessUrl: interview.accessUrl,
      password: interview.password,
      createdAt: interview.createdAt.toISOString(),
      scheduledAt: interview.scheduledAt?.toISOString(),
      autoDestroyAt: interview.autoDestroyAt?.toISOString()
    }));
    const operationInterviews = getOperationInterviews(operations);
    const allInterviews = [...dynamoInterviews, ...operationInterviews];
    const mergedInterviews = mergeAndDeduplicateInterviews(
      allInterviews,
      operations
    );
    console.log(
      `[DEBUG] Retrieved ${activeInterviews.length} interviews from DynamoDB, ${operationInterviews.length} from operations`
    );
    return c.json({ interviews: mergedInterviews });
  } catch (error) {
    console.error("Error listing interviews:", error);
    return c.json({ interviews: [] });
  }
});
interviewsRouter.post("/create", async (c) => {
  try {
    const body = await c.req.json();
    const {
      candidateName,
      challenge,
      scheduledAt,
      autoDestroyMinutes,
      saveFiles = true
    } = body;
    if (!candidateName || !challenge) {
      return c.json(
        { error: "candidateName and challenge are required" },
        400
      );
    }
    let scheduledDate;
    if (scheduledAt) {
      scheduledDate = new Date(scheduledAt);
      if (isNaN(scheduledDate.getTime())) {
        return c.json({ error: "Invalid scheduledAt date format" }, 400);
      }
      const now = /* @__PURE__ */ new Date();
      if (scheduledDate <= now) {
        return c.json(
          {
            error: "scheduledAt must be in the future",
            details: `Scheduled: ${scheduledDate.toISOString()}, Now: ${now.toISOString()}`
          },
          400
        );
      }
    }
    if (!autoDestroyMinutes || typeof autoDestroyMinutes !== "number" || autoDestroyMinutes <= 0) {
      return c.json(
        {
          error: "autoDestroyMinutes is required and must be a positive number"
        },
        400
      );
    }
    const baseTime = scheduledDate || /* @__PURE__ */ new Date();
    const autoDestroyDate = new Date(
      baseTime.getTime() + autoDestroyMinutes * 60 * 1e3
    );
    const interviewId = generateId();
    const password = generateSecureString();
    const operationId = await operationManager.createOperation(
      "create",
      interviewId,
      candidateName,
      challenge,
      scheduledDate,
      autoDestroyDate,
      saveFiles
    );
    try {
      const challenges = await challengeService.listChallenges("newest");
      const challengeRecord = challenges.find((ch) => ch.id === challenge);
      if (challengeRecord) {
        await challengeService.incrementUsage(challengeRecord.id);
        await operationManager.addOperationLog(
          operationId,
          `\u{1F4CA} Challenge usage tracked: ${challengeRecord.name}`
        );
      } else {
        await operationManager.addOperationLog(
          operationId,
          `\u26A0\uFE0F Challenge not found in registry: ${challenge}`
        );
      }
    } catch (error) {
      console.warn("Failed to track challenge usage:", error);
      await operationManager.addOperationLog(
        operationId,
        `\u26A0\uFE0F Could not track challenge usage: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
    if (scheduledDate) {
      await operationManager.addOperationLog(
        operationId,
        `Interview scheduled for ${scheduledDate.toLocaleString()}`
      );
      if (autoDestroyDate) {
        await operationManager.addOperationLog(
          operationId,
          `Auto-destroy scheduled for ${autoDestroyDate.toLocaleString()}`
        );
      }
      const domainName = config.project.domainName;
      const accessUrl = domainName ? `https://${interviewId}.${domainName}/` : `http://localhost:8443/`;
      await operationManager.updateScheduledInterviewCredentials(
        operationId,
        accessUrl,
        password
      );
      return c.json({
        operationId,
        interviewId,
        candidateName,
        challenge,
        password,
        accessUrl,
        scheduledAt: scheduledDate.toISOString(),
        autoDestroyAt: autoDestroyDate.toISOString(),
        message: `Interview scheduled for ${scheduledDate.toLocaleString()}`
      });
    }
    setImmediate(async () => {
      try {
        await operationManager.updateOperationStatus(operationId, "running");
        await operationManager.addOperationLog(
          operationId,
          `Starting interview creation for ${candidateName}`
        );
        await operationManager.addOperationLog(
          operationId,
          `Interview ID: ${interviewId}`
        );
        await operationManager.addOperationLog(
          operationId,
          `Challenge: ${challenge}`
        );
        let serviceAccountId;
        let openaiApiKey;
        if (config.services.openaiProjectId && config.services.openaiAdminKey) {
          await operationManager.addOperationLog(
            operationId,
            "\u{1F916} Creating OpenAI service account..."
          );
          const serviceAccountResult = await openaiService.createServiceAccount(
            config.services.openaiProjectId,
            `interview-${config.project.environment}-interview-${interviewId}-${candidateName}`
          );
          if (serviceAccountResult.success) {
            serviceAccountId = serviceAccountResult.serviceAccountId;
            openaiApiKey = serviceAccountResult.apiKey;
            await operationManager.addOperationLog(
              operationId,
              `\u2705 OpenAI service account created: ${serviceAccountId}`
            );
          } else {
            await operationManager.addOperationLog(
              operationId,
              `\u274C OpenAI service account creation failed: ${serviceAccountResult.error}`
            );
            await operationManager.setOperationResult(operationId, {
              success: false,
              error: `Failed to create OpenAI service account: ${serviceAccountResult.error}`
            });
            return;
          }
        }
        const instance = {
          id: interviewId,
          candidateName,
          challenge,
          password,
          openaiApiKey
        };
        const result = await interviewManager.createInterviewWithInfrastructure(
          instance,
          (data) => {
            const lines = data.split("\n").filter((line) => line.trim());
            lines.forEach((line) => {
              operationManager.addOperationLog(operationId, line).catch(console.error);
            });
          },
          (accessUrl) => {
            operationManager.updateOperationInfrastructureReady(
              operationId,
              accessUrl,
              password
            ).catch(console.error);
            operationManager.addOperationLog(
              operationId,
              "\u{1F527} Infrastructure ready, ECS service starting up..."
            ).catch(console.error);
          },
          scheduledDate,
          autoDestroyDate,
          saveFiles,
          serviceAccountId
        );
        if (result.success) {
          await operationManager.addOperationLog(
            operationId,
            "\u2705 Interview created successfully!"
          );
          await operationManager.addOperationLog(
            operationId,
            `Access URL: ${result.accessUrl}`
          );
          await operationManager.setOperationResult(operationId, {
            success: true,
            accessUrl: result.accessUrl,
            password,
            fullOutput: result.fullOutput,
            healthCheckPassed: result.healthCheckPassed,
            infrastructureReady: result.infrastructureReady
          });
        } else {
          await operationManager.addOperationLog(
            operationId,
            "\u274C Interview creation failed"
          );
          await operationManager.addOperationLog(
            operationId,
            `Error: ${result.error}`
          );
          await operationManager.setOperationResult(operationId, {
            success: false,
            error: result.error,
            fullOutput: result.fullOutput
          });
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        await operationManager.addOperationLog(
          operationId,
          `\u274C Error: ${errorMsg}`
        );
        await operationManager.setOperationResult(operationId, {
          success: false,
          error: errorMsg
        });
      }
    });
    return c.json({
      operationId,
      interviewId,
      candidateName,
      challenge,
      password,
      autoDestroyAt: autoDestroyDate?.toISOString(),
      message: "Interview creation started in background"
    });
  } catch (error) {
    console.error("Error starting interview creation:", error);
    if (error instanceof Error) {
      console.error("Error details:", {
        message: error.message,
        name: error.name,
        stack: error.stack
      });
    }
    return c.json(
      {
        error: "Failed to start interview creation",
        details: error instanceof Error ? error.message : "Unknown error"
      },
      500
    );
  }
});
interviewsRouter.get("/history", async (c) => {
  try {
    const limitParam = c.req.query("limit");
    const candidateParam = c.req.query("candidate");
    let limit = 50;
    if (limitParam) {
      const parsedLimit = parseInt(limitParam, 10);
      if (!isNaN(parsedLimit) && parsedLimit > 0 && parsedLimit <= 100) {
        limit = parsedLimit;
      }
    }
    let historicalInterviews;
    if (candidateParam) {
      historicalInterviews = await interviewManager.searchByCandidate(
        candidateParam,
        limit
      );
      historicalInterviews = historicalInterviews.filter(
        (interview) => interview.status === "destroyed" || interview.status === "error"
      );
    } else {
      historicalInterviews = await interviewManager.getHistoricalInterviews(limit);
    }
    const formattedInterviews = historicalInterviews.map((interview) => ({
      id: interview.id,
      candidateName: interview.candidateName,
      challenge: interview.challenge,
      status: interview.status,
      accessUrl: interview.accessUrl,
      password: interview.password,
      createdAt: interview.createdAt.toISOString(),
      scheduledAt: interview.scheduledAt?.toISOString(),
      autoDestroyAt: interview.autoDestroyAt?.toISOString(),
      completedAt: interview.completedAt?.toISOString(),
      destroyedAt: interview.destroyedAt?.toISOString(),
      historyS3Key: interview.historyS3Key,
      saveFiles: interview.saveFiles
    }));
    console.log(
      `[DEBUG] Retrieved ${historicalInterviews.length} historical interviews from DynamoDB` + (candidateParam ? ` for candidate: ${candidateParam}` : "")
    );
    return c.json({
      interviews: formattedInterviews,
      total: formattedInterviews.length,
      limit,
      hasMore: formattedInterviews.length === limit
      // Indicates if there might be more results
    });
  } catch (error) {
    console.error("Error listing historical interviews:", error);
    return c.json(
      {
        error: "Failed to retrieve historical interviews",
        details: error instanceof Error ? error.message : "Unknown error"
      },
      500
    );
  }
});
interviewsRouter.get("/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const status = await terraformManager.getInterviewStatus(id);
    if (!status.success) {
      return c.json(
        {
          error: "Interview not found or failed to get status",
          details: status.error
        },
        404
      );
    }
    const outputs = status.outputs;
    const interview = {
      id,
      candidateName: outputs?.candidate_name?.value || "Unknown",
      challenge: outputs?.challenge?.value || "unknown",
      status: "active",
      accessUrl: outputs?.access_url?.value,
      password: outputs?.password?.value,
      createdAt: outputs?.created_at?.value || (/* @__PURE__ */ new Date()).toISOString()
    };
    return c.json({ interview });
  } catch (error) {
    return c.json(
      {
        error: "Failed to get interview status",
        details: error instanceof Error ? error.message : "Unknown error"
      },
      500
    );
  }
});
interviewsRouter.delete("/:id", async (c) => {
  try {
    const id = c.req.param("id");
    let candidateName;
    let challenge;
    let saveFiles;
    try {
      const operations = await operationManager.getOperationsByInterview(id);
      const createOperation = operations.find(
        (op) => op.type === "create" && op.status === "completed"
      );
      if (createOperation) {
        candidateName = createOperation.candidateName;
        challenge = createOperation.challenge;
        saveFiles = createOperation.saveFiles;
      }
    } catch (error) {
      console.log(
        "Could not retrieve create operation details for direct destroy:",
        error
      );
    }
    const result = await terraformManager.destroyInterviewStreaming(
      id,
      void 0,
      // No streaming callback for direct destroy
      candidateName,
      challenge,
      saveFiles
    );
    if (!result.success) {
      return c.json(
        {
          error: "Failed to destroy interview infrastructure",
          details: result.error,
          terraformOutput: result.output
        },
        500
      );
    }
    return c.json({
      message: "Interview infrastructure destroyed successfully",
      terraformOutput: result.output
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to destroy interview",
        details: error instanceof Error ? error.message : "Unknown error"
      },
      500
    );
  }
});
interviewsRouter.on(["DELETE", "POST"], "/:id/destroy", async (c) => {
  if (c.req.method === "DELETE") {
    const interviewId = c.req.param("id");
    if (!interviewId) {
      return c.body("Interview ID is required", 400);
    }
    return streamSSE(c, async (stream) => {
      let candidateName;
      let challenge;
      let saveFiles;
      try {
        const operations = await operationManager.getOperationsByInterview(interviewId);
        const createOperation = operations.find(
          (op) => op.type === "create" && op.status === "completed"
        );
        if (createOperation) {
          candidateName = createOperation.candidateName;
          challenge = createOperation.challenge;
          saveFiles = createOperation.saveFiles;
        }
      } catch (error) {
        console.log(
          "Could not retrieve create operation details for streaming destroy:",
          error
        );
      }
      const initialData = {
        type: "metadata",
        interviewId,
        action: "destroy"
      };
      await stream.writeSSE({ data: JSON.stringify(initialData) });
      await interviewManager.destroyInterviewWithInfrastructure(
        interviewId,
        (data) => {
          const streamData = {
            type: "output",
            data
          };
          stream.writeSSE({ data: JSON.stringify(streamData) }).catch(console.error);
        },
        candidateName,
        challenge,
        saveFiles
      ).then(async (result) => {
        const finalData = {
          type: "complete",
          success: result.success,
          error: result.error,
          historyS3Key: result.historyS3Key
        };
        await stream.writeSSE({ data: JSON.stringify(finalData) });
      }).catch(async (error) => {
        const errorData = {
          type: "error",
          error: error instanceof Error ? error.message : "Unknown error"
        };
        await stream.writeSSE({ data: JSON.stringify(errorData) });
      });
    });
  }
  try {
    const interviewId = c.req.param("id");
    let candidateName;
    let challenge;
    let saveFiles;
    try {
      const body = await c.req.json();
      candidateName = body.candidateName;
      challenge = body.challenge;
    } catch {
      console.log("No interview metadata provided in destroy request");
    }
    try {
      const operations = await operationManager.getOperationsByInterview(interviewId);
      const createOperation = operations.find(
        (op) => op.type === "create" && op.status === "completed"
      );
      if (createOperation) {
        candidateName = candidateName || createOperation.candidateName;
        challenge = challenge || createOperation.challenge;
        saveFiles = createOperation.saveFiles;
      }
    } catch (error) {
      console.log("Could not retrieve create operation details:", error);
    }
    const cancelledCount = await operationManager.cancelScheduledOperationsForInterview(interviewId);
    if (cancelledCount > 0) {
      console.log(
        `Cancelled ${cancelledCount} scheduled operations for interview ${interviewId}`
      );
    }
    const operationId = await operationManager.createOperation(
      "destroy",
      interviewId,
      candidateName,
      challenge
    );
    setImmediate(async () => {
      try {
        await operationManager.updateOperationStatus(operationId, "running");
        await operationManager.addOperationLog(
          operationId,
          `Starting interview destruction for ${interviewId}`
        );
        if (cancelledCount > 0) {
          await operationManager.addOperationLog(
            operationId,
            `Cancelled ${cancelledCount} scheduled operation(s) for this interview`
          );
        }
        let interview = null;
        try {
          interview = await interviewManager.getInterview(interviewId);
        } catch (error) {
          console.log(
            "Could not fetch interview record for OpenAI cleanup:",
            error
          );
        }
        if (interview?.openaiServiceAccountId) {
          await operationManager.addOperationLog(
            operationId,
            "\u{1F916} Deleting OpenAI service account..."
          );
          const deleteResult = await openaiService.deleteServiceAccount(
            config.services.openaiProjectId,
            interview?.openaiServiceAccountId
          );
          if (deleteResult.success) {
            await operationManager.addOperationLog(
              operationId,
              `\u2705 OpenAI service account deleted: ${interview?.openaiServiceAccountId}`
            );
          } else {
            await operationManager.addOperationLog(
              operationId,
              `\u26A0\uFE0F OpenAI service account deletion failed: ${deleteResult.error}`
            );
          }
        }
        const result = await interviewManager.destroyInterviewWithInfrastructure(
          interviewId,
          (data) => {
            const lines = data.split("\n").filter((line) => line.trim());
            lines.forEach((line) => {
              operationManager.addOperationLog(operationId, line).catch(console.error);
            });
          },
          candidateName,
          challenge,
          saveFiles
        );
        if (result.success) {
          await operationManager.addOperationLog(
            operationId,
            "\u2705 Infrastructure destroyed successfully"
          );
          await operationManager.addOperationLog(
            operationId,
            "\u2705 Interview destroyed successfully!"
          );
          await operationManager.setOperationResult(operationId, {
            success: true,
            fullOutput: result.fullOutput,
            historyS3Key: result.historyS3Key
          });
        } else {
          await operationManager.addOperationLog(
            operationId,
            "\u274C Interview destruction failed"
          );
          await operationManager.addOperationLog(
            operationId,
            `Error: ${result.error}`
          );
          await operationManager.setOperationResult(operationId, {
            success: false,
            error: result.error,
            fullOutput: result.fullOutput
          });
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        await operationManager.addOperationLog(
          operationId,
          `\u274C Error: ${errorMsg}`
        );
        await operationManager.setOperationResult(operationId, {
          success: false,
          error: errorMsg
        });
      }
    });
    return c.json({
      operationId,
      interviewId,
      message: "Interview destruction started in background"
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to start interview destruction",
        details: error instanceof Error ? error.message : "Unknown error"
      },
      500
    );
  }
});
interviewsRouter.delete("/:id/delete", async (c) => {
  try {
    const interviewId = c.req.param("id");
    if (!interviewId) {
      return c.json({ error: "Interview ID is required" }, 400);
    }
    logger.info(`[API] Deleting interview record: ${interviewId}`);
    const interview = await interviewManager.getInterview(interviewId);
    if (!interview) {
      return c.json({ error: "Interview not found" }, 404);
    }
    if (interview.status !== "destroyed" && interview.status !== "error") {
      return c.json(
        {
          error: "Cannot delete active interview",
          details: "Only completed interviews (destroyed or error) can be deleted"
        },
        400
      );
    }
    if (interview.historyS3Key) {
      logger.info(`[API] Deleting history files: ${interview.historyS3Key}`);
      try {
        const { exec: exec2 } = await import("child_process");
        const { promisify: promisify2 } = await import("util");
        const execAsync2 = promisify2(exec2);
        const { config: config2 } = await import("./config-N25OLGGC.js");
        await execAsync2(
          `aws s3 rm "s3://${config2.storage.historyBucket}/${interview.historyS3Key}" --recursive`,
          {
            env: process.env,
            timeout: 3e4
          }
        );
        logger.info(
          `[API] Successfully deleted history files: ${interview.historyS3Key}`
        );
      } catch (s3Error) {
        logger.warn(`[API] Failed to delete history files: ${s3Error}`);
      }
    }
    await interviewManager.deleteInterview(interviewId);
    logger.info(`[API] Successfully deleted interview: ${interviewId}`);
    return c.json({
      success: true,
      message: "Interview deleted successfully",
      deletedHistoryFiles: !!interview.historyS3Key
    });
  } catch (error) {
    logger.error(
      `[API] Error deleting interview: ${error instanceof Error ? error.message : "Unknown error"}`
    );
    return c.json(
      {
        error: "Failed to delete interview",
        details: error instanceof Error ? error.message : "Unknown error"
      },
      500
    );
  }
});
interviewsRouter.get("/:id/files", async (c) => {
  try {
    const interviewId = c.req.param("id");
    if (!interviewId) {
      return c.json({ error: "Interview ID is required" }, 400);
    }
    const interview = await interviewManager.getInterview(interviewId);
    if (!interview) {
      return c.json({ error: "Interview not found" }, 404);
    }
    if (!interview.saveFiles) {
      return c.json(
        {
          error: "Files were not saved for this interview",
          details: "File saving was disabled when the interview was created"
        },
        400
      );
    }
    if (!interview.historyS3Key) {
      return c.json(
        {
          error: "Saved files are not yet available",
          details: "Files may still be processing or the extraction failed during interview destruction"
        },
        404
      );
    }
    const { S3Client: S3Client2, GetObjectCommand: GetObjectCommand2 } = await import("@aws-sdk/client-s3");
    const { config: config2 } = await import("./config-N25OLGGC.js");
    const s3Client2 = new S3Client2(config2.aws.getCredentials());
    const bucketName = config2.storage.historyBucket;
    try {
      const command = new GetObjectCommand2({
        Bucket: bucketName,
        Key: interview.historyS3Key
      });
      const response = await s3Client2.send(command);
      if (!response.Body) {
        return c.json({ error: "File not found in S3" }, 404);
      }
      const chunks = [];
      const reader = response.Body.transformToWebStream().getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const buffer = Buffer.concat(chunks);
      let challengeName = "Unknown_Challenge";
      try {
        const challenge = await challengeService.getChallenge(
          interview.challenge
        );
        if (challenge) {
          challengeName = challenge.name;
        }
      } catch (error) {
        console.warn(
          `Failed to get challenge name for ${interview.challenge}:`,
          error
        );
      }
      const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10).replace(/-/g, "");
      const sanitizedCandidateName = interview.candidateName.replace(/[^a-zA-Z0-9\s]/g, "").replace(/\s+/g, " ").trim().replace(/\s/g, "_").substring(0, 50);
      const sanitizedChallengeName = challengeName.replace(/[^a-zA-Z0-9\s]/g, "").replace(/\s+/g, " ").trim().replace(/\s/g, "_").substring(0, 50);
      const filename = `${today}-${sanitizedCandidateName}-${sanitizedChallengeName}.tar.gz`;
      return c.body(buffer, 200, {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": buffer.length.toString(),
        "Cache-Control": "private, max-age=3600"
        // Cache for 1 hour
      });
    } catch (s3Error) {
      console.error("Failed to download file from S3:", s3Error);
      if (s3Error instanceof Error && s3Error.name === "NoSuchKey") {
        return c.json(
          {
            error: "Saved files not found",
            details: "The saved files may have been automatically cleaned up or corrupted"
          },
          404
        );
      }
      return c.json(
        {
          error: "Failed to download saved files",
          details: "An error occurred while retrieving files from storage"
        },
        500
      );
    }
  } catch (error) {
    console.error("Error downloading interview files:", error);
    return c.json(
      {
        error: "Failed to process file download request",
        details: error instanceof Error ? error.message : "Unknown error"
      },
      500
    );
  }
});
interviewsRouter.post("/:id/health-check", async (c) => {
  try {
    const interviewId = c.req.param("id");
    if (!interviewId) {
      return c.json({ error: "Interview ID is required" }, 400);
    }
    const operations = await operationManager.getOperationsByInterview(interviewId);
    const createOperation = operations.find((op) => op.type === "create");
    if (!createOperation) {
      return c.json(
        { error: "No create operation found for this interview" },
        404
      );
    }
    if (createOperation.status !== "completed" || !createOperation.result?.success) {
      return c.json(
        { error: "Interview creation is not completed successfully" },
        400
      );
    }
    const operationId = await operationManager.createOperation(
      "create",
      interviewId,
      createOperation.candidateName,
      createOperation.challenge
    );
    setImmediate(async () => {
      try {
        await operationManager.updateOperationStatus(operationId, "running");
        await operationManager.addOperationLog(
          operationId,
          `Retrying health check for interview ${interviewId}`
        );
        const result = await terraformManager.retryHealthCheck(
          interviewId,
          (data) => {
            const lines = data.split("\n").filter((line) => line.trim());
            lines.forEach((line) => {
              operationManager.addOperationLog(operationId, line).catch(console.error);
            });
          }
        );
        if (result.success) {
          await operationManager.addOperationLog(
            operationId,
            "\u2705 Health check retry successful!"
          );
          const originalResult = createOperation.result;
          if (originalResult) {
            originalResult.healthCheckPassed = true;
            await operationManager.setOperationResult(
              createOperation.id,
              originalResult
            );
          }
          await operationManager.setOperationResult(operationId, {
            success: true,
            accessUrl: result.accessUrl,
            password: createOperation.result?.password,
            healthCheckPassed: true
          });
        } else {
          await operationManager.addOperationLog(
            operationId,
            "\u274C Health check retry failed"
          );
          await operationManager.addOperationLog(
            operationId,
            `Error: ${result.error}`
          );
          await operationManager.setOperationResult(operationId, {
            success: false,
            error: result.error,
            healthCheckPassed: false
          });
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        await operationManager.addOperationLog(
          operationId,
          `\u274C Error: ${errorMsg}`
        );
        await operationManager.setOperationResult(operationId, {
          success: false,
          error: errorMsg,
          healthCheckPassed: false
        });
      }
    });
    return c.json({
      operationId,
      interviewId,
      message: "Health check retry started in background"
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to start health check retry",
        details: error instanceof Error ? error.message : "Unknown error"
      },
      500
    );
  }
});
function getOperationInterviews(operations) {
  return operations.filter((op) => op.type === "create").map((op) => ({
    id: op.interviewId,
    candidateName: op.candidateName || "Unknown",
    challenge: op.challenge || "unknown",
    status: op.status === "scheduled" ? "scheduled" : op.status === "pending" ? "initializing" : op.status === "running" ? op.result?.infrastructureReady ? "configuring" : "initializing" : op.status === "completed" ? op.result?.success ? op.result?.healthCheckPassed ? "active" : "configuring" : "error" : "error",
    accessUrl: op.result?.accessUrl,
    password: op.result?.password || "",
    createdAt: op.createdAt.toISOString(),
    scheduledAt: op.scheduledAt?.toISOString(),
    autoDestroyAt: op.autoDestroyAt?.toISOString(),
    operationId: op.id
  }));
}
function mergeAndDeduplicateInterviews(allInterviews, operations) {
  const destroyOperationUpdates = /* @__PURE__ */ new Map();
  operations.filter((op) => op.type === "destroy").forEach((op) => {
    const existing = destroyOperationUpdates.get(op.interviewId);
    if (!existing || op.createdAt.getTime() > existing.createdAt.getTime()) {
      destroyOperationUpdates.set(op.interviewId, op);
    }
  });
  const interviewMap = /* @__PURE__ */ new Map();
  allInterviews.forEach((interview) => {
    const existing = interviewMap.get(interview.id);
    if (existing && existing.accessUrl && !interview.accessUrl) {
      return;
    }
    if (existing && existing.status === "active" && interview.status !== "active") {
      return;
    }
    interviewMap.set(interview.id, interview);
  });
  destroyOperationUpdates.forEach((destroyOp, interviewId) => {
    const existing = interviewMap.get(interviewId);
    if (existing) {
      const updatedInterview = {
        ...existing,
        status: destroyOp.status === "running" ? "destroying" : destroyOp.status === "failed" ? "error" : destroyOp.status === "completed" ? destroyOp.result?.success ? "destroyed" : "error" : existing.status
      };
      interviewMap.set(interviewId, updatedInterview);
    }
  });
  return Array.from(interviewMap.values()).filter((interview) => interview.status !== "destroyed").sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

// src/routes/operations.ts
import { Hono as Hono8 } from "hono";
var operationsRouter = new Hono8();
operationsRouter.get("/", async (c) => {
  try {
    const interviewId = c.req.query("interviewId");
    const activeOnly = c.req.query("activeOnly") === "true";
    if (interviewId) {
      const operations = await operationManager.getOperationsByInterview(interviewId);
      return c.json({ operations });
    } else if (activeOnly) {
      const operations = await operationManager.getActiveOperations();
      return c.json({ operations });
    } else {
      console.warn(
        "[PERFORMANCE] Using full table scan for getAllOperations() - consider using activeOnly=true for better performance"
      );
      const operations = await operationManager.getAllOperations();
      return c.json({ operations });
    }
  } catch (error) {
    console.error("Error getting operations:", error);
    return c.json({ operations: [] });
  }
});
operationsRouter.post("/:id/cancel", async (c) => {
  try {
    const id = c.req.param("id");
    const operationId = id;
    if (!operationId) {
      return c.json(
        { success: false, error: "Operation ID is required" },
        400
      );
    }
    const operation = await operationManager.getOperation(operationId);
    if (!operation) {
      return c.json(
        { success: false, error: "Operation not found" },
        404
      );
    }
    if (operation.status !== "pending" && operation.status !== "running" && operation.status !== "scheduled") {
      return c.json(
        {
          success: false,
          error: `Cannot cancel operation with status: ${operation.status}`
        },
        400
      );
    }
    const cancelled = await operationManager.cancelOperation(operationId);
    if (cancelled) {
      return c.json({
        success: true,
        message: "Operation cancelled successfully",
        operation: await operationManager.getOperation(operationId)
      });
    } else {
      return c.json(
        { success: false, error: "Failed to cancel operation" },
        500
      );
    }
  } catch (error) {
    console.error("Error cancelling operation:", error);
    return c.json(
      { success: false, error: "Internal server error" },
      500
    );
  }
});
operationsRouter.get("/:id/logs", async (c) => {
  try {
    const id = c.req.param("id");
    const operationId = id;
    const operation = await operationManager.getOperation(operationId);
    if (!operation) {
      return c.json({ error: "Operation not found" }, 404);
    }
    const fromIndex = parseInt(c.req.query("from") || "0");
    const logs = operation.logs.slice(fromIndex);
    return c.json({
      logs,
      totalLogs: operation.logs.length,
      operation: {
        id: operation.id,
        status: operation.status,
        type: operation.type,
        interviewId: operation.interviewId,
        createdAt: operation.createdAt,
        executionStartedAt: operation.executionStartedAt,
        completedAt: operation.completedAt,
        result: operation.result
      }
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to get operation logs",
        details: error instanceof Error ? error.message : "Unknown error"
      },
      500
    );
  }
});
operationsRouter.get("/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const operationId = id;
    const operation = await operationManager.getOperation(operationId);
    if (!operation) {
      return c.json({ error: "Operation not found" }, 404);
    }
    return c.json({ operation });
  } catch (error) {
    console.error("Error getting operation:", error);
    return c.json({ error: "Operation not found" }, 404);
  }
});

// src/routes/takehomePublic.ts
import { Hono as Hono9 } from "hono";

// src/lib/instance.ts
async function provisionInstance(params) {
  try {
    if (params.onData) {
      params.onData("Starting infrastructure provisioning...\n");
    }
    const result = await terraformManager.createInterviewStreaming(
      {
        id: params.instanceId,
        candidateName: params.candidateName,
        challenge: params.challengeId,
        password: params.password,
        openaiApiKey: params.openaiApiKey
      },
      params.onData,
      params.onInfrastructureReady
    );
    if (result.success) {
      logger.info("Instance provisioned successfully", {
        instanceId: params.instanceId,
        accessUrl: result.accessUrl
      });
      return {
        success: true,
        accessUrl: result.accessUrl,
        healthCheckPassed: result.healthCheckPassed,
        infrastructureReady: result.infrastructureReady,
        fullOutput: result.fullOutput
      };
    } else {
      logger.error("Instance provisioning failed", {
        instanceId: params.instanceId,
        error: result.error
      });
      return {
        success: false,
        error: result.error,
        fullOutput: result.fullOutput
      };
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    logger.error("Exception during instance provisioning", {
      instanceId: params.instanceId,
      error: errorMsg
    });
    return {
      success: false,
      error: errorMsg
    };
  }
}
async function destroyInstance(instanceId, params = {}) {
  try {
    if (params.onData) {
      params.onData("Starting infrastructure destruction...\n");
    }
    const result = await terraformManager.destroyInterviewStreaming(
      instanceId,
      params.onData,
      params.candidateName,
      params.challenge,
      params.saveFiles
    );
    if (result.success) {
      logger.info("Instance destroyed successfully", {
        instanceId,
        historyS3Key: result.historyS3Key
      });
      return {
        success: true,
        historyS3Key: result.historyS3Key,
        fullOutput: result.fullOutput
      };
    } else {
      logger.error("Instance destruction failed", {
        instanceId,
        error: result.error
      });
      return {
        success: false,
        error: result.error,
        fullOutput: result.fullOutput
      };
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    logger.error("Exception during instance destruction", {
      instanceId,
      error: errorMsg
    });
    return {
      success: false,
      error: errorMsg
    };
  }
}

// src/routes/takehomePublic.ts
var takehomePublicRouter = new Hono9();
takehomePublicRouter.get("/:token", async (c) => {
  try {
    const token = c.req.param("token");
    const takeHome = await assessmentManager.getTakeHomeByToken(token);
    if (!takeHome) {
      return c.json({ error: "Take-home not found" }, 404);
    }
    const now = Math.floor(Date.now() / 1e3);
    const response = {
      sessionStatus: takeHome.sessionStatus
    };
    switch (takeHome.sessionStatus) {
      case "available":
        response.availableFrom = new Date(
          takeHome.availableFrom * 1e3
        ).toISOString();
        response.availableUntil = new Date(
          takeHome.availableUntil * 1e3
        ).toISOString();
        response.candidateName = takeHome.candidateName;
        response.challengeId = takeHome.challengeId;
        response.additionalInstructions = takeHome.additionalInstructions;
        break;
      case "activated":
        response.instanceStatus = takeHome.instanceStatus;
        response.additionalInstructions = takeHome.additionalInstructions;
        if (takeHome.activatedAt && typeof takeHome.activatedAt === "number") {
          response.activatedAt = new Date(
            takeHome.activatedAt * 1e3
          ).toISOString();
        }
        if (takeHome.autoDestroyAt && typeof takeHome.autoDestroyAt === "number") {
          response.autoDestroyAt = new Date(
            takeHome.autoDestroyAt * 1e3
          ).toISOString();
          response.timeRemaining = takeHome.autoDestroyAt - now;
        }
        if (takeHome.instanceStatus === "active") {
          response.accessUrl = takeHome.url;
          response.password = takeHome.password;
        }
        break;
      case "completed":
        response.instanceStatus = takeHome.instanceStatus;
        if (takeHome.activatedAt && typeof takeHome.activatedAt === "number") {
          response.activatedAt = new Date(
            takeHome.activatedAt * 1e3
          ).toISOString();
        }
        if (takeHome.destroyedAt && typeof takeHome.destroyedAt === "number") {
          response.destroyedAt = new Date(
            takeHome.destroyedAt * 1e3
          ).toISOString();
        }
        break;
      case "expired":
        response.availableFrom = new Date(
          takeHome.availableFrom * 1e3
        ).toISOString();
        response.availableUntil = new Date(
          takeHome.availableUntil * 1e3
        ).toISOString();
        break;
      case "revoked":
        break;
    }
    return c.json(response);
  } catch (error) {
    console.error("Error fetching take-home status:", error);
    return c.json({ error: "Failed to fetch take-home status" }, 500);
  }
});
takehomePublicRouter.post("/:token/activate", async (c) => {
  try {
    const token = c.req.param("token");
    const takeHome = await assessmentManager.getTakeHomeByToken(token);
    if (!takeHome) {
      return c.json({ error: "Take-home not found" }, 404);
    }
    if (takeHome.sessionStatus !== "available") {
      return c.json(
        { error: "Take-home already activated or completed" },
        400
      );
    }
    const now = Math.floor(Date.now() / 1e3);
    if (now < takeHome.availableFrom || now > takeHome.availableUntil) {
      return c.json(
        { error: "Take-home has expired or is not yet available" },
        400
      );
    }
    const durationHours = takeHome.durationHours || 4;
    const autoDestroyAt = new Date(Date.now() + durationHours * 60 * 60 * 1e3);
    const activatedAt = Math.floor(Date.now() / 1e3);
    const password = generateSecureString();
    const operationId = await operationManager.createOperation(
      "create",
      takeHome.id,
      takeHome.candidateName,
      takeHome.challengeId,
      void 0,
      // scheduledAt (immediate activation)
      autoDestroyAt,
      false
      // saveFiles
    );
    await assessmentManager.updateSessionStatus(
      takeHome.id,
      "takehome",
      "activated"
    );
    await assessmentManager.updateTakeHomeActivation(
      takeHome.id,
      activatedAt,
      Math.floor(autoDestroyAt.getTime() / 1e3)
    );
    setImmediate(async () => {
      try {
        await operationManager.updateOperationStatus(operationId, "running");
        const result = await provisionInstance({
          instanceId: takeHome.id,
          candidateName: takeHome.candidateName || "Candidate",
          challengeId: takeHome.challengeId,
          password,
          // Securely generated random password
          autoDestroyAt: Math.floor(autoDestroyAt.getTime() / 1e3),
          resourceConfig: takeHome.resourceConfig,
          openaiApiKey: takeHome.openaiServiceAccount?.apiKey,
          onData: (data) => {
            operationManager.addOperationLog(operationId, data);
          },
          onInfrastructureReady: (accessUrl) => {
            operationManager.updateOperationInfrastructureReady(
              operationId,
              accessUrl,
              password
            );
          }
        });
        logger.info("Provisioning completed", {
          takeHomeId: takeHome.id,
          operationId,
          success: result.success,
          hasAccessUrl: !!result.accessUrl,
          error: result.error
        });
        await operationManager.addOperationLog(
          operationId,
          `Provisioning result: success=${result.success}, accessUrl=${result.accessUrl || "none"}`
        );
        await operationManager.setOperationResult(operationId, result);
        if (result.success) {
          logger.info("Updating instance status to active", {
            takeHomeId: takeHome.id
          });
          await assessmentManager.updateInstanceStatus(
            takeHome.id,
            "takehome",
            "active"
          );
          if (result.accessUrl) {
            await assessmentManager.updateAccessCredentials(
              takeHome.id,
              result.accessUrl,
              password
            );
            await operationManager.addOperationLog(
              operationId,
              `\u2705 Access credentials updated: ${result.accessUrl}`
            );
          }
          await operationManager.addOperationLog(
            operationId,
            "\u2705 Instance status updated to active"
          );
        } else {
          logger.error("Provisioning failed, updating status to error", {
            takeHomeId: takeHome.id,
            error: result.error
          });
          await assessmentManager.updateInstanceStatus(
            takeHome.id,
            "takehome",
            "error"
          );
          await operationManager.addOperationLog(
            operationId,
            `\u274C Provisioning failed: ${result.error}`
          );
        }
      } catch (error) {
        logger.error("Take-home activation failed", {
          takeHomeId: takeHome.id,
          operationId,
          error
        });
        await operationManager.setOperationResult(operationId, {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error"
        });
        await assessmentManager.updateInstanceStatus(
          takeHome.id,
          "takehome",
          "error"
        );
      }
    });
    logger.info("Take-home activation started", {
      takeHomeId: takeHome.id,
      operationId,
      autoDestroyAt: autoDestroyAt.toISOString()
    });
    return c.json({
      success: true,
      operationId,
      message: "Take-home activation in progress",
      autoDestroyAt: autoDestroyAt.toISOString()
    });
  } catch (error) {
    logger.error("Failed to activate take-home", { error });
    return c.json(
      {
        error: "Failed to activate take-home",
        details: error instanceof Error ? error.message : "Unknown error"
      },
      500
    );
  }
});

// src/routes/takehomes.ts
import { Hono as Hono10 } from "hono";
var takehomesRouter = new Hono10();
takehomesRouter.get("/", async (c) => {
  try {
    const takeHomes = await assessmentManager.listTakeHomes();
    const takeHomeList = takeHomes.map((takeHome) => {
      const item = {
        id: takeHome.id,
        candidateName: takeHome.candidateName,
        candidateEmail: takeHome.candidateEmail,
        challengeId: takeHome.challengeId,
        sessionStatus: takeHome.sessionStatus,
        instanceStatus: takeHome.instanceStatus,
        createdAt: new Date(takeHome.createdAt * 1e3).toISOString(),
        availableFrom: new Date(takeHome.availableFrom * 1e3).toISOString(),
        availableUntil: new Date(takeHome.availableUntil * 1e3).toISOString(),
        accessToken: takeHome.accessToken,
        url: takeHome.url,
        password: takeHome.password
      };
      if (takeHome.activatedAt) {
        item.activatedAt = new Date(takeHome.activatedAt * 1e3).toISOString();
      }
      if (takeHome.autoDestroyAt) {
        item.autoDestroyAt = new Date(
          takeHome.autoDestroyAt * 1e3
        ).toISOString();
      }
      if (takeHome.destroyedAt) {
        item.destroyedAt = new Date(takeHome.destroyedAt * 1e3).toISOString();
      }
      if (takeHome.saveFiles !== void 0) {
        item.saveFiles = takeHome.saveFiles;
      }
      return item;
    });
    return c.json({ takeHomes: takeHomeList });
  } catch (error) {
    console.error("Error listing take-homes:", error);
    return c.json({ error: "Failed to list take-homes" }, 500);
  }
});
takehomesRouter.post("/create", async (c) => {
  try {
    const body = await c.req.json();
    const {
      candidateName,
      candidateEmail,
      challengeId,
      availableDays = 7,
      durationHours = 4,
      additionalInstructions
    } = body;
    if (!candidateName || !challengeId) {
      return c.json(
        { error: "candidateName and challengeId are required" },
        400
      );
    }
    const takeHomeId = generateId();
    const accessToken = generateSecureString();
    const now = Math.floor(Date.now() / 1e3);
    const availableFrom = now;
    const availableUntil = now + availableDays * 24 * 60 * 60;
    let openaiServiceAccount;
    try {
      const serviceAccountResult = await openaiService.createServiceAccount(
        config.services.openaiProjectId,
        `interview-${config.project.environment}-takehome-${takeHomeId}-${candidateName}`
      );
      if (serviceAccountResult.success && serviceAccountResult.apiKey && serviceAccountResult.serviceAccountId) {
        openaiServiceAccount = {
          apiKey: serviceAccountResult.apiKey,
          projectId: config.services.openaiProjectId,
          serviceAccountId: serviceAccountResult.serviceAccountId
        };
      }
    } catch (error) {
      logger.warn("Failed to create OpenAI service account", {
        takeHomeId,
        error
      });
    }
    const takeHome = {
      PK: `TAKEHOME#${takeHomeId}`,
      SK: "METADATA",
      sessionType: "takehome",
      id: takeHomeId,
      accessToken,
      availableFrom,
      availableUntil,
      isActivated: false,
      sessionStatus: "available",
      createdBy: "admin",
      // TODO: Get from auth context
      candidateName,
      candidateEmail,
      additionalInstructions,
      durationHours,
      instanceStatus: "pending",
      challengeId,
      autoDestroyAt: void 0,
      // Set when activated
      resourceConfig: {
        cpu: 1024,
        // TODO: Get from challenge config
        memory: 2048,
        storage: 20
      },
      openaiServiceAccount
    };
    await assessmentManager.createTakeHome(takeHome);
    const protocol = c.req.header("x-forwarded-proto") || "http";
    const host = c.req.header("host") || "localhost";
    const accessUrl = `${protocol}://${host}/takehome/${accessToken}`;
    logger.info("Take-home created", {
      takeHomeId,
      candidateName,
      accessUrl
    });
    return c.json({
      success: true,
      takeHomeId,
      accessToken,
      accessUrl,
      availableFrom: new Date(availableFrom * 1e3).toISOString(),
      availableUntil: new Date(availableUntil * 1e3).toISOString()
    });
  } catch (error) {
    logger.error("Failed to create take-home", { error });
    return c.json(
      {
        error: "Failed to create take-home",
        details: error instanceof Error ? error.message : "Unknown error"
      },
      500
    );
  }
});
takehomesRouter.post("/:id/revoke", async (c) => {
  try {
    const id = c.req.param("id");
    logger.info("Revoke take-home request received", { id });
    const assessment = await assessmentManager.getAssessment(id);
    if (!assessment) {
      logger.warn("Take-home not found in database", { id });
      return c.json({ error: "Take-home not found" }, 404);
    }
    logger.info("Take-home found", {
      id,
      sessionType: assessment.sessionType,
      sessionStatus: assessment.sessionStatus,
      instanceStatus: assessment.instanceStatus
    });
    if (assessment.sessionType !== "takehome") {
      return c.json({ error: "This endpoint is for take-homes only" }, 400);
    }
    if (assessment.sessionStatus === "completed" || assessment.sessionStatus === "expired" || assessment.sessionStatus === "revoked") {
      return c.json(
        {
          error: `Cannot revoke - take-home is already ${assessment.sessionStatus}`
        },
        400
      );
    }
    if (assessment.instanceStatus === "destroying") {
      return c.json({ error: "Cannot revoke - already destroying" }, 400);
    }
    const existingOperations = await operationManager.getOperationsByInterview(id);
    const hasActiveRevoke = existingOperations.some(
      (op) => op.type === "revoke_takehome" && (op.status === "pending" || op.status === "running")
    );
    if (hasActiveRevoke) {
      return c.json({ error: "Revocation already in progress" }, 400);
    }
    const isActivated = assessment.sessionStatus === "activated";
    if (isActivated) {
      logger.info("Initiating destruction for activated take-home (revoke)", {
        takeHomeId: id,
        candidateName: assessment.candidateName
      });
      const operationId = await operationManager.createOperation(
        "revoke_takehome",
        id,
        assessment.candidateName,
        assessment.challengeId,
        void 0,
        // scheduledAt
        void 0,
        // autoDestroyAt
        true
        // saveFiles - always save files for revoked take-homes
      );
      setImmediate(async () => {
        try {
          await operationManager.updateOperationStatus(operationId, "running");
          await operationManager.addOperationLog(
            operationId,
            `Starting take-home revocation for ${id}`
          );
          await assessmentManager.updateSessionStatus(id, "takehome", "revoked");
          await assessmentManager.updateInstanceStatus(
            id,
            "takehome",
            "destroying"
          );
          await operationManager.addOperationLog(
            operationId,
            "Take-home status set to revoked, destroying infrastructure"
          );
          if (assessment.openaiServiceAccount) {
            await operationManager.addOperationLog(
              operationId,
              "Deleting OpenAI service account..."
            );
            const deleteResult = await openaiService.deleteServiceAccount(
              assessment.openaiServiceAccount.projectId,
              assessment.openaiServiceAccount.serviceAccountId
            );
            if (deleteResult.success) {
              await operationManager.addOperationLog(
                operationId,
                "OpenAI service account deleted successfully"
              );
            } else {
              await operationManager.addOperationLog(
                operationId,
                `OpenAI service account deletion failed: ${deleteResult.error}`
              );
            }
          }
          const result = await destroyInstance(id, {
            saveFiles: true,
            // Always save files for revoked take-homes
            candidateName: assessment.candidateName,
            challenge: assessment.challengeId,
            onData: (data) => {
              const lines = data.split("\n").filter((line) => line.trim());
              lines.forEach((line) => {
                operationManager.addOperationLog(operationId, line).catch(console.error);
              });
            }
          });
          if (result.success) {
            await operationManager.addOperationLog(
              operationId,
              "Infrastructure destroyed successfully"
            );
            await operationManager.addOperationLog(
              operationId,
              "Take-home revoked successfully!"
            );
            await operationManager.setOperationResult(operationId, {
              success: true,
              fullOutput: result.fullOutput,
              historyS3Key: result.historyS3Key
            });
          } else {
            await operationManager.addOperationLog(
              operationId,
              "Take-home revocation failed"
            );
            await operationManager.addOperationLog(
              operationId,
              `Error: ${result.error}`
            );
            await operationManager.setOperationResult(operationId, {
              success: false,
              error: result.error,
              fullOutput: result.fullOutput
            });
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : "Unknown error";
          await operationManager.addOperationLog(
            operationId,
            `Error: ${errorMsg}`
          );
          await operationManager.setOperationResult(operationId, {
            success: false,
            error: errorMsg
          });
        }
      });
      return c.json({
        success: true,
        operationId,
        message: "Revocation initiated"
      });
    } else {
      logger.info("Revoking non-activated take-home", {
        takeHomeId: id,
        sessionStatus: assessment.sessionStatus
      });
      if (assessment.openaiServiceAccount) {
        try {
          await openaiService.deleteServiceAccount(
            assessment.openaiServiceAccount.projectId,
            assessment.openaiServiceAccount.serviceAccountId
          );
          logger.info("OpenAI service account deleted", { takeHomeId: id });
        } catch (error) {
          logger.warn("Failed to delete OpenAI service account", {
            takeHomeId: id,
            error
          });
        }
      }
      await assessmentManager.updateSessionStatus(id, "takehome", "revoked");
      return c.json({
        success: true,
        message: "Take-home revoked successfully"
      });
    }
  } catch (error) {
    logger.error("Failed to revoke take-home", { error });
    return c.json(
      {
        error: "Failed to revoke take-home",
        details: error instanceof Error ? error.message : "Unknown error"
      },
      500
    );
  }
});
takehomesRouter.post("/:id/delete", async (c) => {
  try {
    const id = c.req.param("id");
    logger.info("Delete take-home request received", { id });
    const assessment = await assessmentManager.getAssessment(id);
    if (!assessment) {
      logger.warn("Take-home not found in database", { id });
      return c.json({ error: "Take-home not found" }, 404);
    }
    logger.info("Take-home found", {
      id,
      sessionType: assessment.sessionType,
      sessionStatus: assessment.sessionStatus
    });
    if (assessment.sessionType !== "takehome") {
      return c.json(
        { error: "This endpoint is for take-homes only, not a take-home" },
        400
      );
    }
    const isActivated = assessment.sessionStatus === "activated";
    if (isActivated) {
      logger.info("Initiating destruction for activated take-home", {
        takeHomeId: id,
        candidateName: assessment.candidateName
      });
      const operationId = await operationManager.createOperation(
        "destroy",
        id,
        assessment.candidateName,
        assessment.challengeId
      );
      setImmediate(async () => {
        try {
          await operationManager.updateOperationStatus(operationId, "running");
          await operationManager.addOperationLog(
            operationId,
            `Starting take-home destruction for ${id}`
          );
          if (assessment.openaiServiceAccount) {
            await operationManager.addOperationLog(
              operationId,
              "Deleting OpenAI service account..."
            );
            const deleteResult = await openaiService.deleteServiceAccount(
              assessment.openaiServiceAccount.projectId,
              assessment.openaiServiceAccount.serviceAccountId
            );
            if (deleteResult.success) {
              await operationManager.addOperationLog(
                operationId,
                "OpenAI service account deleted successfully"
              );
            } else {
              await operationManager.addOperationLog(
                operationId,
                `OpenAI service account deletion failed: ${deleteResult.error}`
              );
            }
          }
          const result = await destroyInstance(id, {
            saveFiles: assessment.saveFiles,
            candidateName: assessment.candidateName,
            challenge: assessment.challengeId,
            onData: (data) => {
              const lines = data.split("\n").filter((line) => line.trim());
              lines.forEach((line) => {
                operationManager.addOperationLog(operationId, line).catch(console.error);
              });
            }
          });
          if (result.success) {
            await operationManager.addOperationLog(
              operationId,
              "Infrastructure destroyed successfully"
            );
            await operationManager.addOperationLog(
              operationId,
              "Take-home destroyed successfully!"
            );
            await operationManager.setOperationResult(operationId, {
              success: true,
              fullOutput: result.fullOutput,
              historyS3Key: result.historyS3Key
            });
          } else {
            await operationManager.addOperationLog(
              operationId,
              "Take-home destruction failed"
            );
            await operationManager.addOperationLog(
              operationId,
              `Error: ${result.error}`
            );
            await operationManager.setOperationResult(operationId, {
              success: false,
              error: result.error,
              fullOutput: result.fullOutput
            });
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : "Unknown error";
          await operationManager.addOperationLog(
            operationId,
            `Error: ${errorMsg}`
          );
          await operationManager.setOperationResult(operationId, {
            success: false,
            error: errorMsg
          });
        }
      });
      return c.json({
        success: true,
        operationId,
        message: "Destruction initiated"
      });
    } else {
      logger.info("Deleting non-activated take-home", {
        takeHomeId: id,
        sessionStatus: assessment.sessionStatus
      });
      if (assessment.openaiServiceAccount) {
        try {
          await openaiService.deleteServiceAccount(
            assessment.openaiServiceAccount.projectId,
            assessment.openaiServiceAccount.serviceAccountId
          );
          logger.info("OpenAI service account deleted", { takeHomeId: id });
        } catch (error) {
          logger.warn("Failed to delete OpenAI service account", {
            takeHomeId: id,
            error
          });
        }
      }
      await assessmentManager.deleteTakeHome(id);
      return c.json({
        success: true,
        message: "Take-home deleted successfully"
      });
    }
  } catch (error) {
    logger.error("Failed to delete take-home", { error });
    return c.json(
      {
        error: "Failed to delete take-home",
        details: error instanceof Error ? error.message : "Unknown error"
      },
      500
    );
  }
});

// src/routes/index.ts
var apiRoutes = new Hono11();
apiRoutes.route("/auth", authRouter);
apiRoutes.route("/health", healthRouter);
apiRoutes.route("/interviews", interviewsRouter);
apiRoutes.route("/operations", operationsRouter);
apiRoutes.route("/takehomes", takehomesRouter);
apiRoutes.route("/takehome", takehomePublicRouter);
apiRoutes.route("/apikeys", apikeysRouter);
apiRoutes.route("/apikey", apikeyPublicRouter);
apiRoutes.route("/challenges", challengesRouter);
apiRoutes.route("/admin", adminRouter);

// src/server.ts
var serverLogger = logger.child({ component: "server" });
var PORT = Number(process.env.PORT) || 3e3;
var PUBLIC_DIR = process.env.PUBLIC_DIR || "./public";
var app = new Hono12();
app.onError((err, c) => {
  serverLogger.error("Unhandled error", {
    path: c.req.path,
    error: err instanceof Error ? err.message : String(err)
  });
  return c.json({ error: "Internal server error" }, 500);
});
app.use("*", honoLogger());
app.get("/health", (c) => c.text("ok"));
app.use("/api/*", authMiddleware);
app.route("/api", apiRoutes);
app.use("/assets/*", serveStatic({ root: PUBLIC_DIR }));
app.use("/favicon.ico", serveStatic({ path: `${PUBLIC_DIR}/favicon.ico` }));
app.get("*", serveStatic({ path: `${PUBLIC_DIR}/index.html` }));
serve({ fetch: app.fetch, port: PORT }, (info) => {
  serverLogger.info(`Prequel backend listening on :${info.port}`);
});
export {
  app
};
//# sourceMappingURL=server.js.map