export const nativeFetch: typeof globalThis.fetch = async (input, init) => {
  // grammY uses an AbortSignal polyfill; Node's fetch requires a native signal.
  const controller = new AbortController();
  const signal = init?.signal;
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  try {
    return await globalThis.fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    signal?.removeEventListener("abort", abort);
  }
};
