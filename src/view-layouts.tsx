import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Columns3,
  LayoutGrid,
  Rows3,
  SlidersHorizontal,
  StretchHorizontal,
} from "lucide-react";
import type { Entry, LayoutMode, Tag, UserPreferences } from "../shared/types";
import { dateKeyForTimeZone } from "./reminders";

const LAYOUTS: Array<{
  id: LayoutMode;
  label: string;
  icon: typeof Rows3;
}> = [
  { id: "feed", label: "Feed", icon: Rows3 },
  { id: "board", label: "Board", icon: Columns3 },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "flex", label: "Flex", icon: StretchHorizontal },
];

function relativeGroup(value: string, timeZone: string): string {
  const today = dateKeyForTimeZone(new Date(), timeZone);
  const yesterday = dateKeyForTimeZone(
    new Date(Date.now() - 86_400_000),
    timeZone,
  );
  const key = dateKeyForTimeZone(value, timeZone);
  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";
  if (new Date(value).getTime() >= Date.now() - 7 * 86_400_000)
    return "Last 7 days";
  if (new Date(value).getTime() >= Date.now() - 30 * 86_400_000)
    return "Last 30 days";
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "long",
    year: "numeric",
  }).format(new Date(value));
}

export function ViewControls({
  preferences,
  onChange,
}: {
  preferences: UserPreferences;
  onChange: (changes: Partial<UserPreferences>) => void;
}) {
  return (
    <div className="view-controls">
      <div className="layout-switcher" aria-label="Entry layout">
        {LAYOUTS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={preferences.viewMode === id ? "active" : ""}
            onClick={() => onChange({ viewMode: id })}
            aria-pressed={preferences.viewMode === id}
          >
            <Icon size={15} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <details className="view-options">
        <summary aria-label="View options">
          <SlidersHorizontal size={17} />
          <span>Options</span>
        </summary>
        <div className="view-options-popover">
          <strong>View options</strong>
          <label>
            <span>Group by time frame</span>
            <input
              type="checkbox"
              checked={preferences.groupByTime}
              onChange={(event) =>
                onChange({ groupByTime: event.target.checked })
              }
            />
          </label>
          <label>
            <span>Compact cards</span>
            <input
              type="checkbox"
              checked={preferences.compactView}
              onChange={(event) =>
                onChange({ compactView: event.target.checked })
              }
            />
          </label>
          <label>
            <span>Oldest first</span>
            <input
              type="checkbox"
              checked={preferences.sortOrder === "oldest"}
              onChange={(event) =>
                onChange({
                  sortOrder: event.target.checked ? "oldest" : "newest",
                })
              }
            />
          </label>
          <label>
            <span>Hide tag navigation</span>
            <input
              type="checkbox"
              checked={preferences.hideTagNav}
              onChange={(event) =>
                onChange({ hideTagNav: event.target.checked })
              }
            />
          </label>
          <label>
            <span>Light mode</span>
            <input
              type="checkbox"
              checked={preferences.theme === "light"}
              onChange={(event) =>
                onChange({ theme: event.target.checked ? "light" : "dark" })
              }
            />
          </label>
        </div>
      </details>
    </div>
  );
}

function TimeGroupedFeed({
  entries,
  timeZone,
  renderEntry,
  className = "entry-grid",
}: {
  entries: Entry[];
  timeZone: string;
  renderEntry: (entry: Entry) => ReactNode;
  className?: string;
}) {
  const groups = useMemo(() => {
    const result = new Map<string, Entry[]>();
    for (const entry of entries) {
      const group = relativeGroup(entry.createdAt, timeZone);
      result.set(group, [...(result.get(group) || []), entry]);
    }
    return [...result.entries()];
  }, [entries, timeZone]);
  return (
    <div className="time-groups">
      {groups.map(([label, items]) => (
        <section key={label} className="time-group">
          <header>
            <span>{label}</span>
            <b>{items.length}</b>
          </header>
          <div className={className}>{items.map(renderEntry)}</div>
        </section>
      ))}
    </div>
  );
}

function BoardSetup({
  tags,
  selected,
  onSave,
}: {
  tags: Tag[];
  selected: string[];
  onSave: (ids: string[]) => void;
}) {
  const [draft, setDraft] = useState(selected);
  useEffect(() => setDraft(selected), [selected]);
  const minimum = Math.min(2, tags.length);
  return (
    <section className="board-setup">
      <LayoutGrid size={25} />
      <span className="eyebrow">SET UP YOUR BOARD</span>
      <h2>Turn your tags into working columns</h2>
      <p>
        Choose two to five tags. Untagged entries always have their own column.
      </p>
      {tags.length ? (
        <div className="board-tag-picker">
          {tags.map((tag) => (
            <button
              key={tag.id}
              className={draft.includes(tag.id) ? "active" : ""}
              onClick={() =>
                setDraft((current) =>
                  current.includes(tag.id)
                    ? current.filter((id) => id !== tag.id)
                    : current.length < 5
                      ? [...current, tag.id]
                      : current,
                )
              }
            >
              <span style={{ background: tag.color }} />#{tag.name}
            </button>
          ))}
        </div>
      ) : (
        <p>Create at least one tag first, then return to Board view.</p>
      )}
      <button
        className="primary-button"
        disabled={!tags.length || draft.length < minimum}
        onClick={() => onSave(draft)}
      >
        Save board columns
      </button>
    </section>
  );
}

function BoardView({
  entries,
  tags,
  preferences,
  renderEntry,
  onMove,
  onPreferences,
}: {
  entries: Entry[];
  tags: Tag[];
  preferences: UserPreferences;
  renderEntry: (entry: Entry) => ReactNode;
  onMove: (entry: Entry, tagId: string | null) => void;
  onPreferences: (changes: Partial<UserPreferences>) => void;
}) {
  const selected = preferences.boardTagIds.filter((id) =>
    tags.some((tag) => tag.id === id),
  );
  const [configuring, setConfiguring] = useState(false);
  if (!selected.length || configuring)
    return (
      <BoardSetup
        tags={tags}
        selected={selected}
        onSave={(ids) => {
          onPreferences({ boardTagIds: ids });
          setConfiguring(false);
        }}
      />
    );
  const columns: Array<{ id: string | null; label: string; color: string }> = [
    ...selected.map((id) => {
      const tag = tags.find((item) => item.id === id)!;
      return { id, label: `#${tag.name}`, color: tag.color };
    }),
    { id: null, label: "Unsorted", color: "#78918b" },
  ];
  return (
    <section className="board-view">
      <div className="board-toolbar">
        <p>Drag cards between columns to change their board tag.</p>
        <button
          className="secondary-button"
          onClick={() => setConfiguring(true)}
        >
          <Columns3 size={15} /> Configure columns
        </button>
      </div>
      <div className="board-columns">
        {columns.map((column) => {
          const items = entries.filter((entry) => {
            const boardTag = selected.find((id) =>
              entry.tags.some((tag) => tag.id === id),
            );
            return (boardTag || null) === column.id;
          });
          return (
            <section
              key={column.id || "unsorted"}
              className="board-column"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                const id = event.dataTransfer.getData("text/mindboss-entry");
                const entry = entries.find((item) => item.id === id);
                if (entry) onMove(entry, column.id);
              }}
            >
              <header>
                <span style={{ background: column.color }} />
                <strong>{column.label}</strong>
                <b>{items.length}</b>
              </header>
              <div className="board-card-list">
                {items.map((entry) => (
                  <div
                    key={entry.id}
                    draggable
                    onDragStart={(event) =>
                      event.dataTransfer.setData(
                        "text/mindboss-entry",
                        entry.id,
                      )
                    }
                  >
                    {renderEntry(entry)}
                    <label className="board-move-control">
                      <span>Move card</span>
                      <select
                        value={column.id || ""}
                        onChange={(event) =>
                          onMove(entry, event.target.value || null)
                        }
                      >
                        {columns.map((target) => (
                          <option
                            key={target.id || "unsorted"}
                            value={target.id || ""}
                          >
                            {target.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}

interface CalendarEvent {
  id: string;
  entry: Entry;
  label: string;
  date: string;
  tone: "reminder" | "review" | "list" | "capture";
}

function CalendarView({
  entries,
  timeZone,
  onOpen,
}: {
  entries: Entry[];
  timeZone: string;
  onOpen: (entry: Entry) => void;
}) {
  const currentParts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
  }).formatToParts(new Date());
  const initialYear = Number(
    currentParts.find((part) => part.type === "year")?.value,
  );
  const initialMonth =
    Number(currentParts.find((part) => part.type === "month")?.value) - 1;
  const [cursor, setCursor] = useState({
    year: initialYear,
    month: initialMonth,
  });
  const move = (amount: number) => {
    const next = new Date(Date.UTC(cursor.year, cursor.month + amount, 1));
    setCursor({ year: next.getUTCFullYear(), month: next.getUTCMonth() });
  };
  const events = useMemo(() => {
    const result: CalendarEvent[] = [];
    for (const entry of entries) {
      if (entry.reminderAt)
        result.push({
          id: `${entry.id}-reminder`,
          entry,
          date: entry.reminderAt,
          label: entry.title || entry.body || "Reminder",
          tone: "reminder",
        });
      if (entry.reviewAt)
        result.push({
          id: `${entry.id}-review`,
          entry,
          date: entry.reviewAt,
          label: `Review: ${entry.title || entry.body || "entry"}`,
          tone: "review",
        });
      for (const item of entry.listItems.filter((item) => item.dueAt))
        result.push({
          id: `${entry.id}-${item.id}`,
          entry,
          date: item.dueAt!,
          label: item.text,
          tone: "list",
        });
      if (
        !entry.reminderAt &&
        !entry.reviewAt &&
        !entry.listItems.some((item) => item.dueAt)
      )
        result.push({
          id: `${entry.id}-capture`,
          entry,
          date: entry.createdAt,
          label: entry.title || entry.body || "Captured entry",
          tone: "capture",
        });
    }
    return result;
  }, [entries]);
  const firstDay = new Date(Date.UTC(cursor.year, cursor.month, 1)).getUTCDay();
  const daysInMonth = new Date(
    Date.UTC(cursor.year, cursor.month + 1, 0),
  ).getUTCDate();
  const cells = Array.from({ length: 42 }, (_, index) => {
    const day = index - firstDay + 1;
    return day >= 1 && day <= daysInMonth ? day : null;
  });
  const monthLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(new Date(Date.UTC(cursor.year, cursor.month, 1)));
  const today = dateKeyForTimeZone(new Date(), timeZone);
  return (
    <section className="calendar-view">
      <header className="calendar-toolbar">
        <div>
          <button aria-label="Previous month" onClick={() => move(-1)}>
            <ChevronLeft />
          </button>
          <button
            onClick={() =>
              setCursor({ year: initialYear, month: initialMonth })
            }
          >
            Today
          </button>
          <button aria-label="Next month" onClick={() => move(1)}>
            <ChevronRight />
          </button>
        </div>
        <h2>{monthLabel}</h2>
        <span>{timeZone.replace("_", " ")}</span>
      </header>
      <div className="calendar-grid" role="grid" aria-label={monthLabel}>
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
          <strong key={day} className="calendar-weekday">
            {day}
          </strong>
        ))}
        {cells.map((day, index) => {
          const key = day
            ? `${cursor.year}-${String(cursor.month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
            : `blank-${index}`;
          const dayEvents = day
            ? events.filter(
                (event) => dateKeyForTimeZone(event.date, timeZone) === key,
              )
            : [];
          return (
            <div
              key={key}
              className={`calendar-day ${key === today ? "today" : ""} ${day ? "" : "blank"}`}
              role="gridcell"
            >
              {day && <time dateTime={key}>{day}</time>}
              {dayEvents.slice(0, 4).map((event) => (
                <button
                  key={event.id}
                  className={`calendar-event ${event.tone}`}
                  onClick={() => onOpen(event.entry)}
                  title={event.label}
                >
                  {event.label}
                </button>
              ))}
              {dayEvents.length > 4 && (
                <small>+{dayEvents.length - 4} more</small>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function EntryLayouts({
  entries,
  tags,
  preferences,
  renderEntry,
  onOpen,
  onMove,
  onPreferences,
}: {
  entries: Entry[];
  tags: Tag[];
  preferences: UserPreferences;
  renderEntry: (entry: Entry) => ReactNode;
  onOpen: (entry: Entry) => void;
  onMove: (entry: Entry, tagId: string | null) => void;
  onPreferences: (changes: Partial<UserPreferences>) => void;
}) {
  if (preferences.viewMode === "board")
    return (
      <BoardView
        entries={entries}
        tags={tags}
        preferences={preferences}
        renderEntry={renderEntry}
        onMove={onMove}
        onPreferences={onPreferences}
      />
    );
  if (preferences.viewMode === "calendar")
    return (
      <CalendarView
        entries={entries}
        timeZone={preferences.displayTimezone}
        onOpen={onOpen}
      />
    );
  const className =
    preferences.viewMode === "flex" ? "entry-grid flex-grid" : "entry-grid";
  if (preferences.groupByTime)
    return (
      <TimeGroupedFeed
        entries={entries}
        timeZone={preferences.displayTimezone}
        renderEntry={renderEntry}
        className={className}
      />
    );
  return <section className={className}>{entries.map(renderEntry)}</section>;
}
