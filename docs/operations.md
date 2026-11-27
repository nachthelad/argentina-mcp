# Operations

`argentina-mcp` serves the MCP SDK over stateless Streamable HTTP at `/mcp`. `/health` confirms that the application is running. The production server calls feriados-ar-api directly using `FERIADOS_API_INTERNAL_SECRET` and requests `include_evidence=true`. It calls indices-ar-api directly using `INDICES_API_INTERNAL_SECRET` on read GET routes.

Every successful tool response includes `data`, `source_url`, `legal_reference`, and `sources` in structured content and as JSON text. Each source identifies its role, official URL, and legal reference where applicable. Judicial results identify their court scope. The national calendar excludes recesses specific to federal courts outside the documented coverage.

## Deployment

Vercel connects an Upstash Redis Free instance and injects `KV_REST_API_URL` and `KV_REST_API_TOKEN`. A fixed 60-second window starts on the first request from each IP. Redis counts requests atomically across instances. The 61st request during the window receives HTTP 429 and a `Retry-After` value in seconds. A Redis error or a timeout of 500 ms lets the request continue and logs `rate_limiter_unavailable` with a request ID and error type.

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` before merging. Run `pnpm test:properties` against a local feriados-ar-api instance for calendar changes. After Vercel serves the merged revision, run `pnpm smoke https://argentina-mcp.vercel.app/mcp`. Setting `MCP_SMOKE_DEADLINE=1` runs the judicial deadline example instead.

## Registry release

Verify the public endpoint from Claude Desktop and Cursor. Keep the package version and `server.json` version in sync. Push a matching tag from the verified revision on `main`, such as `v0.1.0`. The release workflow publishes the remote server to the official MCP Registry using GitHub OIDC. Check the version and the remote URL in the registry after the workflow succeeds. [Official publishing guide](https://modelcontextprotocol.io/registry/github-actions)
