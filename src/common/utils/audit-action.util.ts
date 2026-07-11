import { AuditAction } from '@prisma/client';
import { PersistAction } from '../interfaces/source-adapter.interface';

/** Shared by AdapterRunnerService and the webhook controllers so the
 * PersistAction -> AuditAction mapping exists in exactly one place. */
export function toAuditAction(action: PersistAction): AuditAction {
  if (action === 'created') return AuditAction.created;
  if (action === 'updated') return AuditAction.updated;
  return AuditAction.skipped_duplicate;
}
