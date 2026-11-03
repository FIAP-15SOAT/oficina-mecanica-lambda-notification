export const TRACE_ID_ATTRIBUTE = 'trace_id';

// W3C traceparent: version ff and an all-zero trace id are invalid, so no trace id is better than a fake one.
const TRACEPARENT = /^(?!ff)[\da-f]{2}-(?!0{32})([\da-f]{32})-[\da-f]{16}-[\da-f]{2}$/;

export function resolveTraceId(traceparent: string | undefined): string | undefined {
  return TRACEPARENT.exec(traceparent ?? '')?.[1];
}
