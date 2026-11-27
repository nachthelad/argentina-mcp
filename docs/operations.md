# Operations

`argentina-mcp` serves the MCP SDK over stateless Streamable HTTP at `/mcp`. `/health` confirms that the application is running. The production server calls feriados-ar-api directly using `FERIADOS_API_INTERNAL_SECRET` and requests `include_evidence=true`. It calls indices-ar-api directly using `INDICES_API_INTERNAL_SECRET` on read GET routes.

Every successful tool response includes `data`, `source_url`, `legal_reference`, and `sources` in structured content and as JSON text. Each source identifies its role, official URL, and legal reference where applicable. Judicial results identify their court scope. The national calendar excludes recesses specific to federal courts outside the documented coverage.

## Deployment

Vercel connects an Upstash Redis Free instance and injects `KV_REST_API_URL` and `KV_REST_API_TOKEN`. A fixed 60-second window starts on the first request from each IP. Redis counts requests atomically across instances. The 61st request during the window receives HTTP 429 and a `Retry-After` value in seconds. A Redis error or a timeout of 500 ms lets the request continue and logs `rate_limiter_unavailable` with a request ID and error type.

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` before merging. Run `pnpm test:properties` against a local feriados-ar-api instance for calendar changes. After Vercel serves the merged revision, run `pnpm smoke https://argentina-mcp.nachthelad.com.ar/mcp`. `https://argentina-mcp.vercel.app/mcp` still serves the same deployment. Setting `MCP_SMOKE_DEADLINE=1` runs the judicial deadline example instead.

## Registry release

The public server name is `ar.com.nachthelad/argentina-mcp`. That is the reverse-DNS form of `nachthelad.com.ar`: the registry reverses every label, so `nachthelad.com.ar` becomes `ar.com.nachthelad`, and the server id stays after the slash. DNS login with `--domain nachthelad.com.ar` grants `ar.com.nachthelad/*` and, separately, `ar.com.nachthelad.*` for names under subdomains. `ar.com.nachthelad/argentina-mcp` matches the exact-domain permission. A subdomain name would look like `ar.com.nachthelad.<label>/<server>` and would belong to `<label>.nachthelad.com.ar`. The registry does not strip the `.com.ar` public suffix and does not require an extra label.

`server.json` description is limited to 100 characters by the `2025-12-11` schema. Keep `package.json` and `server.json` on the same version. Publish only from a verified revision on `main`, with a matching tag such as `v0.2.0`. The tag push runs [the publish workflow](https://modelcontextprotocol.io/registry/github-actions), which logs in with `mcp-publisher login dns --domain nachthelad.com.ar --private-key ...` and then publishes. The private key is the repository secret `MCP_REGISTRY_PRIVATE_KEY`: a 64-character hex Ed25519 seed. The workflow rejects any other shape and does not print the secret. [DNS authentication](https://modelcontextprotocol.io/registry/authentication) proves the domain.

Generate the key on a machine you control. Do not commit it.

```powershell
powershell -File .\scripts\generate-registry-key.ps1
```

The script prefers OpenSSL 3 from Git for Windows and falls back to a Node.js Ed25519 one-liner when that `openssl` is missing or cannot generate Ed25519. It writes the seed to `%USERPROFILE%\.mcp-registry\argentina-mcp.key` and prints only the TXT value plus the secret command. If that file already exists, the script stops.

In the Cloudflare zone `nachthelad.com.ar`, add a TXT record at `@` (the apex `nachthelad.com.ar`). The value is the printed line, `v=MCPv1; k=ed25519; p=<public key base64>`. Put it on the apex, not on `_mcp-auth`, `_mcp-registry`, or `argentina-mcp`. When rotating the key, remove the previous `v=MCPv1` TXT at the apex or verification can fail on the stale record. Confirm propagation with `dig TXT nachthelad.com.ar +short` before tagging.

Load the GitHub secret from the file. In cmd.exe or Git Bash:

```bat
gh secret set MCP_REGISTRY_PRIVATE_KEY < "%USERPROFILE%\.mcp-registry\argentina-mcp.key"
```

PowerShell does not treat `<` as redirection. From PowerShell:

```powershell
gh secret set MCP_REGISTRY_PRIVATE_KEY --body-file "$HOME\.mcp-registry\argentina-mcp.key"
```

After the workflow succeeds, check that the registry shows `ar.com.nachthelad/argentina-mcp` at `0.2.0` with remote `https://argentina-mcp.nachthelad.com.ar/mcp`.

### Deprecate the GitHub-namespace entry

`io.github.nachthelad/argentina-mcp` version `0.1.0` stays in the registry. Do not delete it. DNS authentication cannot change it: that token only covers `ar.com.nachthelad/*` and `ar.com.nachthelad.*`. Status is registry metadata, not a `server.json` field. Mark the old version deprecated with GitHub authentication, which still owns `io.github.nachthelad/*`, after `0.2.0` is published under the domain name. `deprecated` keeps the version visible with the message. It does not clear `isLatest`; clients have to read `status`. [Publisher status command](https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/cli/commands.md)

```bash
mcp-publisher login github
mcp-publisher status --status deprecated \
  --message "Replaced by ar.com.nachthelad/argentina-mcp. Use https://argentina-mcp.nachthelad.com.ar/mcp." \
  io.github.nachthelad/argentina-mcp 0.1.0
```
