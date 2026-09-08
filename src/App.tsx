import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import Papa from "papaparse";
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  Bell,
  BellRing,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clipboard,
  Cloud,
  Download,
  ExternalLink,
  FileText,
  Hash,
  Inbox,
  ListChecks,
  LogOut,
  Menu,
  MoreHorizontal,
  Paperclip,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Share2,
  Sparkles,
  Tag as TagIcon,
  Trash2,
  Undo2,
  Upload,
  WifiOff,
  X,
} from "lucide-react";
import type {
  CaptureTemplate,
  Entry,
  EntryFilters,
  EntryInput,
  EntryStatus,
  ListItem,
  RecurrenceRule,
  SavedSearch,
  Session,
  Tag,
  UserPreferences,
} from "../shared/types";
import {
  ApiError,
  addAttachment,
  createClipToken,
  createEntry,
  deleteAttachment,
  deleteEntryPermanently,
  deleteTemplate,
  deleteTag,
  downloadFullBackup,
  exportUrl,
  getEntries,
  getEntry,
  getPreferences,
  getSavedSearches,
  getSession,
  getTags,
  getTemplates,
  importEntries,
  isLocalMode,
  logout,
  saveTag,
  savePreferences,
  saveTemplate,
  subscribeToPush,
  updateEntry,
} from "./api";
import { prepareAttachment, type PreparedAttachment } from "./attachments";
import {
  clearDraft,
  drainOutbox,
  loadDraft,
  outboxCount,
  saveDraft,
  saveOutbox,
  takePendingShare,
  type SharedCapture,
} from "./offline";
import {
  dateKeyForTimeZone,
  dueDateForDateKey,
  formatDateTime,
  isDue,
  parseReminder,
  tomorrowMorning,
} from "./reminders";
import {
  AdvancedSearchPanel,
  AiPanel,
  AppearanceCard,
  OnboardingChecklist,
  PreferencesCard,
  ReviewQueue,
  SmsCard,
  TodaySummary,
} from "./workflow-panels";
import { EntryLayouts, ViewControls } from "./view-layouts";

type View =
  | "today"
  | "inbox"
  | "lists"
  | "reminders"
  | "review"
  | "archive"
  | "trash"
  | "tags"
  | "settings";

interface Draft {
  id: string;
  kind: Entry["kind"];
  source: Entry["source"];
  title: string;
  body: string;
  sourceUrl: string;
  sourceTitle: string;
  reminderText: string;
  reminderAt: string | null;
  recurrenceRule: RecurrenceRule | null;
  reviewAt: string | null;
  tagIds: string[];
  listItems: ListItem[];
  files: PreparedAttachment[];
  editing?: Entry;
}

interface ConflictState {
  draft: Draft;
  input: EntryInput;
  server: Entry;
}

function freshDraft(kind: Entry["kind"] = "note"): Draft {
  return {
    id: crypto.randomUUID(),
    kind,
    source: "web",
    title: "",
    body: "",
    sourceUrl: "",
    sourceTitle: "",
    reminderText: "",
    reminderAt: null,
    recurrenceRule: null,
    reviewAt: null,
    tagIds: [],
    listItems: [],
    files: [],
  };
}

function draftFromEntry(entry: Entry, timeZone = "America/Phoenix"): Draft {
  return {
    id: entry.id,
    kind: entry.kind,
    source: entry.source,
    title: entry.title,
    body: entry.body,
    sourceUrl: entry.sourceUrl || "",
    sourceTitle: entry.sourceTitle || "",
    reminderText: entry.reminderAt
      ? formatDateTime(entry.reminderAt, timeZone)
      : "",
    reminderAt: entry.reminderAt,
    recurrenceRule: entry.recurrenceRule,
    reviewAt: entry.reviewAt,
    tagIds: entry.tags.map((tag) => tag.id),
    listItems: entry.listItems.map((item) => ({ ...item })),
    files: [],
    editing: entry,
  };
}

function parseSearchQuery(value: string, tags: Tag[]): EntryFilters {
  const filters: EntryFilters = {};
  const remaining: string[] = [];
  for (const token of value.trim().split(/\s+/).filter(Boolean)) {
    const [prefix, raw] = token.split(":", 2);
    const key = prefix.toLocaleLowerCase();
    const argument = raw?.toLocaleLowerCase();
    if (key === "tag" && argument) {
      filters.tag = tags.find(
        (tag) => tag.name.toLocaleLowerCase() === argument.replace(/^#/, ""),
      )?.id;
    } else if (
      key === "type" &&
      ["note", "list", "reminder"].includes(argument)
    ) {
      filters.kind = argument as Entry["kind"];
    } else if (key === "is" && argument === "pinned") filters.pinned = true;
    else if (key === "has" && ["attachment", "attachments"].includes(argument))
      filters.hasAttachments = true;
    else if (key === "after" && raw) filters.from = raw;
    else if (key === "before" && raw) filters.to = raw;
    else if (
      key === "due" &&
      ["today", "overdue", "upcoming"].includes(argument)
    )
      filters.due = argument as EntryFilters["due"];
    else remaining.push(token);
  }
  filters.q = remaining.join(" ") || undefined;
  return filters;
}

function sourceLabel(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

const NAV_ITEMS: Array<{ id: View; label: string; icon: typeof Inbox }> = [
  { id: "today", label: "Today", icon: CheckCircle2 },
  { id: "inbox", label: "Inbox", icon: Inbox },
  { id: "lists", label: "Lists", icon: ListChecks },
  { id: "reminders", label: "Reminders", icon: Bell },
  { id: "review", label: "Review", icon: Sparkles },
  { id: "archive", label: "Archive", icon: Archive },
  { id: "trash", label: "Trash", icon: Trash2 },
];

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand" aria-label="Mind Boss">
      <span className="brand-mark" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      {!compact && (
        <span className="brand-name">
          Mind <strong>Boss</strong>
        </span>
      )}
    </div>
  );
}

function UserAvatar({ user }: { user: Session["user"] }) {
  const [failedUrl, setFailedUrl] = useState("");
  const avatarUrl = user?.avatarUrl.trim() || "";
  const showImage = Boolean(avatarUrl && failedUrl !== avatarUrl);

  return showImage ? (
    <img
      src={avatarUrl}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setFailedUrl(avatarUrl)}
    />
  ) : (
    <span className="avatar-fallback" aria-hidden="true">
      MB
    </span>
  );
}

function SignIn() {
  return (
    <main className="signin-shell">
      <div className="signin-glow" />
      <section className="signin-card">
        <Logo />
        <div className="eyebrow">
          <Sparkles size={14} /> PRIVATE COMMAND CENTER
        </div>
        <h1>
          Everything worth keeping.
          <br />
          <span>Nothing left scattered.</span>
        </h1>
        <p>
          Capture notes, links, lists, and reminders from any browser or your
          Android share menu.
        </p>
        <a className="primary-button signin-button" href="/api/v1/auth/github">
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path
              fill="currentColor"
              d="M12 .7A11.5 11.5 0 0 0 8.36 23.1c.58.1.79-.25.79-.56v-2.2c-3.23.7-3.91-1.37-3.91-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.17.08 1.78 1.2 1.78 1.2 1.04 1.77 2.72 1.26 3.38.96.1-.75.41-1.27.74-1.56-2.58-.29-5.29-1.29-5.29-5.68 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.47.11-3.05 0 0 .97-.31 3.16 1.18a10.9 10.9 0 0 1 5.76 0c2.19-1.49 3.15-1.18 3.15-1.18.64 1.58.24 2.76.12 3.05.74.8 1.18 1.83 1.18 3.09 0 4.4-2.72 5.38-5.3 5.67.42.36.79 1.07.79 2.16v3.22c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z"
            />
          </svg>
          Sign in with GitHub
        </a>
        <p className="signin-footnote">
          Only the authorized AzJester account can enter.
        </p>
      </section>
    </main>
  );
}

function EmptyState({ view, onAdd }: { view: View; onAdd: () => void }) {
  const copy: Partial<Record<View, [string, string]>> = {
    inbox: [
      "Your mind has room again",
      "Capture a thought, clip a page, or share something from Android.",
    ],
    lists: [
      "No lists yet",
      "Turn the next loose set of tasks into one focused list.",
    ],
    reminders: [
      "Nothing is waiting",
      "Set a reminder in natural language and Mind Boss will bring it back.",
    ],
    today: [
      "Today is clear",
      "Anything due or captured today will collect here automatically.",
    ],
    review: [
      "Nothing needs review",
      "Set a review date on an entry and Mind Boss will resurface it here.",
    ],
    archive: [
      "Archive is clear",
      "Finished notes can rest here without disappearing.",
    ],
    trash: [
      "Trash is empty",
      "Deleted entries remain recoverable for 30 days.",
    ],
  };
  const [title, detail] = copy[view] || copy.inbox!;
  return (
    <div className="empty-state">
      <span className="empty-orbit">
        <Sparkles size={24} />
      </span>
      <h2>{title}</h2>
      <p>{detail}</p>
      {!["archive", "trash"].includes(view) && (
        <button className="primary-button" onClick={onAdd}>
          <Plus size={17} /> Capture something
        </button>
      )}
    </div>
  );
}

function EntryCard({
  entry,
  timeZone,
  onEdit,
  onChange,
  onDeletePermanently,
}: {
  entry: Entry;
  timeZone: string;
  onEdit: (entry: Entry) => void;
  onChange: (entry: Entry, changes: Record<string, unknown>) => Promise<void>;
  onDeletePermanently: (entry: Entry) => Promise<void>;
}) {
  const completed = entry.listItems.filter((item) => item.completedAt).length;
  const menuRef = useRef<HTMLDetailsElement>(null);
  const change = async (changes: Record<string, unknown>) => {
    if (menuRef.current) menuRef.current.open = false;
    await onChange(entry, { version: entry.version, ...changes });
  };
  return (
    <article
      className={`entry-card ${entry.pinnedAt ? "is-pinned" : ""} ${isDue(entry.reminderAt) && entry.reminderState !== "completed" ? "is-due" : ""}`}
    >
      <button
        className="entry-main"
        onClick={() => onEdit(entry)}
        aria-label={`Edit ${entry.title || entry.kind}`}
      >
        <div className="entry-meta">
          <span className={`kind-icon kind-${entry.kind}`}>
            {entry.kind === "list" ? (
              <ListChecks size={14} />
            ) : entry.kind === "reminder" ? (
              <Bell size={14} />
            ) : (
              <FileText size={14} />
            )}
            {entry.kind}
          </span>
          {entry.pinnedAt && (
            <span className="pin-label">
              <Pin size={12} /> pinned
            </span>
          )}
          <time>
            {new Intl.DateTimeFormat("en-US", {
              timeZone,
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            }).format(new Date(entry.createdAt))}
          </time>
        </div>
        {entry.title && <h3>{entry.title}</h3>}
        {entry.body && <p className="entry-body">{entry.body}</p>}
        {entry.sourceUrl && (
          <span className="source-link">
            <ExternalLink size={13} />{" "}
            {entry.sourceTitle || sourceLabel(entry.sourceUrl)}
          </span>
        )}
      </button>
      {entry.kind === "list" && (
        <div className="list-preview">
          <div className="list-progress">
            <span
              style={{
                width: `${entry.listItems.length ? (completed / entry.listItems.length) * 100 : 0}%`,
              }}
            />
          </div>
          <span>
            {completed} of {entry.listItems.length}
          </span>
          {entry.listItems.slice(0, 5).map((item) => (
            <button
              key={item.id}
              className={`list-row ${item.completedAt ? "complete" : ""}`}
              onClick={() =>
                change({
                  listItems: entry.listItems.map((current) =>
                    current.id === item.id
                      ? {
                          ...current,
                          completedAt: current.completedAt
                            ? null
                            : new Date().toISOString(),
                        }
                      : current,
                  ),
                })
              }
            >
              {item.completedAt ? (
                <CheckCircle2 size={17} />
              ) : (
                <Circle size={17} />
              )}
              <span>{item.text}</span>
              {item.dueAt && !item.completedAt && (
                <small className={isDue(item.dueAt) ? "due" : ""}>
                  {new Date(item.dueAt).toLocaleDateString([], {
                    timeZone,
                    month: "short",
                    day: "numeric",
                  })}
                </small>
              )}
            </button>
          ))}
        </div>
      )}
      {entry.reminderAt && (
        <div
          className={`reminder-chip ${isDue(entry.reminderAt) ? "due" : ""}`}
        >
          <BellRing size={14} /> {formatDateTime(entry.reminderAt, timeZone)}
          {entry.reminderState === "completed" && " · Done"}
          {entry.recurrenceRule && ` · ${entry.recurrenceRule}`}
        </div>
      )}
      {entry.reviewAt && (
        <div className="review-chip">
          <Sparkles size={13} /> Review{" "}
          {formatDateTime(entry.reviewAt, timeZone)}
        </div>
      )}
      {entry.attachments.length > 0 && (
        <div className="card-attachments">
          {entry.attachments.slice(0, 3).map((attachment) =>
            attachment.mimeType.startsWith("image/") && attachment.url ? (
              <a
                key={attachment.id}
                href={attachment.url}
                target="_blank"
                rel="noreferrer"
                onClick={(event) => event.stopPropagation()}
              >
                <img
                  src={attachment.url}
                  alt={attachment.fileName}
                  loading="lazy"
                />
              </a>
            ) : (
              <a
                key={attachment.id}
                href={attachment.url}
                target="_blank"
                rel="noreferrer"
                onClick={(event) => event.stopPropagation()}
              >
                <FileText size={18} />
                <span>{attachment.fileName}</span>
              </a>
            ),
          )}
        </div>
      )}
      <div className="card-footer">
        <div className="tag-row">
          {entry.tags.map((tag) => (
            <span
              className="tag"
              style={{ "--tag-color": tag.color } as React.CSSProperties}
              key={tag.id}
            >
              #{tag.name}
            </span>
          ))}
        </div>
        {entry.attachments.length > 0 && (
          <span className="attachment-count">
            <Paperclip size={13} /> {entry.attachments.length}
          </span>
        )}
        <details className="card-menu" ref={menuRef}>
          <summary aria-label="Entry actions">
            <MoreHorizontal size={18} />
          </summary>
          <div className="menu-popover">
            {entry.status === "trashed" ? (
              <>
                <button onClick={() => change({ status: "active" })}>
                  <Undo2 size={15} /> Restore
                </button>
                <button
                  className="danger"
                  onClick={async () => {
                    if (menuRef.current) menuRef.current.open = false;
                    await onDeletePermanently(entry);
                  }}
                >
                  <Trash2 size={15} /> Delete permanently
                </button>
              </>
            ) : (
              <>
                <button onClick={() => change({ pinned: !entry.pinnedAt })}>
                  {entry.pinnedAt ? <PinOff size={15} /> : <Pin size={15} />}
                  {entry.pinnedAt ? "Unpin" : "Pin"}
                </button>
                <button
                  onClick={() =>
                    navigator.clipboard.writeText(
                      [entry.title, entry.body, entry.sourceUrl]
                        .filter(Boolean)
                        .join("\n\n"),
                    )
                  }
                >
                  <Clipboard size={15} /> Copy
                </button>
                {entry.status === "archived" ? (
                  <button onClick={() => change({ status: "active" })}>
                    <ArchiveRestore size={15} /> Restore
                  </button>
                ) : (
                  <button onClick={() => change({ status: "archived" })}>
                    <Archive size={15} /> Archive
                  </button>
                )}
                {entry.kind === "reminder" &&
                  entry.reminderState !== "completed" && (
                    <>
                      <button
                        onClick={() => change({ reminderState: "completed" })}
                      >
                        <Check size={15} /> Complete
                      </button>
                      <button
                        onClick={() =>
                          change({
                            reminderAt: new Date(
                              Date.now() + 10 * 60_000,
                            ).toISOString(),
                            reminderState: "pending",
                          })
                        }
                      >
                        <RefreshCw size={15} /> Snooze 10 min
                      </button>
                      <button
                        onClick={() =>
                          change({
                            reminderAt: new Date(
                              Date.now() + 60 * 60_000,
                            ).toISOString(),
                            reminderState: "pending",
                          })
                        }
                      >
                        <RefreshCw size={15} /> Snooze 1 hour
                      </button>
                      <button
                        onClick={() =>
                          change({
                            reminderAt: tomorrowMorning(
                              new Date(),
                              timeZone,
                            ).toISOString(),
                            reminderState: "pending",
                          })
                        }
                      >
                        <RefreshCw size={15} /> Tomorrow at 9
                      </button>
                    </>
                  )}
                <button
                  className="danger"
                  onClick={() => change({ status: "trashed" })}
                >
                  <Trash2 size={15} /> Move to trash
                </button>
              </>
            )}
          </div>
        </details>
      </div>
    </article>
  );
}

function Composer({
  draft,
  timeZone,
  tags,
  templates,
  onClose,
  onSubmit,
  onCreateTag,
  onTemplateSaved,
}: {
  draft: Draft;
  timeZone: string;
  tags: Tag[];
  templates: CaptureTemplate[];
  onClose: () => void;
  onSubmit: (draft: Draft) => Promise<boolean>;
  onCreateTag: (name: string) => Promise<Tag>;
  onTemplateSaved: (template: CaptureTemplate) => void;
}) {
  const [value, setValue] = useState(draft);
  const [saving, setSaving] = useState(false);
  const [tagSearch, setTagSearch] = useState("");
  const [processingFiles, setProcessingFiles] = useState(false);
  const parsedReminder = useMemo(
    () =>
      value.kind === "reminder"
        ? parseReminder(value.reminderText, new Date(), timeZone)
        : null,
    [value.kind, value.reminderText, timeZone],
  );
  useEffect(() => {
    saveDraft({ ...value, files: [] });
  }, [value]);
  useEffect(() => {
    if (value.sourceUrl) return;
    const match = `${value.title}\n${value.body}`.match(
      /https?:\/\/[^\s<>{}"']+/i,
    );
    if (!match) return;
    setValue((current) => ({
      ...current,
      sourceUrl: match[0].replace(/[),.;]+$/, ""),
      sourceTitle: current.sourceTitle || "Pasted link",
    }));
  }, [value.title, value.body, value.sourceUrl]);
  const update = <K extends keyof Draft>(key: K, next: Draft[K]) =>
    setValue((current) => ({ ...current, [key]: next }));
  const addListItem = () =>
    update("listItems", [
      ...value.listItems,
      {
        id: crypto.randomUUID(),
        text: "",
        position: value.listItems.length,
        completedAt: null,
        dueAt: null,
      },
    ]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      if (
        await onSubmit({
          ...value,
          reminderAt:
            value.kind === "reminder"
              ? parsedReminder?.toISOString() || value.reminderAt
              : null,
        })
      )
        clearDraft();
    } finally {
      setSaving(false);
    }
  };
  const hasContent =
    value.title.trim() ||
    value.body.trim() ||
    value.listItems.some((item) => item.text.trim());
  const applyTemplate = (templateId: string) => {
    const template = templates.find((item) => item.id === templateId);
    if (!template) return;
    setValue((current) => ({
      ...current,
      kind: template.kind,
      title: template.title,
      body: template.body,
      reminderText: template.reminderText,
      tagIds: template.tagIds,
      listItems: template.listItems.map((item, position) => ({
        id: crypto.randomUUID(),
        text: item.text,
        dueAt: item.dueAt,
        position,
        completedAt: null,
      })),
    }));
  };
  const handleFiles = async (files: File[]) => {
    setProcessingFiles(true);
    try {
      const prepared: PreparedAttachment[] = [];
      for (const file of files.slice(0, 5))
        prepared.push(await prepareAttachment(file));
      update("files", prepared);
    } finally {
      setProcessingFiles(false);
    }
  };
  const saveCurrentTemplate = async () => {
    const name = prompt(
      "Name this capture template:",
      value.title || "New template",
    );
    if (!name?.trim()) return;
    const template = await saveTemplate({
      name: name.trim(),
      kind: value.kind,
      title: value.title,
      body: value.body,
      listItems: value.listItems
        .filter((item) => item.text.trim())
        .map((item) => ({ text: item.text, dueAt: item.dueAt })),
      tagIds: value.tagIds,
      reminderText: value.reminderText,
    });
    onTemplateSaved(template);
  };
  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        className="composer"
        onSubmit={submit}
        aria-label="Capture entry"
        onKeyDown={(event: ReactKeyboardEvent<HTMLFormElement>) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            event.currentTarget.requestSubmit();
          }
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const files = [...event.dataTransfer.files].filter(
            (file) =>
              file.type.startsWith("image/") || file.type === "application/pdf",
          );
          if (files.length) void handleFiles(files);
        }}
      >
        <header className="composer-header">
          <div>
            <span className="eyebrow">
              {value.editing ? "EDIT ENTRY" : "NEW CAPTURE"}
            </span>
            <h2>
              {value.editing
                ? "Refine what matters"
                : "Get it out of your head"}
            </h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close composer"
          >
            <X />
          </button>
        </header>
        {!value.editing && templates.length > 0 && (
          <label className="field template-picker">
            <span>Start from a template</span>
            <select
              defaultValue=""
              onChange={(event) => applyTemplate(event.target.value)}
            >
              <option value="">Blank capture</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="kind-switch" role="tablist">
          {(["note", "list", "reminder"] as const).map((kind) => (
            <button
              type="button"
              role="tab"
              aria-selected={value.kind === kind}
              className={value.kind === kind ? "active" : ""}
              onClick={() => update("kind", kind)}
              key={kind}
            >
              {kind === "note" ? (
                <FileText size={16} />
              ) : kind === "list" ? (
                <ListChecks size={16} />
              ) : (
                <Bell size={16} />
              )}
              {kind}
            </button>
          ))}
        </div>
        <label className="field">
          <span>
            Title <small>optional</small>
          </span>
          <input
            value={value.title}
            onChange={(event) => update("title", event.target.value)}
            placeholder={
              value.kind === "list"
                ? "Name this list"
                : "Give it a useful label"
            }
            maxLength={500}
          />
        </label>
        {value.kind === "list" ? (
          <div className="list-editor">
            <div className="list-edit-columns" aria-hidden="true">
              <span>Items</span>
              <span>Due</span>
              <span>Actions</span>
            </div>
            {value.listItems.map((item, index) => (
              <div className="list-edit-row" key={item.id}>
                <button
                  type="button"
                  aria-label={
                    item.completedAt ? "Mark incomplete" : "Mark complete"
                  }
                  onClick={() =>
                    update(
                      "listItems",
                      value.listItems.map((current) =>
                        current.id === item.id
                          ? {
                              ...current,
                              completedAt: current.completedAt
                                ? null
                                : new Date().toISOString(),
                            }
                          : current,
                      ),
                    )
                  }
                >
                  {item.completedAt ? <CheckCircle2 /> : <Circle />}
                </button>
                <input
                  autoFocus={index === 0}
                  value={item.text}
                  onChange={(event) =>
                    update(
                      "listItems",
                      value.listItems.map((current) =>
                        current.id === item.id
                          ? { ...current, text: event.target.value }
                          : current,
                      ),
                    )
                  }
                  placeholder={index === 0 ? "First item" : "Next item"}
                />
                <div className="item-due-control">
                  <span className="mobile-due-label">Due</span>
                  <label
                    className={`item-due-button ${item.dueAt ? "has-date" : ""}`}
                  >
                    <CalendarDays size={19} aria-hidden="true" />
                    <span>
                      {item.dueAt
                        ? new Intl.DateTimeFormat("en-US", {
                            timeZone,
                            month: "short",
                            day: "numeric",
                          }).format(new Date(item.dueAt))
                        : "Set date"}
                    </span>
                    <input
                      className="item-due-date"
                      type="date"
                      aria-label={`Due date for ${item.text || `item ${index + 1}`}`}
                      value={
                        item.dueAt
                          ? dateKeyForTimeZone(item.dueAt, timeZone)
                          : ""
                      }
                      onChange={(event) =>
                        update(
                          "listItems",
                          value.listItems.map((current) =>
                            current.id === item.id
                              ? {
                                  ...current,
                                  dueAt: event.target.value
                                    ? dueDateForDateKey(
                                        event.target.value,
                                        timeZone,
                                      ).toISOString()
                                    : null,
                                }
                              : current,
                          ),
                        )
                      }
                    />
                  </label>
                  {item.dueAt && (
                    <button
                      type="button"
                      className="clear-item-due"
                      aria-label={`Clear due date for ${item.text || `item ${index + 1}`}`}
                      onClick={() =>
                        update(
                          "listItems",
                          value.listItems.map((current) =>
                            current.id === item.id
                              ? { ...current, dueAt: null }
                              : current,
                          ),
                        )
                      }
                    >
                      <X size={15} />
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  aria-label="Move item up"
                  disabled={index === 0}
                  onClick={() => {
                    const next = [...value.listItems];
                    [next[index - 1], next[index]] = [
                      next[index],
                      next[index - 1],
                    ];
                    update(
                      "listItems",
                      next.map((current, position) => ({
                        ...current,
                        position,
                      })),
                    );
                  }}
                >
                  <ArrowUp />
                </button>
                <button
                  type="button"
                  aria-label="Move item down"
                  disabled={index === value.listItems.length - 1}
                  onClick={() => {
                    const next = [...value.listItems];
                    [next[index], next[index + 1]] = [
                      next[index + 1],
                      next[index],
                    ];
                    update(
                      "listItems",
                      next.map((current, position) => ({
                        ...current,
                        position,
                      })),
                    );
                  }}
                >
                  <ArrowDown />
                </button>
                <button
                  type="button"
                  aria-label="Remove item"
                  onClick={() =>
                    update(
                      "listItems",
                      value.listItems
                        .filter((current) => current.id !== item.id)
                        .map((current, position) => ({ ...current, position })),
                    )
                  }
                >
                  <X />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="secondary-button add-item"
              onClick={addListItem}
            >
              <Plus size={16} /> Add item
            </button>
          </div>
        ) : (
          <label className="field">
            <span>
              {value.kind === "reminder"
                ? "What should I remind you about?"
                : "Note"}
            </span>
            <textarea
              autoFocus
              value={value.body}
              onChange={(event) => update("body", event.target.value)}
              placeholder={
                value.kind === "reminder"
                  ? "Submit the report"
                  : "Type or paste anything worth keeping…"
              }
              rows={6}
            />
          </label>
        )}
        {value.kind === "reminder" && (
          <div className="reminder-options">
            <label className="field reminder-field">
              <span>When</span>
              <input
                value={value.reminderText}
                onChange={(event) => update("reminderText", event.target.value)}
                placeholder="Tomorrow at 9am"
              />
              {parsedReminder && (
                <small className="parse-preview">
                  <Check size={14} /> {formatDateTime(parsedReminder, timeZone)}{" "}
                  {timeZone.replaceAll("_", " ")}
                  time
                </small>
              )}
            </label>
            <label className="field">
              <span>Repeat</span>
              <select
                value={value.recurrenceRule || ""}
                onChange={(event) =>
                  update(
                    "recurrenceRule",
                    (event.target.value || null) as RecurrenceRule | null,
                  )
                }
              >
                <option value="">Does not repeat</option>
                <option value="daily">Daily</option>
                <option value="weekdays">Weekdays</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </label>
          </div>
        )}
        <label className="field review-date-field">
          <span>
            Resurface for review <small>optional</small>
          </span>
          <input
            type="date"
            value={value.reviewAt?.slice(0, 10) || ""}
            onChange={(event) =>
              update(
                "reviewAt",
                event.target.value
                  ? new Date(
                      `${event.target.value}T09:00:00-07:00`,
                    ).toISOString()
                  : null,
              )
            }
          />
        </label>
        {(value.sourceUrl || value.sourceTitle) && (
          <div className="source-preview">
            <Share2 size={17} />
            <div>
              <strong>{value.sourceTitle || "Shared page"}</strong>
              <span>{value.sourceUrl}</span>
            </div>
          </div>
        )}
        <div className="tag-picker">
          <span className="field-label">Tags</span>
          <div className="inline-tag-create">
            <Hash size={15} />
            <input
              value={tagSearch}
              onChange={(event) => setTagSearch(event.target.value)}
              placeholder="Find or create a tag"
            />
            {tagSearch.trim() &&
              !tags.some(
                (tag) =>
                  tag.name.toLocaleLowerCase() ===
                  tagSearch.replace(/^#/, "").trim().toLocaleLowerCase(),
              ) && (
                <button
                  type="button"
                  onClick={async () => {
                    const tag = await onCreateTag(tagSearch);
                    update("tagIds", [...new Set([...value.tagIds, tag.id])]);
                    setTagSearch("");
                  }}
                >
                  <Plus size={14} /> Create
                </button>
              )}
          </div>
          <div>
            {tags
              .filter((tag) =>
                tag.name
                  .toLocaleLowerCase()
                  .includes(
                    tagSearch.replace(/^#/, "").trim().toLocaleLowerCase(),
                  ),
              )
              .map((tag) => (
                <button
                  type="button"
                  key={tag.id}
                  className={value.tagIds.includes(tag.id) ? "selected" : ""}
                  style={{ "--tag-color": tag.color } as React.CSSProperties}
                  onClick={() =>
                    update(
                      "tagIds",
                      value.tagIds.includes(tag.id)
                        ? value.tagIds.filter((id) => id !== tag.id)
                        : [...value.tagIds, tag.id],
                    )
                  }
                >
                  #{tag.name}
                </button>
              ))}
          </div>
        </div>
        <label className="file-picker">
          <Paperclip size={17} />
          <span>
            {processingFiles
              ? "Preparing files and indexing text…"
              : value.files.length
                ? `${value.files.length} file${value.files.length === 1 ? "" : "s"} ready`
                : "Attach images or PDFs"}
          </span>
          <input
            type="file"
            accept="image/*,application/pdf"
            multiple
            disabled={processingFiles}
            onChange={(event) =>
              void handleFiles([...(event.target.files || [])])
            }
          />
        </label>
        {value.files.length > 0 && (
          <div className="attachment-previews">
            {value.files.map((attachment, index) => (
              <article key={`${attachment.file.name}-${index}`}>
                {attachment.file.type.startsWith("image/") ? (
                  <img src={attachment.previewUrl} alt="" />
                ) : (
                  <FileText aria-hidden="true" />
                )}
                <div>
                  <strong>{attachment.file.name}</strong>
                  <small>{attachment.detail}</small>
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${attachment.file.name}`}
                  onClick={() =>
                    update(
                      "files",
                      value.files.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                >
                  <X size={14} />
                </button>
              </article>
            ))}
          </div>
        )}
        {value.editing?.attachments.length ? (
          <div className="existing-attachments">
            <span className="field-label">Saved attachments</span>
            {value.editing.attachments.map((attachment) => (
              <div key={attachment.id}>
                <a href={attachment.url} target="_blank" rel="noreferrer">
                  <Paperclip size={14} />
                  {attachment.fileName}
                </a>
                <button
                  type="button"
                  aria-label={`Remove ${attachment.fileName}`}
                  onClick={async () => {
                    if (!confirm(`Remove ${attachment.fileName}?`)) return;
                    await deleteAttachment(value.id, attachment.id);
                    update("editing", {
                      ...value.editing!,
                      attachments: value.editing!.attachments.filter(
                        (item) => item.id !== attachment.id,
                      ),
                    });
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <footer className="composer-footer">
          <span className="draft-status">
            <Cloud size={14} /> Draft saved on this device
          </span>
          <div>
            {!value.editing && hasContent && (
              <button
                type="button"
                className="text-button"
                onClick={() => void saveCurrentTemplate()}
              >
                Save as template
              </button>
            )}
            <button
              type="button"
              className="secondary-button"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className="primary-button"
              disabled={!hasContent || saving || processingFiles}
            >
              {saving
                ? "Saving…"
                : value.editing
                  ? "Save changes"
                  : "Save to Mind Boss"}
            </button>
            <kbd className="submit-hint">Ctrl Enter</kbd>
          </div>
        </footer>
      </form>
    </div>
  );
}

function ConflictDialog({
  conflict,
  onKeepMine,
  onUseServer,
  onCopyBoth,
  onCancel,
}: {
  conflict: ConflictState;
  onKeepMine: () => Promise<void>;
  onUseServer: () => void;
  onCopyBoth: () => Promise<void>;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="dialog-backdrop conflict-backdrop" role="presentation">
      <section
        className="conflict-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="conflict-title"
      >
        <span className="eyebrow">VERSION CONFLICT</span>
        <h2 id="conflict-title">This entry changed on another device</h2>
        <p>
          Choose which version to keep. Nothing will be overwritten until you
          decide.
        </p>
        <div className="conflict-compare">
          <article>
            <strong>Your version</strong>
            <h3>{conflict.draft.title || "Untitled"}</h3>
            <p>
              {conflict.draft.body ||
                `${conflict.draft.listItems.length} list items`}
            </p>
          </article>
          <article>
            <strong>Server version</strong>
            <h3>{conflict.server.title || "Untitled"}</h3>
            <p>
              {conflict.server.body ||
                `${conflict.server.listItems.length} list items`}
            </p>
          </article>
        </div>
        <div className="conflict-actions">
          <button
            className="secondary-button"
            disabled={busy}
            onClick={onCancel}
          >
            Decide later
          </button>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={onUseServer}
          >
            Use server version
          </button>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => run(onCopyBoth)}
          >
            Copy both
          </button>
          <button
            className="primary-button"
            disabled={busy}
            onClick={() => run(onKeepMine)}
          >
            {busy ? "Saving…" : "Keep mine"}
          </button>
        </div>
      </section>
    </div>
  );
}

function TagsPanel({
  tags,
  onChange,
  notify,
}: {
  tags: Tag[];
  onChange: (tags: Tag[]) => void;
  notify: (message: string) => void;
}) {
  const [editing, setEditing] = useState<Partial<Tag> & { name: string }>({
    name: "",
    color: "#22d3aa",
    triggers: [],
    parentId: null,
  });
  const [triggerText, setTriggerText] = useState("");
  const save = async (event: FormEvent) => {
    event.preventDefault();
    onChange(
      await saveTag({
        ...editing,
        triggers: triggerText
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      }),
    );
    setEditing({ name: "", color: "#22d3aa", triggers: [], parentId: null });
    setTriggerText("");
    notify("Tag saved.");
  };
  return (
    <section className="utility-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">ORGANIZE LIGHTLY</span>
          <h2>Tags and trigger words</h2>
          <p>
            Trigger words file matching notes automatically. Manual tags always
            stay yours.
          </p>
        </div>
      </div>
      <div className="two-column">
        <form className="settings-card tag-form" onSubmit={save}>
          <h3>{editing.id ? "Edit tag" : "Create a tag"}</h3>
          <label className="field">
            <span>Name</span>
            <div className="prefixed-input">
              <Hash size={16} />
              <input
                value={editing.name}
                onChange={(event) =>
                  setEditing({ ...editing, name: event.target.value })
                }
                placeholder="PROJECT"
                required
              />
            </div>
          </label>
          <label className="field">
            <span>
              Trigger words <small>comma separated</small>
            </span>
            <input
              value={triggerText}
              onChange={(event) => setTriggerText(event.target.value)}
              placeholder="project, initiative"
            />
          </label>
          <label className="field">
            <span>
              Parent tag <small>optional</small>
            </span>
            <select
              value={editing.parentId || ""}
              onChange={(event) =>
                setEditing({ ...editing, parentId: event.target.value || null })
              }
            >
              <option value="">None</option>
              {tags
                .filter((tag) => !tag.parentId && tag.id !== editing.id)
                .map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="color-field">
            <span>Color</span>
            <input
              type="color"
              value={editing.color || "#22d3aa"}
              onChange={(event) =>
                setEditing({ ...editing, color: event.target.value })
              }
            />
          </label>
          <div className="form-actions">
            {editing.id && (
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setEditing({
                    name: "",
                    color: "#22d3aa",
                    triggers: [],
                    parentId: null,
                  });
                  setTriggerText("");
                }}
              >
                Cancel
              </button>
            )}
            <button className="primary-button">
              {editing.id ? "Update tag" : "Create tag"}
            </button>
          </div>
        </form>
        <div className="tag-library">
          {tags.map((tag) => (
            <article key={tag.id} className="tag-card">
              <button
                className="tag-card-main"
                onClick={() => {
                  setEditing({ ...tag });
                  setTriggerText(tag.triggers.join(", "));
                }}
              >
                <span className="tag-dot" style={{ background: tag.color }} />
                <div>
                  <h3>#{tag.name}</h3>
                  <p>
                    {tag.parentId
                      ? `Inside #${tags.find((parent) => parent.id === tag.parentId)?.name || "tag"}`
                      : "Top-level tag"}
                  </p>
                  <div className="trigger-list">
                    {tag.triggers.length ? (
                      tag.triggers.map((trigger) => (
                        <span key={trigger}>{trigger}</span>
                      ))
                    ) : (
                      <span>No trigger words</span>
                    )}
                  </div>
                </div>
                <ChevronRight />
              </button>
              <button
                className="icon-button danger-text"
                aria-label={`Delete ${tag.name}`}
                onClick={async () => {
                  if (confirm(`Delete #${tag.name}? Notes will remain.`)) {
                    await deleteTag(tag.id);
                    onChange(tags.filter((item) => item.id !== tag.id));
                    notify("Tag deleted.");
                  }
                }}
              >
                <Trash2 />
              </button>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

interface ImportState {
  headers: string[];
  rows: string[][];
  mapping: Record<string, string>;
  fileName: string;
}

function Importer({
  onComplete,
  notify,
}: {
  onComplete: () => void;
  notify: (message: string) => void;
}) {
  const [state, setState] = useState<ImportState | null>(null);
  const [busy, setBusy] = useState(false);
  const chooseFile = (file?: File) => {
    if (!file) return;
    Papa.parse<string[]>(file, {
      skipEmptyLines: true,
      complete: (result) => {
        const [headers = [], ...rows] = result.data;
        const lower = headers.map((header) =>
          header.trim().toLocaleLowerCase(),
        );
        const find = (...names: string[]) =>
          headers[
            lower.findIndex((header) =>
              names.some((name) => header.includes(name)),
            )
          ] || "";
        setState({
          fileName: file.name,
          headers,
          rows,
          mapping: {
            title: find("title", "subject"),
            body: find("body", "note", "content", "text"),
            createdAt: find("created", "date", "timestamp"),
            tags: find("tag"),
            kind: find("type", "kind"),
            status: find("status", "archive"),
            pinned: find("pin", "favorite", "favourite"),
            reminderAt: find("reminder", "due"),
          },
        });
      },
    });
  };
  const mappedValue = (row: string[], key: string) =>
    row[state!.headers.indexOf(state!.mapping[key])] || "";
  const startImport = async () => {
    if (!state?.mapping.body && !state?.mapping.title) return;
    setBusy(true);
    try {
      const normalized = state.rows.map((row) => {
        const kindRaw = mappedValue(row, "kind").toLocaleLowerCase();
        const statusRaw = mappedValue(row, "status").toLocaleLowerCase();
        return {
          id: crypto.randomUUID(),
          kind: kindRaw.includes("list")
            ? ("list" as const)
            : kindRaw.includes("remind")
              ? ("reminder" as const)
              : ("note" as const),
          title: mappedValue(row, "title"),
          body: mappedValue(row, "body"),
          source: "mindchuk_import" as const,
          createdAt: mappedValue(row, "createdAt") || undefined,
          reminderAt: mappedValue(row, "reminderAt") || null,
          status: statusRaw.includes("trash")
            ? ("trashed" as const)
            : statusRaw.includes("archiv") || statusRaw === "true"
              ? ("archived" as const)
              : ("active" as const),
          pinned: ["true", "1", "yes", "pinned"].includes(
            mappedValue(row, "pinned").toLocaleLowerCase(),
          ),
          tags: mappedValue(row, "tags")
            .split(/[|,;]/)
            .map((tag) => tag.replace(/^#/, "").trim())
            .filter(Boolean),
        };
      });
      let created = 0,
        skipped = 0,
        failed = 0;
      for (let index = 0; index < normalized.length; index += 100) {
        const result = await importEntries(
          normalized.slice(index, index + 100),
        );
        created += result.created;
        skipped += result.skipped;
        failed += result.errors.length;
      }
      notify(
        `Import complete: ${created} added, ${skipped} already present${failed ? `, ${failed} need review` : ""}.`,
      );
      setState(null);
      onComplete();
    } finally {
      setBusy(false);
    }
  };
  const invalidDates = state
    ? state.rows.filter((row) =>
        ["createdAt", "reminderAt"].some((key) => {
          const value = mappedValue(row, key);
          return Boolean(value && Number.isNaN(Date.parse(value)));
        }),
      ).length
    : 0;
  return (
    <div className="settings-card import-card">
      <div className="settings-icon">
        <Upload />
      </div>
      <div className="settings-copy">
        <h3>Import from MindChuk</h3>
        <p>
          The CSV is parsed on this device. Review the mapping before anything
          is saved.
        </p>
        {!state ? (
          <label className="secondary-button file-action">
            <Upload size={16} /> Choose CSV
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => chooseFile(event.target.files?.[0])}
            />
          </label>
        ) : (
          <div className="import-mapper">
            <div className="import-file">
              <FileText size={16} />
              <strong>{state.fileName}</strong>
              <span>{state.rows.length} rows</span>
            </div>
            <div className="mapping-grid">
              {[
                "title",
                "body",
                "createdAt",
                "tags",
                "kind",
                "status",
                "reminderAt",
                "pinned",
              ].map((key) => (
                <label key={key}>
                  <span>
                    {key === "createdAt"
                      ? "Created date"
                      : key === "reminderAt"
                        ? "Reminder date"
                        : key}
                  </span>
                  <select
                    value={state.mapping[key] || ""}
                    onChange={(event) =>
                      setState({
                        ...state,
                        mapping: {
                          ...state.mapping,
                          [key]: event.target.value,
                        },
                      })
                    }
                  >
                    <option value="">Not mapped</option>
                    {state.headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <div className="import-preview">
              <strong>Preview</strong>
              {state.rows.slice(0, 3).map((row, index) => (
                <p key={index}>
                  {mappedValue(row, "title") ||
                    mappedValue(row, "body") ||
                    "Empty row"}
                </p>
              ))}
              {invalidDates > 0 && (
                <p className="validation-warning">
                  {invalidDates} row{invalidDates === 1 ? " has" : "s have"} a
                  date that needs review and will be reported instead of
                  imported.
                </p>
              )}
            </div>
            <div className="form-actions">
              <button
                className="secondary-button"
                onClick={() => setState(null)}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                disabled={busy || (!state.mapping.body && !state.mapping.title)}
                onClick={startImport}
              >
                {busy ? "Importing…" : "Import reviewed rows"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SettingsPanel({
  session,
  onRefresh,
  notify,
  preferences,
  onPreferencesChange,
  entries,
  tags,
  templates,
  onTemplatesChange,
}: {
  session: Session;
  onRefresh: () => void;
  notify: (message: string) => void;
  preferences: UserPreferences;
  onPreferencesChange: (preferences: UserPreferences) => void;
  entries: Entry[];
  tags: Tag[];
  templates: CaptureTemplate[];
  onTemplatesChange: (templates: CaptureTemplate[]) => void;
}) {
  const [clipToken, setClipToken] = useState("");
  const [backupBusy, setBackupBusy] = useState(false);
  const connectNotifications = async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      notify("This browser does not support push notifications.");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      notify("Notifications remain off. Due reminders will still appear here.");
      return;
    }
    const publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as
      string | undefined;
    if (!publicKey && !isLocalMode) {
      notify("Push keys have not been configured yet.");
      return;
    }
    if (!isLocalMode) {
      const padded = publicKey! + "=".repeat((4 - (publicKey!.length % 4)) % 4);
      const bytes = Uint8Array.from(
        atob(padded.replace(/-/g, "+").replace(/_/g, "/")),
        (char) => char.charCodeAt(0),
      );
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: bytes,
      });
      await subscribeToPush(subscription);
    }
    notify("Push reminders are connected.");
    const next = await savePreferences({
      onboarding: { ...preferences.onboarding, notifications: true },
    });
    onPreferencesChange(next);
  };
  const attachmentBytes = entries.reduce(
    (total, entry) =>
      total + entry.attachments.reduce((size, item) => size + item.size, 0),
    0,
  );
  const updatePreferences = async (next: UserPreferences) => {
    onPreferencesChange(next);
    try {
      onPreferencesChange(await savePreferences(next));
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Could not save settings.",
      );
    }
  };
  return (
    <section className="utility-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">YOUR SYSTEM</span>
          <h2>Settings and ownership</h2>
          <p>
            Keep access tight, connect capture tools, and take your data with
            you anytime.
          </p>
        </div>
      </div>
      <div className="settings-stack">
        <OnboardingChecklist
          preferences={preferences}
          hasTags={tags.length > 0}
          hasEntries={entries.length > 0}
          onChange={(next) => void updatePreferences(next)}
        />
        <PreferencesCard
          preferences={preferences}
          onChange={(next) => void updatePreferences(next)}
        />
        <AppearanceCard
          preferences={preferences}
          onChange={(next) => void updatePreferences(next)}
        />
        <div className="settings-card">
          <div className="settings-icon">
            <BellRing />
          </div>
          <div className="settings-copy">
            <h3>Push reminders</h3>
            <p>
              Receive reminders on this device even when Mind Boss is closed.
            </p>
            <button className="secondary-button" onClick={connectNotifications}>
              Connect this device
            </button>
          </div>
        </div>
        <div className="settings-card">
          <div className="settings-icon">
            <Share2 />
          </div>
          <div className="settings-copy">
            <h3>Chrome clipper</h3>
            <p>
              Create a capture-only token. It can add clips but cannot read or
              change your library.
            </p>
            {clipToken ? (
              <div className="token-reveal">
                <code>{clipToken}</code>
                <button
                  className="icon-button"
                  aria-label="Copy token"
                  onClick={() => {
                    navigator.clipboard.writeText(clipToken);
                    notify("Clipper token copied.");
                  }}
                >
                  <Clipboard />
                </button>
                <small>Shown once. Paste it into the extension.</small>
              </div>
            ) : (
              <button
                className="secondary-button"
                onClick={async () => {
                  setClipToken(await createClipToken());
                  await updatePreferences({
                    ...preferences,
                    onboarding: { ...preferences.onboarding, clipper: true },
                  });
                }}
              >
                Create connection token
              </button>
            )}
          </div>
        </div>
        <SmsCard notify={notify} />
        {templates.length > 0 && (
          <div className="settings-card">
            <div className="settings-icon">
              <Clipboard />
            </div>
            <div className="settings-copy">
              <h3>Capture templates</h3>
              <p>Reusable starting points available from every new capture.</p>
              <div className="template-library">
                {templates.map((template) => (
                  <div key={template.id}>
                    <span>
                      <strong>{template.name}</strong>
                      <small>{template.kind}</small>
                    </span>
                    <button
                      className="icon-button danger-text"
                      aria-label={`Delete ${template.name}`}
                      onClick={async () => {
                        await deleteTemplate(template.id);
                        onTemplatesChange(
                          templates.filter((item) => item.id !== template.id),
                        );
                        notify("Template deleted.");
                      }}
                    >
                      <Trash2 />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        <div className="settings-card">
          <div className="settings-icon">
            <Paperclip />
          </div>
          <div className="settings-copy">
            <h3>Storage</h3>
            <p>
              {entries.reduce(
                (total, entry) => total + entry.attachments.length,
                0,
              )}{" "}
              attachments use approximately{" "}
              {(attachmentBytes / 1024 / 1024).toFixed(1)} MB in the entries
              currently loaded.
            </p>
          </div>
        </div>
        <AiPanel entries={entries} notify={notify} />
        <Importer onComplete={onRefresh} notify={notify} />
        <div className="settings-card">
          <div className="settings-icon">
            <Download />
          </div>
          <div className="settings-copy">
            <h3>Export and backup</h3>
            <p>
              Download portable CSV, structured JSON, or a ZIP containing your
              complete record and attachment files.
            </p>
            <div className="button-row">
              <a
                className="secondary-button"
                href={exportUrl("csv")}
                download="mindboss.csv"
              >
                <Download size={16} /> CSV
              </a>
              <a
                className="secondary-button"
                href={exportUrl("json")}
                download="mindboss.json"
              >
                <Download size={16} /> JSON
              </a>
              <button
                className="secondary-button"
                disabled={backupBusy}
                onClick={async () => {
                  setBackupBusy(true);
                  try {
                    await downloadFullBackup();
                    notify("Full backup downloaded.");
                  } catch (error) {
                    notify(
                      error instanceof Error
                        ? error.message
                        : "Could not create the backup.",
                    );
                  } finally {
                    setBackupBusy(false);
                  }
                }}
              >
                <Download size={16} />{" "}
                {backupBusy ? "Building ZIP…" : "Full backup ZIP"}
              </button>
            </div>
          </div>
        </div>
        <div className="settings-card account-card">
          <div className="avatar">
            <UserAvatar user={session.user} />
          </div>
          <div className="settings-copy">
            <h3>{session.user?.login}</h3>
            <p>
              Authorized through GitHub ·{" "}
              {preferences.displayTimezone.replaceAll("_", " ")}
            </p>
          </div>
          <button
            className="secondary-button"
            onClick={async () => {
              await logout();
              location.reload();
            }}
          >
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </div>
    </section>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [view, setView] = useState<View>(() => {
    const requested = new URLSearchParams(location.search).get("view");
    return requested &&
      [
        "today",
        "inbox",
        "lists",
        "reminders",
        "review",
        "archive",
        "trash",
        "tags",
        "settings",
      ].includes(requested)
      ? (requested as View)
      : "inbox";
  });
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [selectedTag, setSelectedTag] = useState("");
  const [filters, setFilters] = useState<EntryFilters>({});
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [templates, setTemplates] = useState<CaptureTemplate[]>([]);
  const [preferences, setPreferences] = useState<UserPreferences>({
    onboarding: {},
    defaultCaptureKind: "note",
    quietStart: null,
    quietEnd: null,
    weeklyReviewDay: 0,
    viewMode: "feed",
    groupByTime: false,
    compactView: false,
    hideTagNav: false,
    theme: "dark",
    fontFamily: "system",
    displayTimezone: "America/Phoenix",
    boardTagIds: [],
    sortOrder: "newest",
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const noticeTimer = useRef<number>();

  const notify = useCallback((message: string) => {
    setNotice(message);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(""), 4200);
  }, []);

  const updateLayoutPreferences = (changes: Partial<UserPreferences>) => {
    const next = { ...preferences, ...changes };
    setPreferences(next);
    if (changes.sortOrder) setSort(changes.sortOrder);
    void savePreferences(changes)
      .then((saved) => {
        setPreferences(saved);
        setSort(saved.sortOrder);
      })
      .catch((error) =>
        notify(
          error instanceof Error
            ? error.message
            : "Could not save view settings.",
        ),
      );
  };

  useEffect(() => {
    document.documentElement.dataset.theme = preferences.theme;
    document.documentElement.dataset.font = preferences.fontFamily;
  }, [preferences.theme, preferences.fontFamily]);

  const statusForView = (next: View): EntryStatus =>
    next === "archive" ? "archived" : next === "trash" ? "trashed" : "active";
  const refresh = useCallback(
    async (nextView = view, nextQuery = query) => {
      if (["tags", "settings"].includes(nextView)) return;
      setLoading(true);
      setSyncing(true);
      try {
        const kind =
          nextView === "lists"
            ? "list"
            : nextView === "reminders"
              ? "reminder"
              : undefined;
        setEntries(
          await getEntries({
            ...filters,
            ...parseSearchQuery(nextQuery, tags),
            status: statusForView(nextView),
            kind,
            tag: selectedTag || undefined,
            sort,
          }),
        );
        setLastSynced(new Date());
      } catch (error) {
        notify(
          error instanceof Error ? error.message : "Could not load entries.",
        );
      } finally {
        setLoading(false);
        setSyncing(false);
      }
    },
    [view, query, selectedTag, sort, filters, tags, notify],
  );

  useEffect(() => {
    (async () => {
      const nextSession = await getSession();
      setSession(nextSession);
      if (nextSession.authenticated) {
        const [nextTags, nextSearches, nextTemplates, nextPreferences] =
          await Promise.all([
            getTags(),
            getSavedSearches(),
            getTemplates(),
            getPreferences(),
          ]);
        setTags(nextTags);
        setSavedSearches(nextSearches);
        setTemplates(nextTemplates);
        setPreferences(nextPreferences);
        setSort(nextPreferences.sortOrder);
        setPendingCount(await outboxCount().catch(() => 0));
        const targetEntryId = new URLSearchParams(location.search).get("entry");
        if (targetEntryId) {
          const targetEntry = await getEntry(targetEntryId).catch(() => null);
          if (targetEntry) {
            setDraft(
              draftFromEntry(targetEntry, nextPreferences.displayTimezone),
            );
            const url = new URL(location.href);
            url.searchParams.delete("entry");
            history.replaceState({}, "", url);
          }
        }
        const pending = await takePendingShare().catch(() => null);
        if (pending) openSharedCapture(pending);
        else {
          const capture = new URLSearchParams(location.search).get("capture");
          if (capture)
            setDraft(
              freshDraft(
                capture === "list" || capture === "reminder" ? capture : "note",
              ),
            );
        }
      }
      setLoading(false);
    })().catch((error) => {
      notify(
        error instanceof Error ? error.message : "Mind Boss could not start.",
      );
      setLoading(false);
    });
  }, [notify]);

  useEffect(() => {
    if (session?.authenticated) refresh();
  }, [session, view, selectedTag, sort, filters]);
  useEffect(() => {
    if (!session?.authenticated) return;
    const timer = window.setTimeout(() => refresh(view, query), 220);
    return () => window.clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    const entryId = new URLSearchParams(location.search).get("entry");
    const entry = entryId ? entries.find((item) => item.id === entryId) : null;
    if (!entry || draft) return;
    setDraft(draftFromEntry(entry, preferences.displayTimezone));
    const url = new URL(location.href);
    url.searchParams.delete("entry");
    history.replaceState({}, "", url);
  }, [entries, draft, preferences.displayTimezone]);
  useEffect(() => {
    if (!session?.authenticated) return;
    const refreshWhenActive = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const interval = window.setInterval(refreshWhenActive, 60_000);
    window.addEventListener("focus", refreshWhenActive);
    document.addEventListener("visibilitychange", refreshWhenActive);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshWhenActive);
      document.removeEventListener("visibilitychange", refreshWhenActive);
    };
  }, [session, refresh]);
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type !== "mindboss-synced") return;
      void outboxCount().then(setPendingCount);
      void refresh();
    };
    navigator.serviceWorker.addEventListener("message", handleMessage);
    return () =>
      navigator.serviceWorker.removeEventListener("message", handleMessage);
  }, [refresh]);
  useEffect(() => {
    const online = async () => {
      const queued = await drainOutbox().catch(() => []);
      setPendingCount(queued.length);
      setSyncing(queued.length > 0);
      let synchronized = 0;
      for (const item of queued) {
        try {
          const stored =
            "input" in item
              ? (item as { input: EntryInput; files?: PreparedAttachment[] })
              : { input: item as unknown as EntryInput, files: [] };
          let saved = await createEntry(stored.input);
          for (const upload of stored.files || []) {
            const prepared = upload as unknown as PreparedAttachment;
            saved = await addAttachment(
              saved.id,
              prepared.file,
              prepared.extractedText,
            );
          }
          synchronized += 1;
        } catch {
          await saveOutbox(item);
        }
      }
      if (synchronized) {
        notify(
          `${synchronized} offline capture${synchronized === 1 ? "" : "s"} synchronized.`,
        );
        refresh();
      }
      setPendingCount(await outboxCount().catch(() => 0));
      setSyncing(false);
    };
    if (navigator.onLine) void online();
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [notify, refresh]);

  const openSharedCapture = (share: SharedCapture) =>
    setDraft({
      ...freshDraft("note"),
      source: "android_share",
      title: share.title,
      body: share.text,
      sourceUrl: share.url,
      sourceTitle: share.title,
      files: share.files.map((file) => ({
        file,
        extractedText: "",
        detail: "shared file ready",
        previewUrl: URL.createObjectURL(file),
      })),
    });
  const switchView = (next: View) => {
    setView(next);
    setSelectedTag("");
    if (!["inbox", "lists", "reminders"].includes(next)) setFilters({});
    setMobileNav(false);
  };
  const openNew = (kind?: Entry["kind"]) => {
    const saved = loadDraft<Omit<Draft, "files">>();
    setDraft(
      saved && !saved.editing
        ? { ...saved, files: [] }
        : freshDraft(kind || preferences.defaultCaptureKind),
    );
  };

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName || "");
      if (
        !typing &&
        !draft &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        event.key.toLocaleLowerCase() === "n"
      ) {
        event.preventDefault();
        openNew();
      }
      if (event.key === "Escape" && draft && !conflict) setDraft(null);
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [draft, conflict]);

  const saveEntry = async (value: Draft) => {
    const input: EntryInput = {
      id: value.id,
      kind: value.kind,
      title: value.title,
      body: value.body,
      source: value.source,
      sourceUrl: value.sourceUrl || null,
      sourceTitle: value.sourceTitle || null,
      reminderAt: value.reminderAt,
      recurrenceRule: value.recurrenceRule,
      reviewAt: value.reviewAt,
      tagIds: value.tagIds,
      listItems: value.listItems
        .filter((item) => item.text.trim())
        .map((item, position) => ({ ...item, position })),
    };
    try {
      let saved = value.editing
        ? await updateEntry(value.id, {
            ...input,
            version: value.editing.version,
          })
        : await createEntry(input);
      for (const upload of value.files)
        saved = await addAttachment(
          saved.id,
          upload.file,
          upload.extractedText,
        );
      setDraft(null);
      clearDraft();
      notify(value.editing ? "Entry updated." : "Captured.");
      await refresh();
      return true;
    } catch (error) {
      if (!navigator.onLine && !value.editing) {
        await saveOutbox({
          id: input.id,
          input,
          files: value.files,
          queuedAt: new Date().toISOString(),
        });
        setPendingCount(await outboxCount().catch(() => 1));
        setDraft(null);
        clearDraft();
        notify("Saved offline. Mind Boss will sync when you reconnect.");
        return true;
      }
      if (
        error instanceof ApiError &&
        error.code === "entry_conflict" &&
        error.details &&
        typeof error.details === "object" &&
        "server" in error.details
      ) {
        setConflict({
          draft: value,
          input,
          server: (error.details as { server: Entry }).server,
        });
      } else
        notify(
          error instanceof Error ? error.message : "Could not save the entry.",
        );
      return false;
    }
  };

  const finishConflictSave = async (
    action: () => Promise<Entry>,
    message: string,
  ) => {
    if (!conflict) return;
    try {
      let saved = await action();
      for (const upload of conflict.draft.files)
        saved = await addAttachment(
          saved.id,
          upload.file,
          upload.extractedText,
        );
      setConflict(null);
      setDraft(null);
      clearDraft();
      notify(message);
      await refresh();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Could not resolve the conflict.",
      );
    }
  };

  const changeEntry = async (
    entry: Entry,
    changes: Record<string, unknown>,
  ) => {
    try {
      await updateEntry(entry.id, changes);
      await refresh();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Could not update the entry.",
      );
    }
  };

  const permanentlyDelete = async (entry: Entry) => {
    const label = entry.title.trim() || `this ${entry.kind}`;
    if (
      !confirm(
        `Delete "${label}" permanently? This cannot be undone, and any attachments will also be deleted.`,
      )
    )
      return;
    try {
      await deleteEntryPermanently(entry.id, entry.version);
      await refresh();
      notify("Entry permanently deleted.");
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Could not permanently delete the entry.",
      );
    }
  };

  if (!session && loading)
    return (
      <div className="app-loading">
        <Logo />
        <span />
      </div>
    );
  if (!session?.authenticated) return <SignIn />;

  const title =
    view === "today"
      ? "Your day, already gathered"
      : view === "inbox"
        ? "Everything worth keeping"
        : view === "lists"
          ? "Lists that move"
          : view === "reminders"
            ? "Bring it back on time"
            : view === "review"
              ? "Reconnect with what matters"
              : view === "archive"
                ? "The quiet archive"
                : view === "trash"
                  ? "Recently deleted"
                  : view === "tags"
                    ? "Tags"
                    : "Settings";
  const dueCount = entries.filter(
    (entry) =>
      entry.kind === "reminder" &&
      entry.reminderState !== "completed" &&
      isDue(entry.reminderAt),
  ).length;
  const todayEntries =
    view === "today"
      ? entries.filter((entry) => {
          const today = dateKeyForTimeZone(
            new Date(),
            preferences.displayTimezone,
          );
          const due = [
            entry.reminderState === "completed" ? null : entry.reminderAt,
            ...entry.listItems
              .filter((item) => !item.completedAt)
              .map((item) => item.dueAt),
          ].filter(Boolean) as string[];
          return (
            dateKeyForTimeZone(entry.createdAt, preferences.displayTimezone) ===
              today ||
            due.some(
              (value) =>
                dateKeyForTimeZone(value, preferences.displayTimezone) <= today,
            )
          );
        })
      : entries;

  return (
    <div
      className={`app-shell ${preferences.compactView ? "compact-mode" : ""}`}
    >
      <aside className={`sidebar ${mobileNav ? "is-open" : ""}`}>
        <div className="sidebar-top">
          <Logo />
          <button
            className="icon-button mobile-close"
            onClick={() => setMobileNav(false)}
            aria-label="Close navigation"
          >
            <X />
          </button>
        </div>
        <button className="capture-button" onClick={() => openNew()}>
          <Plus size={19} />
          <span>New capture</span>
          <kbd>N</kbd>
        </button>
        <nav aria-label="Mind Boss sections">
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={view === id ? "active" : ""}
              onClick={() => switchView(id)}
            >
              <Icon size={18} />
              <span>{label}</span>
              {id === "reminders" && dueCount > 0 && <b>{dueCount}</b>}
            </button>
          ))}
        </nav>
        {!preferences.hideTagNav && (
          <>
            <div className="sidebar-label">YOUR TAGS</div>
            <div className="sidebar-tags">
              {tags.slice(0, 7).map((tag) => (
                <button
                  key={tag.id}
                  className={selectedTag === tag.id ? "active" : ""}
                  onClick={() => {
                    setSelectedTag(selectedTag === tag.id ? "" : tag.id);
                    setView("inbox");
                    setMobileNav(false);
                  }}
                >
                  <span style={{ background: tag.color }} />#{tag.name}
                </button>
              ))}
            </div>
          </>
        )}
        <div className="sidebar-bottom">
          <button
            className={view === "tags" ? "active" : ""}
            onClick={() => switchView("tags")}
          >
            <TagIcon size={18} />
            Manage tags
          </button>
          <button
            className={view === "settings" ? "active" : ""}
            onClick={() => switchView("settings")}
          >
            <Settings size={18} />
            Settings
          </button>
          <div className="privacy-note">
            <span className={`status-dot ${pendingCount ? "pending" : ""}`} />
            {syncing
              ? "Syncing…"
              : pendingCount
                ? `${pendingCount} waiting to sync`
                : lastSynced
                  ? `Synced ${lastSynced.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                  : "Private · Synced"}
          </div>
        </div>
      </aside>
      {mobileNav && (
        <button
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={() => setMobileNav(false)}
        />
      )}
      <main className="main-shell">
        <header className="topbar">
          <button
            className="icon-button menu-button"
            onClick={() => setMobileNav(true)}
            aria-label="Open navigation"
          >
            <Menu />
          </button>
          <Logo compact />
          <div className="search-wrap">
            <Search size={18} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search, or try tag:work type:note…"
              aria-label="Search entries"
            />
            {query && (
              <button onClick={() => setQuery("")} aria-label="Clear search">
                <X size={16} />
              </button>
            )}
          </div>
          <button
            className="icon-button sync-button"
            aria-label="Refresh and synchronize"
            onClick={() => void refresh()}
          >
            <RefreshCw className={syncing ? "spin" : ""} />
          </button>
          <button
            className="avatar-button"
            onClick={() => switchView("settings")}
            aria-label="Open settings"
          >
            <UserAvatar user={session.user} />
          </button>
        </header>
        <div className="content-shell">
          {view === "tags" ? (
            <TagsPanel tags={tags} onChange={setTags} notify={notify} />
          ) : view === "settings" ? (
            <SettingsPanel
              session={session}
              onRefresh={() => refresh("inbox")}
              notify={notify}
              preferences={preferences}
              onPreferencesChange={setPreferences}
              entries={entries}
              tags={tags}
              templates={templates}
              onTemplatesChange={setTemplates}
            />
          ) : (
            <>
              <section className="page-heading">
                <div>
                  <span className="eyebrow">{view.toLocaleUpperCase()}</span>
                  <h1>{title}</h1>
                  <p>
                    {view === "today"
                      ? "Overdue work, today’s reminders, and fresh captures in one place."
                      : view === "review"
                        ? "Scheduled reviews, older ideas, and notes from this day in years past."
                        : view === "inbox"
                          ? "A private feed for notes, links, lists, and the things your future self will need."
                          : view === "reminders"
                            ? "Due reminders stay visible here even when notifications are off."
                            : view === "trash"
                              ? "Items remain recoverable for 30 days unless you delete them permanently."
                              : "Keep the useful things close without adding more clutter."}
                  </p>
                </div>
                <div className="heading-actions">
                  {view !== "review" && (
                    <ViewControls
                      preferences={preferences}
                      onChange={updateLayoutPreferences}
                    />
                  )}
                  <button
                    className="primary-button"
                    onClick={() =>
                      openNew(
                        view === "lists"
                          ? "list"
                          : view === "reminders"
                            ? "reminder"
                            : "note",
                      )
                    }
                  >
                    <Plus size={17} /> Add
                  </button>
                </div>
              </section>
              {view === "today" && (
                <TodaySummary
                  entries={entries}
                  timeZone={preferences.displayTimezone}
                />
              )}
              {["inbox", "lists", "reminders", "archive", "trash"].includes(
                view,
              ) && (
                <AdvancedSearchPanel
                  filters={{ ...filters, q: query || undefined }}
                  tags={tags}
                  savedSearches={savedSearches}
                  onChange={(next) => {
                    const { q: nextQuery, ...rest } = next;
                    setQuery(nextQuery || "");
                    setFilters(rest);
                  }}
                  onSavedSearchesChange={setSavedSearches}
                />
              )}
              {selectedTag && (
                <div className="active-filter">
                  <TagIcon size={14} /> Showing #
                  {tags.find((tag) => tag.id === selectedTag)?.name}
                  <button onClick={() => setSelectedTag("")}>
                    <X size={14} /> Clear
                  </button>
                </div>
              )}
              {loading ? (
                <div className="feed-loading">
                  {[1, 2, 3].map((item) => (
                    <span key={item} />
                  ))}
                </div>
              ) : view === "review" ? (
                <ReviewQueue
                  entries={entries}
                  timeZone={preferences.displayTimezone}
                  onOpen={(entry) =>
                    setDraft(draftFromEntry(entry, preferences.displayTimezone))
                  }
                  onReviewLater={(entry) =>
                    void changeEntry(entry, {
                      version: entry.version,
                      reviewAt: new Date(
                        Date.now() + 7 * 86_400_000,
                      ).toISOString(),
                    })
                  }
                />
              ) : todayEntries.length ? (
                <EntryLayouts
                  entries={todayEntries}
                  tags={tags}
                  preferences={preferences}
                  onPreferences={updateLayoutPreferences}
                  onOpen={(entry) =>
                    setDraft(draftFromEntry(entry, preferences.displayTimezone))
                  }
                  onMove={(entry, tagId) => {
                    const tagIds = entry.tags
                      .map((tag) => tag.id)
                      .filter((id) => !preferences.boardTagIds.includes(id));
                    if (tagId) tagIds.push(tagId);
                    void changeEntry(entry, {
                      version: entry.version,
                      tagIds,
                    });
                  }}
                  renderEntry={(entry) => (
                    <EntryCard
                      key={entry.id}
                      entry={entry}
                      timeZone={preferences.displayTimezone}
                      onEdit={(item) =>
                        setDraft(
                          draftFromEntry(item, preferences.displayTimezone),
                        )
                      }
                      onChange={changeEntry}
                      onDeletePermanently={permanentlyDelete}
                    />
                  )}
                />
              ) : (
                <EmptyState
                  view={view}
                  onAdd={() =>
                    openNew(
                      view === "lists"
                        ? "list"
                        : view === "reminders"
                          ? "reminder"
                          : "note",
                    )
                  }
                />
              )}
            </>
          )}
        </div>
      </main>
      <nav className="mobile-tabs" aria-label="Mobile navigation">
        {[NAV_ITEMS[0], NAV_ITEMS[1], NAV_ITEMS[3]].map(
          ({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={view === id ? "active" : ""}
              onClick={() => switchView(id)}
            >
              <Icon />
              <span>{label}</span>
            </button>
          ),
        )}
        <button
          className="mobile-add"
          onClick={() => openNew()}
          aria-label="New capture"
        >
          <Plus />
        </button>
        <button
          className={view === "settings" ? "active" : ""}
          onClick={() => switchView("settings")}
        >
          <Settings />
          <span>Settings</span>
        </button>
      </nav>
      {draft && (
        <Composer
          draft={draft}
          timeZone={preferences.displayTimezone}
          tags={tags}
          templates={templates}
          onClose={() => setDraft(null)}
          onSubmit={saveEntry}
          onCreateTag={async (name) => {
            const next = await saveTag({ name });
            setTags(next);
            const created = next.find(
              (tag) =>
                tag.name.toLocaleLowerCase() ===
                name.replace(/^#/, "").trim().toLocaleLowerCase(),
            );
            if (!created) throw new Error("Could not create that tag.");
            notify(`Created #${created.name}.`);
            return created;
          }}
          onTemplateSaved={(template) => {
            setTemplates((current) => [
              template,
              ...current.filter((item) => item.id !== template.id),
            ]);
            notify("Capture template saved.");
          }}
        />
      )}
      {conflict && (
        <ConflictDialog
          conflict={conflict}
          onCancel={() => setConflict(null)}
          onUseServer={() => {
            setDraft(
              draftFromEntry(conflict.server, preferences.displayTimezone),
            );
            setConflict(null);
            notify("Loaded the server version.");
          }}
          onCopyBoth={() =>
            finishConflictSave(
              () => createEntry({ ...conflict.input, id: crypto.randomUUID() }),
              "Both versions were kept.",
            )
          }
          onKeepMine={() =>
            finishConflictSave(
              () =>
                updateEntry(conflict.server.id, {
                  ...conflict.input,
                  version: conflict.server.version,
                }),
              "Your version replaced the server version.",
            )
          }
        />
      )}
      {notice && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {notice}
        </div>
      )}
      {!navigator.onLine && (
        <div className="offline-banner">
          <WifiOff size={15} /> Offline. New captures will sync later.
        </div>
      )}
    </div>
  );
}
