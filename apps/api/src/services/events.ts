import { EventEmitter } from 'node:events';

/**
 * Tells open list pages that a list changed, so they refetch. In-process:
 * openCook runs as one server, which is all a household needs.
 */
const emitter = new EventEmitter();
emitter.setMaxListeners(0);

export type ListChange = { listId: string; by: string | null; at: string };

export function listChanged(listId: string, by: string | null) {
  emitter.emit(`list:${listId}`, { listId, by, at: new Date().toISOString() });
}

export function onListChange(listId: string, fn: (e: ListChange) => void) {
  emitter.on(`list:${listId}`, fn);
  return () => emitter.off(`list:${listId}`, fn);
}
