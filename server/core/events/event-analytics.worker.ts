import { analyzeEvents, saveAnalyticsSnapshot } from "./event-analytics.engine";
import { eventRepository } from "./event.repository";

let started = false;

export function startAnalyticsWorker() {
  if (started) return;
  started = true;
  const tick = async () => {
    try {
      const events = await eventRepository.getRecentEvents(1000);
      const analysis = analyzeEvents(events as any);
      await saveAnalyticsSnapshot(analysis);
    } catch {
    }
  };
  void tick();
  setInterval(() => void tick(), 30_000).unref();
}