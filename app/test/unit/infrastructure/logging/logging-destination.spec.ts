import { EventEmitter } from 'node:events';
import pino from 'pino';

import { createDefaultDestination } from '@infrastructure/logging/logging-destination';
import { DESTINATION_FAILURE_POLICY } from '@infrastructure/logging/logging-diagnostics';
import { captureDiagnostics, DiagnosticsCapture } from '../../../helpers/diagnostics-capture';

describe('createDefaultDestination', () => {
  let destinationSpy: jest.SpyInstance;
  let stream: EventEmitter;
  let stderr: DiagnosticsCapture;

  beforeEach(() => {
    stream = new EventEmitter();
    destinationSpy = jest
      .spyOn(pino, 'destination')
      .mockReturnValue(stream as unknown as ReturnType<typeof pino.destination>);
    stderr = captureDiagnostics();
  });

  afterEach(() => {
    destinationSpy.mockRestore();
    stderr.restore();
  });

  /**
   * `sync: true` because the asynchronous buffer loses the last lines when the
   * process dies suddenly — crash or OOM kill —, which is when they matter.
   */
  it('should write synchronously to stdout', () => {
    createDefaultDestination();

    expect(destinationSpy).toHaveBeenCalledWith({ dest: 1, sync: true });
  });

  /**
   * An `'error'` event with no listener on a Node stream **kills the process**:
   * without this handler, a broken `stdout` (EPIPE when the collector goes down)
   * would make logging kill the application it exists to observe.
   */
  it('should register an error listener so a broken stdout cannot kill the process', () => {
    const destination = createDefaultDestination();

    expect((destination as unknown as EventEmitter).listenerCount('error')).toBe(1);
  });

  /**
   * The destination diagnostic fires **once per process** — a broken stdout
   * would emit `error` on every write, and repeating the line on stderr would
   * trade silence for a flood. That is why the assertion lives in a single test.
   */
  it('should absorb the write error and report the declared failure policy once', () => {
    createDefaultDestination();

    expect(() => stream.emit('error', new Error('EPIPE'))).not.toThrow();

    const diagnostic = String(stderr.spy.mock.calls[0][0]);

    expect(diagnostic).toContain('"oficina.logging.failure.stage":"destination"');
    expect(diagnostic).toContain(DESTINATION_FAILURE_POLICY);

    stream.emit('error', new Error('EPIPE'));

    expect(stderr.spy).toHaveBeenCalledTimes(1);
  });
});
