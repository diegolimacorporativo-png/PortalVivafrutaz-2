import { randomUUID } from "node:crypto";
import { eventRepository } from "./event.repository";
import { processEventStream } from "./event-stream.processor";

export type SystemEvent = {
  id: string;
  type: "AUTH_LOGIN_SUCCESS" | "AUTH_LOGIN_FAILURE" | "AUTH_RATE_LIMIT_HIT" | "SESSION_INVALID" | "NF_E_CREATED" | "NF_E_FAILED" | "SECURITY_ANOMALY" | "SYSTEM_ERROR";
  entityType?: "user" | "company" | "nfe";
  entityId?: string;
  metadata?: Record<string, any>;
  timestamp: Date;
};

const queue: SystemEvent[] = [];
let draining = false;

async function drainQueue() {
  if (draining) return;
  draining = true;
  try {
    while (queue.length > 0) {
      const event = queue.shift();
      if (!event) continue;
      await eventRepository.saveEvent(event);
    }
  } catch {
  } finally {
    draining = false;
  }
}

export function emitEvent(event: Omit<SystemEvent, "id" | "timestamp"> & Partial<Pick<SystemEvent, "id" | "timestamp">>) {
  try {
    queue.push({
      id: event.id ?? randomUUID(),
      timestamp: event.timestamp ?? new Date(),
      type: event.type,
      entityType: event.entityType,
      entityId: event.entityId,
      metadata: event.metadata,
    });
    void processEventStream(queue[queue.length - 1] as SystemEvent);
    void drainQueue();
  } catch {
  }
}