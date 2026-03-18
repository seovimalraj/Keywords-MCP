// ─────────────────────────────────────────────
//  utils/rateLimiter.ts  –  Per-provider throttle
// ─────────────────────────────────────────────
import Bottleneck from "bottleneck";
import { config } from "../config";

const limiters: Record<string, Bottleneck> = {};

function getLimiter(provider: keyof typeof config.rateLimits): Bottleneck {
  if (!limiters[provider]) {
    const { minTime, maxConcurrent } = config.rateLimits[provider];
    limiters[provider] = new Bottleneck({ minTime, maxConcurrent });
  }
  return limiters[provider];
}

/**
 * Schedule a function call through the provider's rate limiter.
 * Returns the same promise as the wrapped function.
 */
export function throttle<T>(
  provider: keyof typeof config.rateLimits,
  fn: () => Promise<T>
): Promise<T> {
  return getLimiter(provider).schedule(fn);
}
