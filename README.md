# argentina-mcp

Servidor MCP público para consultar datos oficiales de Argentina. Podés verificar si una fecha es hábil y listar feriados de Nación, CABA o provincia de Buenos Aires. Cada respuesta incluye los enlaces oficiales que respaldan el dato.

El endpoint usa Streamable HTTP. Podés conectarte sin cuenta ni API key en `https://argentina-mcp.vercel.app/mcp`.

| Tool | Parámetros |
| --- | --- |
| `is_business_day` | `date` (AAAA-MM-DD), `jurisdiction` y `calendar` (`general`, `banking` o `judicial`). |
| `list_holidays` | `year` y `jurisdiction`. |

Usá `AR` para Nación, `AR-C` para CABA o `AR-B` para provincia de Buenos Aires. Por ejemplo, el 23 de marzo de 2026 es hábil para el calendario general nacional e inhábil para el bancario.

Hay un límite de 60 solicitudes por minuto por IP. Si tu cliente recibe un HTTP 429, esperá los segundos indicados en `Retry-After`. Los clientes alojados pueden compartir una IP de salida.

## Desarrollo local

Con Node.js 22 y pnpm, corré `pnpm install` y `pnpm dev`. Para consultar datos, configurá `FERIADOS_API_BASE_URL` en `.env.local` con la URL de una instancia de feriados. Si usás el origen de Vercel, configurá también su credencial interna. Podés correr las pruebas con `pnpm test`.
Official Argentine public data over the Model Context Protocol.
