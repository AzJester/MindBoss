import { useEffect, useRef, useState, type ReactNode } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { dateKey, shiftDate } from "../shared/time";

export function Modal({
  label,
  children,
  onClose,
  className = "",
}: {
  label: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    const cancel = (event: Event) => {
      event.preventDefault();
      closeRef.current();
    };
    dialog.addEventListener("cancel", cancel);
    return () => {
      dialog.removeEventListener("cancel", cancel);
      dialog.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog ref={ref} className={`modal-shell ${className}`} aria-label={label}>
      {children}
    </dialog>
  );
}

export function DateControl({
  value,
  onChange,
  label,
  timeZone = "America/Phoenix",
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  timeZone?: string;
}) {
  const [open, setOpen] = useState(false);
  const today = dateKey(new Date(), timeZone);
  const [month, setMonth] = useState((value || today).slice(0, 7));
  const choose = (next: string) => {
    onChange(next);
    setOpen(false);
  };
  const first = new Date(month + "-01T12:00:00Z");
  const count = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const move = (n: number) => {
    const next = new Date(first);
    next.setUTCMonth(next.getUTCMonth() + n);
    setMonth(next.toISOString().slice(0, 7));
  };
  return (
    <div className="date-control">
      <button
        type="button"
        className={`date-trigger ${value ? "has-date" : ""}`}
        aria-label={label}
        aria-haspopup="dialog"
        onClick={() => {
          setMonth((value || today).slice(0, 7));
          setOpen(true);
        }}
      >
        <CalendarDays size={20} />
        <span>
          {value
            ? new Intl.DateTimeFormat("en-US", {
                month: "short",
                day: "numeric",
                timeZone: "UTC",
              }).format(new Date(value + "T12:00:00Z"))
            : "Set date"}
        </span>
      </button>
      {open && (
        <Modal
          label={label}
          className="date-dialog"
          onClose={() => setOpen(false)}
        >
          <header>
            <h2>{label}</h2>
            <button
              type="button"
              className="icon-button"
              aria-label="Close date picker"
              onClick={() => setOpen(false)}
            >
              <X />
            </button>
          </header>
          <div className="date-shortcuts">
            {[
              ["Today", 0],
              ["Tomorrow", 1],
              ["Next week", 7],
            ].map(([text, days]) => (
              <button
                type="button"
                key={text}
                onClick={() => choose(shiftDate(today, Number(days)))}
              >
                {text}
              </button>
            ))}
          </div>
          <div className="date-month">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => move(-1)}
            >
              <ChevronLeft />
            </button>
            <strong>
              {new Intl.DateTimeFormat("en-US", {
                month: "long",
                year: "numeric",
                timeZone: "UTC",
              }).format(first)}
            </strong>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => move(1)}
            >
              <ChevronRight />
            </button>
          </div>
          <div className="date-grid">
            {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
              <span key={d}>{d}</span>
            ))}
            {Array.from({ length: first.getUTCDay() }, (_, i) => (
              <span key={"blank" + i} />
            ))}
            {Array.from({ length: count }, (_, i) => {
              const key = month + "-" + String(i + 1).padStart(2, "0");
              return (
                <button
                  type="button"
                  key={key}
                  aria-label={key}
                  aria-pressed={key === value}
                  className={key === today ? "today" : ""}
                  onClick={() => choose(key)}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
          <label className="field">
            <span>Custom date</span>
            <input
              type="date"
              aria-label="Custom date"
              value={value}
              onChange={(e) => choose(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="secondary-button"
            onClick={() => choose("")}
          >
            Remove date
          </button>
        </Modal>
      )}
    </div>
  );
}
