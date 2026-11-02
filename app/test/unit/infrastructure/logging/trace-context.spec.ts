import { resolveTraceId } from '@infrastructure/logging/trace-context';

describe('resolveTraceId', () => {
  it('should extract the trace id of a w3c traceparent', () => {
    expect(resolveTraceId('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')).toBe(
      '4bf92f3577b34da6a3ce929d0e0e4736',
    );
  });

  it.each([
    ['absent', undefined],
    ['empty', ''],
    ['not w3c', 'abc'],
    ['uppercase', '00-4BF92F3577B34DA6A3CE929D0E0E4736-00F067AA0BA902B7-01'],
    ['invalid version', 'ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'],
    ['zero trace id', '00-00000000000000000000000000000000-00f067aa0ba902b7-01'],
  ])('should return no trace id when the traceparent is %s', (_case, traceparent) => {
    expect(resolveTraceId(traceparent)).toBeUndefined();
  });
});
