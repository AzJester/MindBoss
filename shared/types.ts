export type EntryKind = "note" | "list" | "reminder";
export type EntryStatus = "active" | "archived" | "trashed";
export type CaptureSource =
  "web" | "android_share" | "chrome_extension" | "mindchuk_import";
export type RecurrenceRule = "daily" | "weekdays" | "weekly" | "monthly";
export type LayoutMode = "feed" | "board" | "calendar" | "flex";
export type ThemePreference = "dark" | "light" | "system";
export type FontPreference = "system" | "modern" | "classic";

export const SUPPORTED_TIMEZONES = [
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Anchorage",
  "Pacific/Honolulu",
  "UTC",
] as const;

export interface ListItem {
  id: string;
  text: string;
  position: number;
  completedAt: string | null;
  dueAt: string | null;
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
  extractedText?: string;
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
  recurrenceRule: RecurrenceRule | null;
  reviewAt: string | null;
  lastViewedAt: string | null;
  viewCount: number;
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
  recurrenceRule?: RecurrenceRule | null;
  reviewAt?: string | null;
  tagIds?: string[];
  listItems?: Array<
    Pick<ListItem, "id" | "text" | "position" | "completedAt" | "dueAt">
  >;
}

export interface EntryFilters {
  q?: string;
  status?: EntryStatus;
  kind?: EntryKind;
  tag?: string;
  sort?: "newest" | "oldest";
  from?: string;
  to?: string;
  pinned?: boolean;
  reminderState?: "pending" | "delivered" | "completed";
  hasAttachments?: boolean;
  due?: "today" | "overdue" | "upcoming";
  review?: "due" | "stale";
}

export interface SavedSearch {
  id: string;
  name: string;
  query: EntryFilters;
  createdAt: string;
  updatedAt: string;
}

export interface CaptureTemplate {
  id: string;
  name: string;
  kind: EntryKind;
  title: string;
  body: string;
  listItems: Array<Pick<ListItem, "text" | "dueAt">>;
  tagIds: string[];
  reminderText: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserPreferences {
  onboarding: Record<string, boolean>;
  defaultCaptureKind: EntryKind;
  quietStart: string | null;
  quietEnd: string | null;
  weeklyReviewDay: number;
  viewMode: LayoutMode;
  groupByTime: boolean;
  compactView: boolean;
  hideTagNav: boolean;
  theme: ThemePreference;
  fontFamily: FontPreference;
  displayTimezone: (typeof SUPPORTED_TIMEZONES)[number];
  boardTagIds: string[];
  sortOrder: "newest" | "oldest";
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
