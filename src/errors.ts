import { BehavrApiErrorPayload } from "./types";

export class BehavrApiError extends Error {
  public readonly status: number;
  public readonly payload: BehavrApiErrorPayload | undefined;

  constructor(status: number, payload: BehavrApiErrorPayload | undefined, fallbackMessage: string) {
    const message = payload?.message || payload?.error || fallbackMessage;
    super(`BEHAVR API error (${status}): ${message}`);
    this.name = "BehavrApiError";
    this.status = status;
    this.payload = payload;
  }
}
