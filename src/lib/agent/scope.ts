import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Which carrier the work in progress is for, so what it costs (the AI's tokens, lib/ai/usage) is counted against the
 * right one without passing the carrier through every function. Set where work for a carrier starts: a text, an
 * email, a call turn, the dispatcher's rounds, the in-app chat.
 */
const scope = new AsyncLocalStorage<string>();

export const forCarrier = <T>(carrierId: string, fn: () => Promise<T>): Promise<T> => scope.run(carrierId, fn);
export const currentCarrier = (): string | null => scope.getStore() ?? null;
