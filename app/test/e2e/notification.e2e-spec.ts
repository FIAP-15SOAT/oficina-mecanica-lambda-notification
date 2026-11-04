import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { join } from 'node:path';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { GetQueueUrlCommand, Message, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { LocalstackContainer, StartedLocalStackContainer } from '@testcontainers/localstack';
import type { SQSRecord } from 'aws-lambda';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';

import { resetDependencies } from '../../src/bootstrap';
import { handler } from '../../src/handler';
import { buildContext, buildEnvelope, QUEUE_NAME, TRACEPARENT } from '../helpers/sqs-event.factory';

const TOPIC_ARN = 'arn:aws:sns:us-east-1:000000000000:oficina-events.fifo';
const RECIPIENT = 'maria@example.com';

// ASCII only, so the MIME parts reach MailHog without quoted-printable encoding
const PAYLOAD = {
  to: [RECIPIENT],
  subject: 'Sua conta foi criada',
  text: 'Senha inicial: Tmp#4821',
  html: '<p>Senha inicial: <strong>Tmp#4821</strong></p>',
  purpose: 'staff_initial_password',
};

interface MailhogMessage {
  Content: { Headers: Record<string, string[]> };
  MIME: { Parts: { Body: string }[] };
}

interface MailhogMessages {
  total: number;
  items: MailhogMessage[];
}

// The SDK returns PascalCase message attributes; the Lambda event source delivers them in camelCase
function toSqsRecord(message: Message, queueArn: string): SQSRecord {
  return {
    messageId: message.MessageId!,
    receiptHandle: message.ReceiptHandle!,
    body: message.Body!,
    attributes: message.Attributes as unknown as SQSRecord['attributes'],
    messageAttributes: Object.fromEntries(
      Object.entries(message.MessageAttributes ?? {}).map(([name, attribute]) => [
        name,
        { stringValue: attribute.StringValue, dataType: attribute.DataType! },
      ]),
    ),
    md5OfBody: message.MD5OfBody!,
    eventSource: 'aws:sqs',
    eventSourceARN: queueArn,
    awsRegion: 'us-east-1',
  };
}

describe('email delivery from the topic to MailHog', () => {
  let mailhog: StartedTestContainer;
  let localstack: StartedLocalStackContainer;
  let mailhogApi: string;
  let snsClient: SNSClient;
  let sqsClient: SQSClient;
  let queueUrl: string;
  const queueArn = `arn:aws:sqs:us-east-1:000000000000:${QUEUE_NAME}`;
  const originalEnv = process.env;

  async function publishAndHandle(payload: Record<string, unknown>) {
    const groupId = randomUUID();

    await snsClient.send(
      new PublishCommand({
        TopicArn: TOPIC_ARN,
        Message: JSON.stringify(buildEnvelope({ workOrderId: groupId, payload })),
        MessageGroupId: groupId,
        MessageDeduplicationId: randomUUID(),
        MessageAttributes: {
          type: { DataType: 'String', StringValue: 'notification.email.send' },
          traceparent: { DataType: 'String', StringValue: TRACEPARENT },
        },
      }),
    );

    const { Messages } = await sqsClient.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
        MessageAttributeNames: ['All'],
        MessageSystemAttributeNames: ['All'],
      }),
    );

    const record = toSqsRecord(Messages![0], queueArn);

    const response = await handler({ Records: [record] }, buildContext());

    return { record, response };
  }

  async function fetchMailhogMessages(): Promise<MailhogMessages> {
    const response = await fetch(`${mailhogApi}/api/v2/messages`);

    return (await response.json()) as MailhogMessages;
  }

  beforeAll(async () => {
    mailhog = await new GenericContainer('mailhog/mailhog:v1.0.1')
      .withExposedPorts(1025, 8025)
      .start();

    localstack = await new LocalstackContainer('localstack/localstack:4.14.0')
      .withCopyFilesToContainer([
        {
          source: join(__dirname, '..', '..', 'localstack', 'init-topology.sh'),
          target: '/etc/localstack/init/ready.d/init-topology.sh',
          mode: 0o755,
        },
      ])
      .withWaitStrategy(Wait.forLogMessage('oficina-events.fifo topology ready'))
      .start();

    const mailhogHost = (await lookup(mailhog.getHost(), { family: 4 })).address;
    mailhogApi = `http://${mailhogHost}:${mailhog.getMappedPort(8025)}`;

    const awsConfig = {
      endpoint: localstack.getConnectionUri(),
      region: 'us-east-1',
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    };

    snsClient = new SNSClient(awsConfig);
    sqsClient = new SQSClient(awsConfig);

    const queue = await sqsClient.send(new GetQueueUrlCommand({ QueueName: QUEUE_NAME }));
    queueUrl = queue.QueueUrl!;

    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      SMTP_HOST: mailhogHost,
      SMTP_PORT: String(mailhog.getMappedPort(1025)),
      MAIL_FROM: 'Oficina Mecanica <noreply@oficina.local>',
      // No OTLP receiver here: span export stays off even when the shell defines the endpoint
      OTEL_EXPORTER_OTLP_ENDPOINT: '',
    };
  });

  beforeEach(async () => {
    resetDependencies();

    await fetch(`${mailhogApi}/api/v1/messages`, { method: 'DELETE' });
  });

  afterAll(async () => {
    resetDependencies();
    process.env = originalEnv;

    snsClient?.destroy();
    sqsClient?.destroy();
    await localstack?.stop();
    await mailhog?.stop();
  });

  it('should deliver to mailhog the email published on the topic', async () => {
    const { response } = await publishAndHandle(PAYLOAD);

    const { total, items } = await fetchMailhogMessages();

    expect(response.batchItemFailures).toEqual([]);
    expect(total).toBe(1);
    expect(items[0].Content.Headers.To.join(',')).toContain(RECIPIENT);
    expect(items[0].Content.Headers.Subject).toEqual([PAYLOAD.subject]);

    const bodies = items[0].MIME.Parts.map((part) => part.Body);

    expect(bodies).toEqual(
      expect.arrayContaining([
        expect.stringContaining(PAYLOAD.text),
        expect.stringContaining(PAYLOAD.html),
      ]),
    );
  });

  it('should return a message without recipients as failure and deliver nothing', async () => {
    const { record, response } = await publishAndHandle({ ...PAYLOAD, to: [] });

    const { total } = await fetchMailhogMessages();

    expect(response.batchItemFailures).toEqual([{ itemIdentifier: record.messageId }]);
    expect(total).toBe(0);
  });
});
