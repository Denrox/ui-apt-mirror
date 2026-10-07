/** A lock: the returned function runs each `fn` after every earlier one has settled. */
export function serialQueue(): <T>(fn: () => T | Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => T | Promise<T>): Promise<T> => {
    const run = tail.then(fn);
    tail = run.catch(() => undefined);
    return run;
  };
}
