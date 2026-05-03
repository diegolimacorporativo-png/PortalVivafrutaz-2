import { db } from "../../database/db";
import { eventStore, eventRiskSnapshots, systemAlerts, type InsertEventStore, type InsertEventRiskSnapshot, type InsertSystemAlert } from "../../../shared/schema";

export const eventRepository = {
  async saveEvent(event: { id: string; type: string; entityType?: string; entityId?: string; metadata?: Record<string, any>; timestamp: Date }) {
    const row: InsertEventStore = {
      id: event.id,
      type: event.type,
      entityType: event.entityType ?? null,
      entityId: event.entityId ?? null,
      metadata: event.metadata ?? null,
    };
    await db.insert(eventStore).values(row);
  },
  async getRecentEvents(limit = 100) {
    return db.select().from(eventStore).orderBy(eventStore.createdAt).limit(limit);
  },
  async getEvents() {
    return db.select().from(eventStore);
  },
  async saveRiskSnapshot(snapshot: InsertEventRiskSnapshot) {
    await db.insert(eventRiskSnapshots).values(snapshot);
  },
  async saveAlert(alert: InsertSystemAlert) {
    await db.insert(systemAlerts).values(alert);
  },
};