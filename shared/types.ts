export type EntryKind = "note" | "list" | "reminder";
export type EntryStatus = "active" | "archived" | "trashed";
export type CaptureSource =
  "web" | "android_share" | "chrome_extension" | "mindchuk_import";

export interface ListItem {
  id: string;
  text: string;
  position: number;
  completedAt: string | null;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  parentId: string | null;
  triggers: string[];
  createdAt: string;
}

export interface Attachment {
  id: string;
  entryId: string;
  fileName: string;
  mimeType: string;
  size: number;
  createdAt: string;
  url?: string;
}

export interface Entry {
  id: string;
  kind: EntryKind;
  title: string;
  body: string;
  source: CaptureSource;
  sourceUrl: string | null;
  sourceTitle: string | null;
  status: EntryStatus;
  pinnedAt: string | null;
  reminderAt: string | null;
  reminderState: "pending" | "sending" | "delivered" | "completed" | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  listItems: ListItem[];
  tags: Tag[];
  attachments: Attachment[];
}

export interface EntryInput {
  id: string;
  kind: EntryKind;
  title?: string;
  body?: string;
  source?: CaptureSource;
  sourceUrl?: string | null;
  sourceTitle?: string | null;
  reminderAt?: string | null;
  tagIds?: string[];
  listItems?: Array<Pick<ListItem, "id" | "text" | "position" | "completedAt">>;
}

export interface Session {
  authenticated: boolean;
  csrfToken?: string;
  user?: {
    id: number;
    login: string;
    avatarUrl: string;
  };
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: unknown;
  };
}
