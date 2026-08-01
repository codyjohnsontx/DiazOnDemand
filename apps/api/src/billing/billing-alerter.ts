import { Injectable, Logger } from '@nestjs/common';

/**
 * Raises a billing alert somewhere a human will see it.
 *
 * Deliberately not a monitoring platform. Two channels, both of which work
 * wherever this API happens to be deployed:
 *
 * 1. An `error` log line prefixed `BILLING_ALERT` - greppable, and every host's
 *    log viewer can alert on a string.
 * 2. An optional POST to `BILLING_ALERT_WEBHOOK_URL`, which accepts the
 *    `{ "text": "..." }` body that Slack and Discord incoming webhooks use.
 *    Unset means channel 2 is simply off.
 *
 * The durable record lives in the `StripeWebhookEvent` table, so a missed alert
 * is still recoverable: every failed delivery is queryable.
 */
export interface BillingAlerter {
  send(message: string): Promise<void>;
}

export const BILLING_ALERTER = Symbol('BILLING_ALERTER');

const ALERT_TIMEOUT_MS = 5_000;

@Injectable()
export class LoggingBillingAlerter implements BillingAlerter {
  private readonly logger = new Logger('BillingAlert');

  async send(message: string) {
    this.logger.error(`BILLING_ALERT ${message}`);

    const url = process.env.BILLING_ALERT_WEBHOOK_URL;

    if (!url) {
      return;
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `Diaz on Demand billing alert: ${message}` }),
        signal: AbortSignal.timeout(ALERT_TIMEOUT_MS),
      });

      if (!response.ok) {
        this.logger.error(`Billing alert webhook returned ${response.status}`);
      }
    } catch (error) {
      // Never let the alert channel turn a recoverable webhook failure into a
      // different one. The log line above and the event row already happened.
      this.logger.error(`Billing alert webhook failed: ${(error as Error).message}`);
    }
  }
}
