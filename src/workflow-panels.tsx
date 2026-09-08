import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Brain,
  CalendarClock,
  Check,
  ChevronRight,
  Clock3,
  KeyRound,
  MessageSquareText,
  Save,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
} from "lucide-react";
import type {
  Entry,
  EntryFilters,
  SavedSearch,
  Tag,
  UserPreferences,
} from "../shared/types";
import {
  deleteSavedSearch,
  getSmsStatus,
  runAi,
  saveSavedSearch,
  type SmsStatus,
} from "./api";
import { formatDateTime } from "./reminders";

export function AdvancedSearchPanel({
  filters,
  tags,
  savedSearches,
  onChange,
  onSavedSearchesChange,
}: {
  filters: EntryFilters;
  tags: Tag[];
  savedSearches: SavedSearch[];
  onChange: (filters: EntryFilters) => void;
  onSavedSearchesChange: (searches: SavedSearch[]) => void;
}) {
  const [name, setName] = useState("");
  const set = <K extends keyof EntryFilters>(key: K, value: EntryFilters[K]) =>
    onChange({ ...filters, [key]: value || undefined });
  const activeCount = Object.values(filters).filter(Boolean).length;
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    const saved = await saveSavedSearch(name, filters);
    onSavedSearchesChange([
      saved,
      ...savedSearches.filter((item) => item.id !== saved.id),
    ]);
    setName("");
  };
  return (
    <details className="advanced-search" open={activeCount > 1 || undefined}>
      <summary>
        <SlidersHorizontal size={16} /> Advanced search
        {activeCount > 0 && <b>{activeCount}</b>}
      </summary>
      <div className="advanced-search-body">
        {savedSearches.length > 0 && (
          <div className="saved-search-row">
            {savedSearches.map((saved) => (
              <span key={saved.id}>
                <button onClick={() => onChange(saved.query)}>
                  <Search size={13} /> {saved.name}
                </button>
                <button
                  aria-label={`Delete ${saved.name}`}
                  onClick={async () => {
                    await deleteSavedSearch(saved.id);
                    onSavedSearchesChange(
                      savedSearches.filter((item) => item.id !== saved.id),
                    );
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="filter-grid">
          <label>
            Type
            <select
              aria-label="Filter by entry type"
              value={filters.kind || ""}
              onChange={(event) =>
                set("kind", event.target.value as EntryFilters["kind"])
              }
            >
              <option value="">Any type</option>
              <option value="note">Notes</option>
              <option value="list">Lists</option>
              <option value="reminder">Reminders</option>
            </select>
          </label>
          <label>
            Tag
            <select
              value={filters.tag || ""}
              onChange={(event) => set("tag", event.target.value)}
            >
              <option value="">Any tag</option>
              {tags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  #{tag.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            From
            <input
              type="date"
              value={filters.from || ""}
              onChange={(event) => set("from", event.target.value)}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={filters.to || ""}
              onChange={(event) => set("to", event.target.value)}
            />
          </label>
          <label>
            Due
            <select
              value={filters.due || ""}
              onChange={(event) =>
                set("due", event.target.value as EntryFilters["due"])
              }
            >
              <option value="">Any time</option>
              <option value="overdue">Overdue</option>
              <option value="today">Today</option>
              <option value="upcoming">Upcoming</option>
            </select>
          </label>
          <label>
            State
            <select
              value={filters.reminderState || ""}
              onChange={(event) =>
                set(
                  "reminderState",
                  event.target.value as EntryFilters["reminderState"],
                )
              }
            >
              <option value="">Any state</option>
              <option value="pending">Pending</option>
              <option value="delivered">Delivered</option>
              <option value="completed">Completed</option>
            </select>
          </label>
        </div>
        <div className="filter-checks">
          <label>
            <input
              type="checkbox"
              checked={Boolean(filters.pinned)}
              onChange={(event) => set("pinned", event.target.checked)}
            />
            Pinned only
          </label>
          <label>
            <input
              type="checkbox"
              checked={Boolean(filters.hasAttachments)}
              onChange={(event) => set("hasAttachments", event.target.checked)}
            />
            Has attachments
          </label>
          <button className="text-button" onClick={() => onChange({})}>
            Clear all
          </button>
        </div>
        <form className="save-search-form" onSubmit={save}>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Name this search"
            aria-label="Saved search name"
          />
          <button className="secondary-button" disabled={!name.trim()}>
            <Save size={15} /> Save search
          </button>
        </form>
      </div>
    </details>
  );
}

export function TodaySummary({ entries }: { entries: Entry[] }) {
  const summary = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const dueValues = (entry: Entry) =>
      [
        entry.reminderAt,
        ...entry.listItems
          .filter((item) => !item.completedAt)
          .map((item) => item.dueAt),
      ].filter(Boolean) as string[];
    return {
      overdue: entries.filter((entry) =>
        dueValues(entry).some((value) => new Date(value) < start),
      ).length,
      today: entries.filter((entry) =>
        dueValues(entry).some((value) => {
          const date = new Date(value);
          return date >= start && date < end;
        }),
      ).length,
      captured: entries.filter((entry) => {
        const date = new Date(entry.createdAt);
        return date >= start && date < end;
      }).length,
    };
  }, [entries]);
  return (
    <div className="today-summary">
      <div>
        <strong>{summary.overdue}</strong>
        <span>Overdue</span>
      </div>
      <div>
        <strong>{summary.today}</strong>
        <span>Due today</span>
      </div>
      <div>
        <strong>{summary.captured}</strong>
        <span>Captured today</span>
      </div>
    </div>
  );
}

export function ReviewQueue({
  entries,
  onOpen,
  onReviewLater,
}: {
  entries: Entry[];
  onOpen: (entry: Entry) => void;
  onReviewLater: (entry: Entry) => void;
}) {
  const now = new Date();
  const sameDay = (value: string) => {
    const date = new Date(value);
    return (
      date.getMonth() === now.getMonth() && date.getDate() === now.getDate()
    );
  };
  const queue = useMemo(() => {
    const due = entries.filter(
      (entry) => entry.reviewAt && new Date(entry.reviewAt) <= now,
    );
    const stale = entries.filter(
      (entry) =>
        !due.includes(entry) &&
        new Date(entry.lastViewedAt || entry.updatedAt).getTime() <
          Date.now() - 30 * 86_400_000,
    );
    const onThisDay = entries.filter(
      (entry) =>
        !due.includes(entry) &&
        !stale.includes(entry) &&
        sameDay(entry.createdAt),
    );
    return [...due, ...stale, ...onThisDay].slice(0, 12);
  }, [entries]);
  if (!queue.length)
    return (
      <div className="empty-state compact-empty">
        <Sparkles size={24} />
        <h2>Your review queue is clear</h2>
        <p>Set a review date on any entry to make it resurface here.</p>
      </div>
    );
  return (
    <section className="review-queue">
      {queue.map((entry) => (
        <article key={entry.id}>
          <button onClick={() => onOpen(entry)}>
            <span>
              {entry.reviewAt
                ? "SCHEDULED REVIEW"
                : sameDay(entry.createdAt)
                  ? "ON THIS DAY"
                  : "WORTH REVISITING"}
            </span>
            <h3>
              {entry.title || entry.body.slice(0, 80) || "Untitled entry"}
            </h3>
            <p>{entry.body.slice(0, 180)}</p>
            <small>
              {entry.reviewAt
                ? `Review was set for ${formatDateTime(entry.reviewAt)}`
                : `Last touched ${new Date(entry.updatedAt).toLocaleDateString()}`}
            </small>
          </button>
          <button
            className="secondary-button"
            onClick={() => onReviewLater(entry)}
          >
            <CalendarClock size={15} /> Review next week
          </button>
        </article>
      ))}
    </section>
  );
}

export function AiPanel({
  entries,
  notify,
}: {
  entries: Entry[];
  notify: (message: string) => void;
}) {
  const [apiKey, setApiKey] = useState(
    () => sessionStorage.getItem("mindboss.ai.key") || "",
  );
  const [model, setModel] = useState("gpt-5.4-mini");
  const [action, setAction] =
    useState<Parameters<typeof runAi>[0]["action"]>("weekly_review");
  const [request, setRequest] = useState("");
  const [consent, setConsent] = useState(false);
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  const selected = entries.slice(0, 40);
  const inputChars = selected.reduce(
    (total, entry) => total + entry.title.length + entry.body.length,
    0,
  );
  const submit = async () => {
    if (!consent) return notify("Review and approve the data preview first.");
    sessionStorage.setItem("mindboss.ai.key", apiKey);
    setBusy(true);
    try {
      const response = await runAi({
        apiKey,
        model,
        action,
        request,
        entries: selected.map((entry) => ({
          title: entry.title,
          body: entry.body,
          tags: entry.tags.map((tag) => tag.name),
        })),
      });
      setResult(response.text);
    } catch (error) {
      notify(error instanceof Error ? error.message : "AI request failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="settings-card ai-card">
      <div className="settings-icon">
        <Brain />
      </div>
      <div className="settings-copy">
        <h3>
          Private AI workspace <small>optional</small>
        </h3>
        <p>
          Your key stays in this browser session. Mind Boss sends only the
          entries shown in the preview and asks OpenAI not to store the
          response.
        </p>
        <div className="ai-grid">
          <label className="field">
            <span>OpenAI API key</span>
            <div className="prefixed-input">
              <KeyRound size={16} />
              <input
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="sk-…"
                autoComplete="off"
              />
            </div>
          </label>
          <label className="field">
            <span>Action</span>
            <select
              value={action}
              onChange={(event) =>
                setAction(event.target.value as typeof action)
              }
            >
              <option value="weekly_review">Build weekly review</option>
              <option value="summarize">Summarize</option>
              <option value="ask">Answer a question</option>
              <option value="suggest_tags">Suggest tags</option>
              <option value="extract_actions">Extract actions</option>
              <option value="find_duplicates">Find possible duplicates</option>
            </select>
          </label>
          <label className="field">
            <span>Model</span>
            <input
              value={model}
              onChange={(event) => setModel(event.target.value)}
            />
          </label>
          <label className="field">
            <span>
              Your instruction <small>optional</small>
            </span>
            <input
              value={request}
              onChange={(event) => setRequest(event.target.value)}
              placeholder="Focus on decisions I need to make"
            />
          </label>
        </div>
        <details className="data-preview">
          <summary>
            <ShieldCheck size={15} /> Data preview: {selected.length} entries,{" "}
            {inputChars.toLocaleString()} characters
          </summary>
          <ul>
            {selected.slice(0, 8).map((entry) => (
              <li key={entry.id}>
                {entry.title || entry.body.slice(0, 70) || "Untitled entry"}
              </li>
            ))}
          </ul>
        </details>
        <label className="consent-row">
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
          />{" "}
          Send this preview to OpenAI for this request
        </label>
        <button
          className="secondary-button"
          disabled={busy || !apiKey || !selected.length}
          onClick={submit}
        >
          <Sparkles size={16} /> {busy ? "Working…" : "Run AI tool"}
        </button>
        {result && (
          <div className="ai-result">
            <strong>Result</strong>
            <pre>{result}</pre>
          </div>
        )}
      </div>
    </div>
  );
}

export function PreferencesCard({
  preferences,
  onChange,
}: {
  preferences: UserPreferences;
  onChange: (preferences: UserPreferences) => void;
}) {
  return (
    <div className="settings-card">
      <div className="settings-icon">
        <Clock3 />
      </div>
      <div className="settings-copy">
        <h3>Capture and reminder defaults</h3>
        <div className="preference-grid">
          <label className="field">
            <span>Default capture</span>
            <select
              value={preferences.defaultCaptureKind}
              onChange={(event) =>
                onChange({
                  ...preferences,
                  defaultCaptureKind: event.target
                    .value as UserPreferences["defaultCaptureKind"],
                })
              }
            >
              <option value="note">Note</option>
              <option value="list">List</option>
              <option value="reminder">Reminder</option>
            </select>
          </label>
          <label className="field">
            <span>Quiet hours start</span>
            <input
              type="time"
              value={preferences.quietStart || ""}
              onChange={(event) =>
                onChange({
                  ...preferences,
                  quietStart: event.target.value || null,
                })
              }
            />
          </label>
          <label className="field">
            <span>Quiet hours end</span>
            <input
              type="time"
              value={preferences.quietEnd || ""}
              onChange={(event) =>
                onChange({
                  ...preferences,
                  quietEnd: event.target.value || null,
                })
              }
            />
          </label>
          <label className="field">
            <span>Weekly review day</span>
            <select
              value={preferences.weeklyReviewDay}
              onChange={(event) =>
                onChange({
                  ...preferences,
                  weeklyReviewDay: Number(event.target.value),
                })
              }
            >
              {[
                "Sunday",
                "Monday",
                "Tuesday",
                "Wednesday",
                "Thursday",
                "Friday",
                "Saturday",
              ].map((day, index) => (
                <option key={day} value={index}>
                  {day}
                </option>
              ))}
            </select>
          </label>
        </div>
        <small>
          Changes save automatically. Quiet hours delay push delivery, never the
          reminder itself.
        </small>
      </div>
    </div>
  );
}

export function SmsCard({ notify }: { notify: (message: string) => void }) {
  const [status, setStatus] = useState<SmsStatus | null>(null);
  useEffect(() => {
    void getSmsStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);
  return (
    <div className="settings-card">
      <div className="settings-icon">
        <MessageSquareText />
      </div>
      <div className="settings-copy">
        <h3>SMS capture</h3>
        {status?.configured ? (
          <>
            <p>
              Text <strong>{status.phoneNumber}</strong>. Only your authorized
              mobile number is accepted.
            </p>
            <div className="keyword-examples">
              <code>NOTE Remember the client decision #WORK</code>
              <code>LIST Milk; batteries; stamps #ERRANDS</code>
              <code>REMIND tomorrow 9am | Submit the report</code>
            </div>
          </>
        ) : (
          <>
            <p>
              The secure Twilio webhook is built but no phone number is
              connected yet. Add the three Cloudflare secrets to activate it.
            </p>
            <div className="keyword-examples">
              <code>TWILIO_AUTH_TOKEN</code>
              <code>SMS_ALLOWED_FROM</code>
              <code>SMS_PHONE_NUMBER</code>
            </div>
          </>
        )}
        {status?.webhookUrl && (
          <button
            className="secondary-button"
            onClick={() => {
              void navigator.clipboard.writeText(status.webhookUrl);
              notify("SMS webhook URL copied.");
            }}
          >
            <Save size={15} /> Copy webhook URL
          </button>
        )}
      </div>
    </div>
  );
}

export function OnboardingChecklist({
  preferences,
  hasTags,
  hasEntries,
  onChange,
}: {
  preferences: UserPreferences;
  hasTags: boolean;
  hasEntries: boolean;
  onChange: (preferences: UserPreferences) => void;
}) {
  const items = [
    ["capture", "Create your first capture", hasEntries],
    ["tags", "Create a tag or trigger word", hasTags],
    [
      "install",
      "Install the Android PWA",
      Boolean(preferences.onboarding.install),
    ],
    [
      "clipper",
      "Connect the Chrome clipper",
      Boolean(preferences.onboarding.clipper),
    ],
    [
      "notifications",
      "Connect push reminders",
      Boolean(preferences.onboarding.notifications),
    ],
  ] as const;
  const complete = items.filter(([, , done]) => done).length;
  if (complete === items.length && preferences.onboarding.dismissed)
    return null;
  return (
    <div className="onboarding-card">
      <div>
        <span className="eyebrow">GET THE MOST FROM MIND BOSS</span>
        <h3>
          {complete} of {items.length} ready
        </h3>
      </div>
      <div className="onboarding-progress">
        <span style={{ width: `${(complete / items.length) * 100}%` }} />
      </div>
      <ul>
        {items.map(([id, label, automatic]) => {
          const done = automatic || Boolean(preferences.onboarding[id]);
          return (
            <li key={id}>
              <button
                onClick={() =>
                  onChange({
                    ...preferences,
                    onboarding: { ...preferences.onboarding, [id]: !done },
                  })
                }
              >
                {done ? <Check /> : <ChevronRight />}
                <span>{label}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {complete === items.length && (
        <button
          className="text-button"
          onClick={() =>
            onChange({
              ...preferences,
              onboarding: { ...preferences.onboarding, dismissed: true },
            })
          }
        >
          Dismiss checklist
        </button>
      )}
    </div>
  );
}
