import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const token = process.env.CLOUDFLARE_API_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;

if (!token || !accountId) {
  console.error(
    "Error: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID env vars are required"
  );
  process.exit(1);
}

const server = new McpServer({
  name: "cloudflare-graphql",
  version: "1.0.0",
});

function json(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}


function err(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true as const };
}


async function cfFetch(
  method: string,
  path: string,
  body?: unknown
): Promise<unknown> {
  const url = `https://api.cloudflare.com/client/v4${path}`;
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };

  if (body) {
    init.body = JSON.stringify(body);
  }

  const res = await fetch(url, init);
  const data = (await res.json()) as {
    success?: boolean;
    errors?: Array<{ message: string }>;
  };

  if (!res.ok || !data.success) {
    const errorMsg =
      data.errors?.[0]?.message || `API error: ${res.statusText}`;
    throw new Error(errorMsg);
  }

  return data;
}

server.tool(
  "graphql_query",
  "Execute raw GraphQL query",
  {
    query: z.string(),
    variables: z.unknown().optional(),
  },
  async (params) => {
    try {
      const body: Record<string, unknown> = { query: params.query };
      if (params.variables) body.variables = params.variables;
      const data = await cfFetch("POST", "/graphql", body);
      return json(data);
    } catch (e) {
      return err(e);
    }
  }
);

server.tool(
  "graphql_list_zones",
  "List zones for analytics",
  {
    name: z.string().optional(),
    status: z.enum(["active", "pending", "initializing", "moved", "deleted", "cloaked", "ns_change"]).optional(),
    per_page: z.number().optional(),
  },
  async (params) => {
    try {
      const searchParams = new URLSearchParams();
      if (params.name) searchParams.append("name", params.name);
      if (params.status) searchParams.append("status", params.status);
      if (params.per_page) searchParams.append("per_page", String(params.per_page));

      const query = searchParams.toString();
      const path = `/zones${query ? `?${query}&account.id=${accountId}` : `?account.id=${accountId}`}`;
      const data = await cfFetch("GET", path);
      return json(data);
    } catch (e) {
      return err(e);
    }
  }
);

server.tool(
  "graphql_worker_analytics",
  "Get Worker analytics using GraphQL",
  {
    since: z.string(),
    until: z.string(),
    script_name: z.string().optional(),
    limit: z.number().optional(),
  },
  async (params) => {
    try {
      const graphqlQuery = `
        query {
          viewer {
            accounts(filter: {accountTag: "${accountId}"}) {
              workersInvocationsAdaptive(
                filter: {
                  timestamp_geq: "${params.since}"
                  timestamp_leq: "${params.until}"
                  ${params.script_name ? `scriptName: "${params.script_name}"` : ""}
                }
                limit: ${params.limit || 10}
              ) {
                count
                sum {
                  duration
                  cpu
                }
              }
            }
          }
        }
      `;

      const body = { query: graphqlQuery };
      const data = await cfFetch("POST", "/graphql", body);
      return json(data);
    } catch (e) {
      return err(e);
    }
  }
);

server.tool(
  "graphql_http_analytics",
  "Get HTTP analytics for a zone using GraphQL",
  {
    zone_id: z.string(),
    since: z.string(),
    until: z.string(),
    limit: z.number().optional(),
  },
  async (params) => {
    try {
      const graphqlQuery = `
        query {
          viewer {
            zones(filter: {zoneTag: "${params.zone_id}"}) {
              httpRequestsAdaptiveGroups(
                filter: {
                  timestamp_geq: "${params.since}"
                  timestamp_leq: "${params.until}"
                }
                limit: ${params.limit || 10}
              ) {
                count
                sum {
                  bytes
                  cachedBytes
                  requests
                }
              }
            }
          }
        }
      `;

      const body = { query: graphqlQuery };
      const data = await cfFetch("POST", "/graphql", body);
      return json(data);
    } catch (e) {
      return err(e);
    }
  }
);

server.tool(
  "graphql_firewall_analytics",
  "Get firewall analytics for a zone using GraphQL",
  {
    zone_id: z.string(),
    since: z.string(),
    until: z.string(),
    limit: z.number().optional(),
  },
  async (params) => {
    try {
      const graphqlQuery = `
        query {
          viewer {
            zones(filter: {zoneTag: "${params.zone_id}"}) {
              firewallEventsAdaptiveGroups(
                filter: {
                  timestamp_geq: "${params.since}"
                  timestamp_leq: "${params.until}"
                }
                limit: ${params.limit || 10}
              ) {
                count
                sum {
                  count
                }
              }
            }
          }
        }
      `;

      const body = { query: graphqlQuery };
      const data = await cfFetch("POST", "/graphql", body);
      return json(data);
    } catch (e) {
      return err(e);
    }
  }
);

server.tool(
  "graphql_datasets",
  "Introspect available GraphQL datasets",
  {},
  async () => {
    try {
      const introspectionQuery = `
        query {
          __schema {
            types {
              name
              kind
              description
            }
          }
        }
      `;

      const body = { query: introspectionQuery };
      const data = await cfFetch("POST", "/graphql", body);
      return json(data);
    } catch (e) {
      return err(e);
    }
  }
);

server.tool(
  "graphql_status",
  "Test GraphQL connectivity",
  {},
  async () => {
    try {
      const testQuery = `
        query {
          viewer {
            accounts(filter: {accountTag: "${accountId}"}) {
              id
            }
          }
        }
      `;

      const body = { query: testQuery };
      const data = await cfFetch("POST", "/graphql", body);
      return json({
        server: "cloudflare-graphql",
        version: "1.0.0",
        accountId,
        tokenStatus: "configured",
        graphqlStatus: (data as any).success ? "connected" : "error",
      });
    } catch (e) {
      return err(e);
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Cloudflare GraphQL Analytics MCP server running on stdio");
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
