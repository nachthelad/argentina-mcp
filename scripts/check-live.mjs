import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'

export async function checkLive(url, options) {
  const client = new Client({ name: 'argentina-mcp-smoke', version: '0.1.0' })
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(url), options))
    const { tools } = await client.listTools()
    assert.ok(tools.some(({ name }) => name === 'is_business_day'))
    for (const [calendar, expected] of [['banking', false], ['general', true]]) {
      const input = { jurisdiction: 'AR', date: '2026-03-23', calendar }
      const result = await client.callTool({ name: 'is_business_day', arguments: input })
      assert.equal(result.isError ?? false, false)
      assert.equal(result.structuredContent?.data.is_business_day, expected)
      const { data, source_url, legal_reference, sources } = result.structuredContent
      assert.match(source_url, calendar === 'banking' ? /^https:\/\/www\.bcra\.gob\.ar\// : /^https:\/\/www\.argentina\.gob\.ar\//)
      console.log(JSON.stringify({ tool: 'is_business_day', input, result: { data, source_url, legal_reference, sources } }))
    }
  } finally {
    await client.close()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.argv[2] ?? process.env.MCP_SMOKE_URL
  assert.ok(url, 'Pass the MCP endpoint URL as the first argument.')
  await checkLive(url)
}
