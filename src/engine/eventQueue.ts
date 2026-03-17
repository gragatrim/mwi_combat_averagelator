// =============================================================================
// EventQueue  --  min-heap priority queue sorted by event time
// Ported from MWICombatSimulatorTest/src/combatsimulator/events/eventQueue.js
// =============================================================================

import { Heap } from "heap-js";
import { CombatEvent, CombatEventType } from "./events/index";

/**
 * A min-heap priority queue that orders CombatEvents by their `time` field
 * (nanoseconds).  This is the central scheduler for the combat simulation --
 * every tick the simulator pops the earliest event, processes it, and
 * optionally pushes new follow-up events back onto the queue.
 */
export class EventQueue {
  private minHeap: Heap<CombatEvent>;

  constructor() {
    this.minHeap = new Heap<CombatEvent>((a, b) => a.time - b.time);
  }

  /** Push a new event onto the queue. */
  addEvent(event: CombatEvent): void {
    this.minHeap.push(event);
  }

  /** Pop and return the event with the smallest `time`. */
  getNextEvent(): CombatEvent | undefined {
    return this.minHeap.pop();
  }

  /**
   * Returns `true` if the queue contains at least one event whose `type`
   * matches the given CombatEventType.
   */
  containsEventOfType(type: CombatEventType): boolean {
    const heapEvents = this.minHeap.toArray();
    return heapEvents.some((event) => event.type === type);
  }

  /**
   * Returns `true` if the queue contains at least one event whose `type`
   * matches and whose `hrid` field equals the supplied value.
   *
   * Note: only PlayerRespawnEvent carries an `hrid` in the original codebase,
   * but the check is kept generic to mirror the JS implementation.
   */
  containsEventOfTypeAndHrid(type: CombatEventType, hrid: string): boolean {
    const heapEvents = this.minHeap.toArray();
    return heapEvents.some(
      (event) =>
        event.type === type &&
        (event as CombatEvent & { hrid?: string }).hrid === hrid
    );
  }

  /** Remove every event from the queue. */
  clear(): void {
    this.minHeap = new Heap<CombatEvent>((a, b) => a.time - b.time);
  }

  /**
   * Remove every event whose `source` or `target` field references the
   * given unit.  Used when a unit dies or is otherwise removed from combat.
   *
   * IMPORTANT: DamageOverTimeEvent intentionally stores the caster reference
   * as `sourceRef` (not `source`) so that DoT ticks survive the caster's
   * death.  This method only checks `source` and `target`.
   */
  clearEventsForUnit(unit: unknown): void {
    this.clearMatching(
      (event) =>
        (event as CombatEvent & { source?: unknown }).source === unit ||
        (event as CombatEvent & { target?: unknown }).target === unit
    );
  }

  /** Remove every event whose `type` matches the given CombatEventType. */
  clearEventsOfType(type: CombatEventType): void {
    this.clearMatching((event) => event.type === type);
  }

  /**
   * Remove every event for which `fn` returns `true`.
   * Returns `true` if at least one event was removed.
   */
  clearMatching(fn: (event: CombatEvent) => boolean): boolean {
    let cleared = false;
    const heapEvents = this.minHeap.toArray();

    for (const event of heapEvents) {
      if (fn(event)) {
        this.minHeap.remove(event);
        cleared = true;
      }
    }
    return cleared;
  }

  /**
   * Return the first event for which `fn` returns `true`, or `null` if none
   * match.  Does **not** remove the event from the queue.
   */
  getMatching(fn: (event: CombatEvent) => boolean): CombatEvent | null {
    const heapEvents = this.minHeap.toArray();

    for (const event of heapEvents) {
      if (fn(event)) {
        return event;
      }
    }

    return null;
  }
}

export default EventQueue;
