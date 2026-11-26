# argentina-mcp

Servidor MCP público para consultar datos oficiales de Argentina. Podés listar feriados, consultar y sumar días hábiles, y calcular plazos judiciales. Cada respuesta incluye los enlaces oficiales que respaldan el dato.

El endpoint usa Streamable HTTP. Podés conectarte sin cuenta ni API key en `https://argentina-mcp.vercel.app/mcp`.

| Tool | Parámetros |
| --- | --- |
| `is_business_day` | `date` (AAAA-MM-DD), `jurisdiction` y `calendar` (`general`, `banking` o `judicial`). |
| `list_holidays` | `year` y `jurisdiction`. |
| `next_business_day` | `date`, `jurisdiction` y `calendar`. Devuelve el primer hábil posterior a la fecha. |
| `add_business_days` | `date`, `days`, `jurisdiction` y `calendar`. Para retroceder, ingresá un número negativo. |
| `judicial_deadline` | `notification_date`, `days` positivos y `jurisdiction`. Informa el fuero y el plazo de gracia. |

Usá `AR` para Nación, `AR-C` para CABA o `AR-B` para provincia de Buenos Aires. Por ejemplo, el 23 de marzo de 2026 es hábil para el calendario general nacional e inhábil para el bancario.

Hay un límite de 60 solicitudes por minuto por IP. Si tu cliente recibe un HTTP 429, esperá los segundos indicados en `Retry-After`. Los clientes alojados pueden compartir una IP de salida.

## Desarrollo local

Con Node.js 22 y pnpm, corré `pnpm install` y `pnpm dev`. Para consultar datos, configurá `FERIADOS_API_BASE_URL` en `.env.local` con la URL de una instancia de feriados. Si usás el origen de Vercel, configurá también su credencial interna. Podés correr las pruebas con `pnpm test`.

Para verificar las propiedades del calendario, levantá `feriados-ar-api` en el puerto 3001 y corré `pnpm test:properties`. Si la API escucha en otro puerto, configurá `FERIADOS_PROPERTY_ORIGIN` con su URL local.
Official Argentine public data over the Model Context Protocol.
