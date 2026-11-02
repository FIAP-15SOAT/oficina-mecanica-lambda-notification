export interface DiagnosticsCapture {
  spy: jest.SpyInstance;
  lines(): Record<string, unknown>[];
  text(): string;
  restore(): void;
}

export function captureDiagnostics(): DiagnosticsCapture {
  const spy = jest.spyOn(process.stderr, 'write').mockReturnValue(true);

  const written = (): string[] =>
    spy.mock.calls
      .map((call) => String(call[0]))
      .flatMap((chunk) => chunk.split('\n'))
      .filter((line) => line.trim().length > 0);

  return {
    spy,
    lines: () => written().map((line) => JSON.parse(line) as Record<string, unknown>),
    text: () => written().join('\n'),
    restore: () => spy.mockRestore(),
  };
}

export function failDiagnostics(): DiagnosticsCapture {
  const capture = captureDiagnostics();

  capture.spy.mockImplementation(() => {
    throw new Error('EPIPE');
  });

  return capture;
}
