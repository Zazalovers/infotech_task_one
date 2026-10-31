// Minimal typings for the Workers runtime module this project uses
// (full @cloudflare/workers-types would clash with @types/node).
declare module 'cloudflare:node' {
  export function httpServerHandler(options: { port: number }): {
    fetch(request: Request, env: unknown, ctx: unknown): Promise<Response>;
  };
}
