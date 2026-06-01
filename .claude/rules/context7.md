---
alwaysApply: true
---

When looking up library, framework, or API documentation:

1. **Always try Context7 MCP first** — call `resolve-library-id`, pick the best match, then `query-docs`
2. **Fall back to WebFetch/WebSearch only if** Context7 doesn't have the library
3. **Never rely on training data alone** when either option is available

Prefer exact names and version-specific IDs when a version is mentioned. Include code examples and cite the version.
