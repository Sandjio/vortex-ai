import { Stack, StackProps, aws_events as events } from "aws-cdk-lib";
import { Construct } from "constructs";

interface EventBridgeStackProps extends StackProps {
  stageName: string;
}

export class EventBridgeStack extends Stack {
  public readonly eventBus: events.EventBus;

  constructor(scope: Construct, id: string, props: EventBridgeStackProps) {
    super(scope, id, props);

    this.eventBus = new events.EventBus(
      this,
      `WebhookEventBus-${props.stageName}`,
      {
        eventBusName: `WebhookEventBus-${props.stageName}`,
      }
    );
  }
}
