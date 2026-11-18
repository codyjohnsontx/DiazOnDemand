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
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { localDateString } from '@/lib/journal';

/** Green and red here mean what they mean on a badge: it worked, or it did not. */
const OUTCOMES = [
  {
    value: JournalOutcome.WORKED,
    label: 'Worked',
    pressed:
      'aria-pressed:border-border-success aria-pressed:bg-surface-success-faint aria-pressed:text-foreground-success',
  },
  {
    value: JournalOutcome.DID_NOT_WORK,
    label: "Didn't work",
    pressed:
      'aria-pressed:border-border-critical aria-pressed:bg-surface-critical-faint aria-pressed:text-foreground-critical',
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
    <form className="flex flex-col gap-600" onSubmit={submit}>
      <div className="grid gap-500 md:grid-cols-split">
        <Field className="min-w-0" htmlFor={`${fieldId}-date`} label="Date">
          <Input
            id={`${fieldId}-date`}
            max={localDateString()}
            onChange={(event) => setSessionDate(event.target.value)}
            required
            type="date"
            value={sessionDate}
          />
        </Field>
        <Field className="min-w-0" htmlFor={`${fieldId}-discipline`} label="Discipline">
          <Select
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
          </Select>
        </Field>
      </div>

      <fieldset className="flex flex-col">
        <legend className="type-kicker pb-200">What you worked on</legend>
        {tracks.map((track) => (
          <div
            aria-label={track.label}
            className="flex flex-col gap-200 border-t border-border-primary py-300 md:flex-row md:items-center md:justify-between"
            key={track.id}
            role="group"
          >
            <span className="text-body-200 text-foreground-primary">{track.label}</span>
            <div className="grid shrink-0 grid-cols-split gap-200">
              {OUTCOMES.map((outcome) => (
                <button
                  aria-pressed={marks[track.id] === outcome.value}
                  className={[
                    'inline-flex h-control-md items-center justify-center whitespace-nowrap rounded-200 border border-border-strong bg-transparent px-400 text-body-200 font-semibold leading-none text-foreground-faint transition-colors duration-fast hover:bg-surface-interactive-hover hover:text-foreground-primary',
                    outcome.pressed,
                  ].join(' ')}
                  key={outcome.value}
                  onClick={() => toggleMark(track.id, outcome.value)}
                  type="button"
                >
                  {outcome.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </fieldset>

      <Field htmlFor={`${fieldId}-note`} label="Note">
        <Textarea
          className="resize-y"
          id={`${fieldId}-note`}
          maxLength={JOURNAL_NOTE_MAX_LENGTH}
          onChange={(event) => setNote(event.target.value)}
          rows={4}
          value={note}
        />
      </Field>

      <div className="flex flex-wrap items-center gap-300">
        <Button
          disabled={submitting || items.length === 0 || !sessionDate}
          type="submit"
          variant="primary"
        >
          {submitting ? 'Saving...' : submitLabel}
        </Button>
        {onCancel ? <Button onClick={onCancel}>Cancel</Button> : null}
      </div>
    </form>
  );
}
