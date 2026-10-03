export const MAX_BYTES = 200 * 1024;
export const DAY = 86_400_000;
import type { AttachmentSettings, AttachmentUsage } from "./attachments";
export interface Settings extends AttachmentSettings {
  backgroundUrl: string;
  overlay: number;
  linkLength: number;
  retentionDays: number;
}
export interface Note {
  id: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}
export interface Stats {
  attachments: AttachmentUsage;
  active: number;
  expired: number;
  lastCleanup: {
    ran_at: number | null;
    deleted: number;
    kind: string | null;
    status: string | null;
  };
}
