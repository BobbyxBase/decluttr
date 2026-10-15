// Typed RPC client for the standalone DeCluttr server.
//
// Types come straight from `server/src/actions.ts` — no codegen.
// `import type { Actions }` is type-only by design: the client bundle never
// pulls in any server runtime (bun:sqlite, file APIs, etc.). With
// `verbatimModuleSyntax: true`, dropping `type` is a compile error.

import type { Actions } from "../../server/src/actions";

type ActionName = keyof typeof Actions;

export type ApiClient = {
  [K in ActionName]: (
    args: Parameters<(typeof Actions)[K]["handler"]>[1],
  ) => Promise<Awaited<ReturnType<(typeof Actions)[K]["handler"]>>>;
};

async function callAction(name: string, args: unknown): Promise<unknown> {
  const response = await fetch(`/api/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args ?? {}),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`DeCluttr request failed (${response.status}): ${text.slice(0, 200)}`);
  }
  return response.json();
}

export const api = new Proxy({} as ApiClient, {
  get: (_target, name: string) => (args: unknown) => callAction(name, args),
});

// Convenience types so client code can do
//
//     import { api, type ApiResponse } from "./api";
//     type Nft = ApiResponse<typeof api, "listNfts">["nfts"][number];
export type ApiRequest<T extends Record<string, (...args: any) => any>, K extends keyof T> = Parameters<T[K]>[0];
export type ApiResponse<T extends Record<string, (...args: any) => any>, K extends keyof T> = Awaited<ReturnType<T[K]>>;
