'use client';

import { FormEvent, useId, useState } from 'react';
import {
  Discipline,
  JOURNAL_NOTE_MAX_LENGTH,
  JournalOutcome,
  getDisciplineLabel,
  getJournalTracks,
} from '@diaz/shared';
import type { JournalEntryDto, JournalEntryWriteDto } from '@diaz/shared';
import { localDateString } from '@/lib/journal';

const FIELD_CLASSES =
  'h-[3.25rem] w-full rounded-[20px] border border-white/10 bg-[var(--surface-2)] px-4 py-3 text-[var(--text)]';

const OUTCOMES = [
  {
    value: JournalOutcome.WORKED,
    label: 'Worked',
    selected: 'border-[var(--progress)]/50 bg-[var(--progress)]/15 text-[var(--progress)]',
  },
  {
    value: JournalOutcome.DID_NOT_WORK,
    label: "Didn't work",
    selected: 'border-[var(--danger)]/50 bg-[var(--danger)]/15 text-[var(--danger)]',
  },
];

function marksFrom(entry?: JournalEntryDto) {
  return Object.fromEntries(entry?.items.map((item) => [item.track, item.outcome]) ?? []);
}

export function JournalEntryForm({
  entry,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  entry?: JournalEntryDto;
  submitLabel: string;
  /** Resolves true when saved. A rejected save keeps what the member typed. */
  onSubmit: (payload: JournalEntryWriteDto) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const fieldId = useId();
  const [sessionDate, setSessionDate] = useState(entry?.sessionDate ?? localDateString());
  const [discipline, setDiscipline] = useState(entry?.discipline ?? Discipline.BJJ);
  const [marks, setMarks] = useState<Record<string, JournalOutcome>>(marksFrom(entry));
  const [note, setNote] = useState(entry?.note ?? '');
  const [submitting, setSubmitting] = useState(false);

  const tracks = getJournalTracks(discipline);
  const items = tracks.flatMap(({ id }) => {
    const outcome = marks[id];
    return outcome ? [{ track: id, outcome }] : [];
  });

  const toggleMark = (track: string, outcome: JournalOutcome) => {
    setMarks((current) => {
      const { [track]: previous, ...rest } = current;
      return previous === outcome ? rest : { ...rest, [track]: outcome };
    });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();

    if (submitting || items.length === 0) {
      return;
    }

    setSubmitting(true);
    const saved = await onSubmit({ sessionDate, discipline, items, note });
    setSubmitting(false);

    if (saved && !entry) {
      setMarks({});
      setNote('');
    }
  };

  return (
    <form className="space-y-5" onSubmit={submit}>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="min-w-0 space-y-2">
          <label className="type-kicker text-[var(--text-muted)]" htmlFor={`${fieldId}-date`}>
            Date
          </label>
          <input
            className={FIELD_CLASSES}
            id={`${fieldId}-date`}
            max={localDateString()}
            onChange={(event) => setSessionDate(event.target.value)}
            required
            type="date"
            value={sessionDate}
          />
        </div>
        <div className="min-w-0 space-y-2">
          <label className="type-kicker text-[var(--text-muted)]" htmlFor={`${fieldId}-discipline`}>
            Discipline
          </label>
          <select
            className={FIELD_CLASSES}
            id={`${fieldId}-discipline`}
            onChange={(event) => {
              setDiscipline(event.target.value as Discipline);
              setMarks({});
            }}
            value={discipline}
          >
            {Object.values(Discipline).map((value) => (
              <option key={value} value={value}>
                {getDisciplineLabel(value)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <fieldset className="space-y-3">
        <legend className="type-kicker mb-2 text-[var(--text-muted)]">What you worked on</legend>
        {tracks.map((track) => (
          <div
            aria-label={track.label}
            className="flex flex-col gap-2 border-t border-white/10 pt-3 sm:flex-row sm:items-center sm:justify-between"
            key={track.id}
            role="group"
          >
            <span className="type-meta text-[var(--text)]">{track.label}</span>
            <div className="grid shrink-0 grid-cols-2 gap-2">
              {OUTCOMES.map((outcome) => {
                const pressed = marks[track.id] === outcome.value;

                return (
                  <button
                    aria-pressed={pressed}
                    className={[
                      'min-h-11 whitespace-nowrap rounded-full border px-4 text-sm font-semibold transition-colors duration-200',
                      pressed
                        ? outcome.selected
                        : 'border-white/10 bg-white/5 text-[var(--text-muted)] hover:bg-white/10',
                    ].join(' ')}
                    key={outcome.value}
                    onClick={() => toggleMark(track.id, outcome.value)}
                    type="button"
                  >
                    {outcome.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </fieldset>

      <div className="space-y-2">
        <label className="type-kicker text-[var(--text-muted)]" htmlFor={`${fieldId}-note`}>
          Note
        </label>
        <textarea
          className={`${FIELD_CLASSES} h-auto min-h-28 resize-y`}
          id={`${fieldId}-note`}
          maxLength={JOURNAL_NOTE_MAX_LENGTH}
          onChange={(event) => setNote(event.target.value)}
          value={note}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          className="inline-flex items-center rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text)] transition-colors duration-200 hover:bg-[var(--accent-strong)] disabled:opacity-60"
          disabled={submitting || items.length === 0 || !sessionDate}
          type="submit"
        >
          {submitting ? 'Saving...' : submitLabel}
        </button>
        {onCancel ? (
          <button
            className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text)] transition-colors duration-200 hover:bg-white/10"
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}
