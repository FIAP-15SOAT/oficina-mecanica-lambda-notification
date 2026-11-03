import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Context, SQSEvent } from 'aws-lambda';

import { handler } from '../src/handler';

const DEFAULT_EVENT = 'events/notification.event.json';

function buildContext(): Context {
  return {
    callbackWaitsForEmptyEventLoop: false,
    functionName: 'notification-local',
    functionVersion: '$LATEST',
    invokedFunctionArn: 'arn:aws:lambda:local:000000000000:function:notification-local',
    memoryLimitInMB: '256',
    awsRequestId: randomUUID(),
    logGroupName: '/local/notification',
    logStreamName: 'local',
    getRemainingTimeInMillis: () => 5_000,
    done: () => undefined,
    fail: () => undefined,
    succeed: () => undefined,
  };
}

async function invokeOnce(eventFile: string): Promise<void> {
  const event = JSON.parse(await readFile(eventFile, 'utf8')) as SQSEvent;

  console.log(JSON.stringify(await handler(event, buildContext()), null, 2));
}

void invokeOnce(process.argv[2] ?? DEFAULT_EVENT).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
