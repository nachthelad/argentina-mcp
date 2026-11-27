# Operations

`argentina-mcp` serves the MCP SDK over stateless Streamable HTTP at `/mcp`. `/health` confirms that the application is running. The production server calls feriados-ar-api directly using `FERIADOS_API_INTERNAL_SECRET` and requests `include_evidence=true`. It calls indices-ar-api directly using `INDICES_API_INTERNAL_SECRET` on read GET routes.

Every successful tool response includes `data`, `source_url`, `legal_reference`, and `sources` in structured content and as JSON text. Each source identifies its role, official URL, and legal reference where applicable. Judicial results identify their court scope. The national calendar excludes recesses specific to federal courts outside the documented coverage.

## Deployment

Vercel connects an Upstash Redis Free instance and injects `KV_REST_API_URL` and `KV_REST_API_TOKEN`. A fixed 60-second window starts on the first request from each IP. Redis counts requests atomically across instances. The 61st request during the window receives HTTP 429 and a `Retry-After` value in seconds. A Redis error or a timeout of 500 ms lets the request continue and logs `rate_limiter_unavailable` with a request ID and error type.

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` before merging. Run `pnpm test:properties` against a local feriados-ar-api instance for calendar changes. After Vercel serves the merged revision, run `pnpm smoke https://argentina-mcp.ignacioventura.com.ar/mcp`. `https://argentina-mcp.nachthelad.com.ar/mcp` and `https://argentina-mcp.vercel.app/mcp` still serve the same deployment. Setting `MCP_SMOKE_DEADLINE=1` runs the judicial deadline example instead.

## Registry release

The public server name is `ar.com.ignacioventura/argentina-mcp`. That is the reverse-DNS form of `ignacioventura.com.ar`: the registry reverses every label, so `ignacioventura.com.ar` becomes `ar.com.ignacioventura`, and the server id stays after the slash. DNS login with `--domain ignacioventura.com.ar` grants `ar.com.ignacioventura/*` and, separately, `ar.com.ignacioventura.*` for names under subdomains. `ar.com.ignacioventura/argentina-mcp` matches the exact-domain permission. A subdomain name would look like `ar.com.ignacioventura.<label>/<server>` and would belong to `<label>.ignacioventura.com.ar`. The registry does not strip the `.com.ar` public suffix and does not require an extra label.

`server.json` description is limited to 100 characters by the `2025-12-11` schema. Keep `package.json` and `server.json` on the same version. Publish only from a verified revision on `main`, with a matching tag such as `v0.2.1`. The tag push runs [the publish workflow](https://modelcontextprotocol.io/registry/github-actions), which logs in with `mcp-publisher login dns --domain ignacioventura.com.ar --private-key ...` and then publishes. The private key is the repository secret `MCP_REGISTRY_PRIVATE_KEY`: a 64-character hex Ed25519 seed for `ignacioventura.com.ar`. The workflow rejects any other shape and does not print the secret. [DNS authentication](https://modelcontextprotocol.io/registry/authentication) proves the domain.

Generate the key on a machine you control. Do not commit it.

```powershell
powershell -File .\scripts\generate-registry-key.ps1
```

The script prefers OpenSSL 3 from Git for Windows and falls back to a Node.js Ed25519 one-liner when that `openssl` is missing or cannot generate Ed25519. It writes the seed to `%USERPROFILE%\.mcp-registry\ignacioventura.key` and prints the TXT value for the apex of `ignacioventura.com.ar` plus the secret command. It does not read or write `%USERPROFILE%\.mcp-registry\argentina-mcp.key`. That file is the `nachthelad.com.ar` seed and is still required to deprecate `ar.com.nachthelad/argentina-mcp` 0.2.0. If `ignacioventura.key` already exists, the script stops.

In the Cloudflare zone `ignacioventura.com.ar`, add a TXT record at `@` (the apex `ignacioventura.com.ar`). The value is the printed line, `v=MCPv1; k=ed25519; p=<public key base64>`. Put it on the apex, not on `_mcp-auth`, `_mcp-registry`, or `argentina-mcp`. When rotating the key, remove the previous `v=MCPv1` TXT at the apex or verification can fail on the stale record. Confirm propagation with `dig TXT ignacioventura.com.ar +short` before tagging. Attach `argentina-mcp.ignacioventura.com.ar` to the Vercel project so the canonical remote serves this deployment. Leave `argentina-mcp.nachthelad.com.ar` and `argentina-mcp.vercel.app` in place.

This `gh` build has no `--body-file` flag, and PowerShell does not treat `<` as input redirection. Load the secret from PowerShell without printing the seed:

```powershell
gh secret set MCP_REGISTRY_PRIVATE_KEY --body (Get-Content "$HOME\.mcp-registry\ignacioventura.key" -Raw).Trim()
```

That replaces the secret value the publish workflow reads. Keep the `nachthelad.com.ar` seed in `argentina-mcp.key` on disk. After the workflow succeeds, check that the registry shows `ar.com.ignacioventura/argentina-mcp` at `0.2.1` with remote `https://argentina-mcp.ignacioventura.com.ar/mcp`.

### Deprecate `ar.com.nachthelad/argentina-mcp` 0.2.0

Do this after `0.2.1` is published. Do not delete the version. The `ignacioventura.com.ar` token cannot change that entry: it only covers `ar.com.ignacioventura/*` and `ar.com.ignacioventura.*`. Log in with the existing `nachthelad.com.ar` seed from `argentina-mcp.key`. Do not replace that file with `ignacioventura.key`.

```text
mcp-publisher login dns --domain nachthelad.com.ar --private-key <seed from argentina-mcp.key>
mcp-publisher status --status deprecated --message "Replaced by ar.com.ignacioventura/argentina-mcp. Use https://argentina-mcp.ignacioventura.com.ar/mcp." ar.com.nachthelad/argentina-mcp 0.2.0
```

From PowerShell, pass the seed with `--private-key-file`. Publisher v1.8.16 reads the file and does not print the key:

```powershell
mcp-publisher login dns --domain nachthelad.com.ar --private-key-file "$HOME\.mcp-registry\argentina-mcp.key"
mcp-publisher status --status deprecated --message "Replaced by ar.com.ignacioventura/argentina-mcp. Use https://argentina-mcp.ignacioventura.com.ar/mcp." ar.com.nachthelad/argentina-mcp 0.2.0
```

`deprecated` keeps the version visible with the message. It does not clear `isLatest`; clients have to read `status`. [Publisher status command](https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/cli/commands.md)

### Deprecate the GitHub-namespace entry

`io.github.nachthelad/argentina-mcp` version `0.1.0` stays in the registry. Do not delete it. Neither DNS token can change it. `ignacioventura.com.ar` covers `ar.com.ignacioventura/*` and `ar.com.ignacioventura.*`. `nachthelad.com.ar` covers `ar.com.nachthelad/*` and `ar.com.nachthelad.*`. Status is registry metadata, not a `server.json` field. Mark the old version deprecated with GitHub authentication, which still owns `io.github.nachthelad/*`, after `0.2.1` is published under the domain name. `deprecated` keeps the version visible with the message. It does not clear `isLatest`; clients have to read `status`.

```bash
mcp-publisher login github
mcp-publisher status --status deprecated \
  --message "Replaced by ar.com.ignacioventura/argentina-mcp. Use https://argentina-mcp.ignacioventura.com.ar/mcp." \
  io.github.nachthelad/argentina-mcp 0.1.0
```
