/**
 * Sequential fan-out for the bulk row actions.
 *
 * There is no bulk endpoint for these (the only one the backend has is
 * POST /admin/questions/bulk, which creates), so a bulk action is N requests.
 * Two deliberate choices:
 *
 * - Sequential, not Promise.all: N parallel writes against one shared MySQL box
 *   is how a "deactivate 100 questions" click becomes an outage.
 * - Never stops at the first failure, and returns both halves. A partial result
 *   is the normal case (one row was deleted by someone else, one hit a 409) and
 *   the operator has to be told exactly which rows did not take, not handed a
 *   single rejected promise that hides the rest.
 */
export interface BulkOutcome<T> {
  done: T[];
  failed: { item: T; error: unknown }[];
}

export async function runSequential<T>(
  items: readonly T[],
  fn: (item: T) => Promise<unknown>,
): Promise<BulkOutcome<T>> {
  const outcome: BulkOutcome<T> = { done: [], failed: [] };
  for (const item of items) {
    try {
      await fn(item);
      outcome.done.push(item);
    } catch (error) {
      outcome.failed.push({ item, error });
    }
  }
  return outcome;
}
