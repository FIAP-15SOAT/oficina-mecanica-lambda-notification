export interface InvocationContext {
  awsRequestId: string;
  invokedFunctionArn: string;
  functionName: string;
  functionVersion: string;
  memoryLimitInMB: string;
  logStreamName: string;
}

export interface ExecutionAttributes {
  'faas.invocation_id': string;
  'faas.coldstart': boolean;
  'faas.name': string;
  'faas.version': string;
  'faas.instance': string;
  'faas.max_memory': number;
  'cloud.provider': string;
  'cloud.platform': string;
  'cloud.region': string;
  'cloud.resource_id': string;
}

const BYTES_PER_MEGABYTE = 1024 * 1024;

export const CLOUD_PROVIDER = 'aws';
export const CLOUD_PLATFORM = 'aws_lambda';

let coldStart = true;

export function resolveExecutionAttributes(
  context: InvocationContext,
  env: NodeJS.ProcessEnv = process.env,
): ExecutionAttributes {
  const attributes: ExecutionAttributes = {
    'faas.invocation_id': context.awsRequestId,
    'faas.coldstart': coldStart,
    'faas.name': context.functionName,
    'faas.version': context.functionVersion,
    'faas.instance': context.logStreamName,
    'faas.max_memory': toBytes(context.memoryLimitInMB),
    'cloud.provider': CLOUD_PROVIDER,
    'cloud.platform': CLOUD_PLATFORM,
    'cloud.region': env.AWS_REGION ?? '',
    'cloud.resource_id': context.invokedFunctionArn,
  };

  coldStart = false;

  return attributes;
}

function toBytes(memoryLimitInMB: string): number {
  const megabytes = Number.parseInt(memoryLimitInMB, 10);

  return Number.isFinite(megabytes) ? megabytes * BYTES_PER_MEGABYTE : 0;
}
