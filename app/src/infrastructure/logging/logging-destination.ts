import pino, { DestinationStream } from 'pino';

import { reportDestinationFailure } from './logging-diagnostics';

/**
 * Default destination: a stream to fd 1 (stdout), in synchronous mode.
 *
 * `sync: true` because pino's asynchronous buffer loses the last lines when the
 * execution environment is frozen as soon as the handler returns — a buffered
 * line would be held until the next invocation, or lost if the environment were
 * recycled before it.
 *
 * The `error` handler is required, not zeal: an `'error'` event with no
 * listener on a Node stream kills the process, so a broken `stdout` — EPIPE
 * when the collector goes down — would make logging kill the application it
 * exists to observe.
 */
export function createDefaultDestination(): DestinationStream {
  const destination = pino.destination({ dest: 1, sync: true });

  destination.on('error', () => reportDestinationFailure());

  return destination;
}
