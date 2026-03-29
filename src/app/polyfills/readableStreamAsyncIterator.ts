const maybeReadableStream = globalThis.ReadableStream as
  | (new (...args: unknown[]) => ReadableStream<Uint8Array>)
  | undefined;

if (
  maybeReadableStream &&
  typeof maybeReadableStream.prototype[Symbol.asyncIterator] !== "function"
) {
  Object.defineProperty(maybeReadableStream.prototype, Symbol.asyncIterator, {
    configurable: true,
    writable: true,
    value: function readableStreamAsyncIterator(this: ReadableStream<Uint8Array>) {
      const reader = this.getReader();
      return {
        async next() {
          return reader.read();
        },
        async return() {
          await reader.cancel();
          reader.releaseLock();
          return { done: true, value: undefined };
        },
        [Symbol.asyncIterator]() {
          return this;
        },
      };
    },
  });
}
