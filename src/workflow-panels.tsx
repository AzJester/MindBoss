import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Brain,
  CalendarClock,
  Check,
  ChevronRight,
  Clock3,
  Globe2,
  MessageSquareText,
  Save,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  SunMoon,
  Trash2,
  Type,
} from "lucide-react";
import { SUPPORTED_TIMEZONES } from "../shared/types";
import type {
  Entry,
  EntryFilters,
  SavedSearch,
  Tag,
  UserPreferences,
} from "../shared/types";
import {
  deleteSavedSearch,
  getAiStatus,
  getSmsStatus,
  runAi,
  saveSavedSearch,
  type AiStatus,
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

export function ReviewQueue({
  entries,
  timeZone,
  onOpen,
  onReviewLater,
}: {
  entries: Entry[];
  timeZone: string;
  onOpen: (entry: Entry) => void;
  onReviewLater: (entry: Entry) => void;
}) {
  const now = new Date();
  const sameDay = (value: string) => {
    const date = new Date(value);
    return (
      date.getFullYear() < now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate()
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
                ? `Review was set for ${formatDateTime(entry.reviewAt, timeZone)}`
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

export function PreferencesCard({
  preferences,
  onChange,
}: {
  preferences: UserPreferences;
  onChange: (preferences: UserPreferences) => void;
}) {
  const [draft, setDraft] = useState(preferences),
    [error, setError] = useState("");
  useEffect(() => setDraft(preferences), [preferences]);
  const save = () => {
    if (
      Boolean(draft.quietStart) !== Boolean(draft.quietEnd) ||
      (draft.quietStart && draft.quietStart === draft.quietEnd)
    ) {
      setError(
        "Set both a start and end time, with different times, or clear both.",
      );
      return;
    }
    setError("");
    onChange(draft);
  };
  return (
    <section className="settings-card">
      <div className="settings-copy">
        <h3>Capture and reminder defaults</h3>
        <div className="preference-grid">
          <label className="field">
            <span>Default capture</span>
            <select
              value={draft.defaultCaptureKind}
              onChange={(event) =>
                setDraft({
                  ...draft,
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
              value={draft.quietStart || ""}
              onChange={(event) =>
                setDraft({ ...draft, quietStart: event.target.value || null })
              }
            />
          </label>
          <label className="field">
            <span>Quiet hours end</span>
            <input
              type="time"
              value={draft.quietEnd || ""}
              onChange={(event) =>
                setDraft({ ...draft, quietEnd: event.target.value || null })
              }
            />
          </label>
          <label className="field">
            <span>Weekly review day</span>
            <select
              value={draft.weeklyReviewDay}
              onChange={(event) =>
                setDraft({
                  ...draft,
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
        <p className="helper-text">
          Quiet hours defer push notifications. Due reminders remain visible.
          Weekly review adds an in-app prompt on your chosen day.
        </p>
        {error && <p role="alert">{error}</p>}
        <div className="button-row">
          <button className="primary-button" onClick={save}>
            Save defaults
          </button>
          <button
            className="secondary-button"
            onClick={() =>
              setDraft({ ...draft, quietStart: null, quietEnd: null })
            }
          >
            Clear quiet hours
          </button>
        </div>
      </div>
    </section>
  );
}

export function AppearanceCard({
  preferences,
  onChange,
}: {
  preferences: UserPreferences;
  onChange: (preferences: UserPreferences) => void;
}) {
  const update = <K extends keyof UserPreferences>(
    key: K,
    value: UserPreferences[K],
  ) => onChange({ ...preferences, [key]: value });
  return (
    <div className="settings-card appearance-card">
      <div className="settings-icon">
        <SunMoon />
      </div>
      <div className="settings-copy">
        <h3>Appearance and local time</h3>
        <p>
          These choices follow your Mind Boss account on every signed-in device.
        </p>
        <div className="appearance-setting">
          <div>
            <SunMoon size={18} />
            <span>
              <strong>Color theme</strong>
              <small>Use a dark, light, or device-matched interface.</small>
            </span>
          </div>
          <div className="choice-row" role="group" aria-label="Color theme">
            {(["dark", "light", "system"] as const).map((theme) => (
              <button
                key={theme}
                className={preferences.theme === theme ? "active" : ""}
                aria-pressed={preferences.theme === theme}
                onClick={() => update("theme", theme)}
              >
                {theme}
              </button>
            ))}
          </div>
        </div>
        <div className="appearance-setting">
          <div>
            <Type size={18} />
            <span>
              <strong>Dashboard font</strong>
              <small>Choose the reading style that feels best to you.</small>
            </span>
          </div>
          <div
            className="font-choice-row"
            role="group"
            aria-label="Dashboard font"
          >
            {(["system", "modern", "classic"] as const).map((font) => (
              <button
                key={font}
                className={`${font} ${preferences.fontFamily === font ? "active" : ""}`}
                aria-pressed={preferences.fontFamily === font}
                onClick={() => update("fontFamily", font)}
              >
                <span>Aa Bb 123</span>
                <small>{font}</small>
              </button>
            ))}
          </div>
        </div>
        <label className="appearance-setting timezone-setting">
          <div>
            <Globe2 size={18} />
            <span>
              <strong>Time zone</strong>
              <small>
                Controls calendars, reminder parsing, and quiet hours.
              </small>
            </span>
          </div>
          <select
            value={preferences.displayTimezone}
            onChange={(event) =>
              update(
                "displayTimezone",
                event.target.value as UserPreferences["displayTimezone"],
              )
            }
            aria-label="Time zone"
          >
            {SUPPORTED_TIMEZONES.map((timeZone) => (
              <option key={timeZone} value={timeZone}>
                {timeZone.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
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
