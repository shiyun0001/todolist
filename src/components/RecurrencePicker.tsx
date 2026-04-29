import { Repeat } from 'lucide-react';

import type { RecurrenceFrequency, RecurrenceRule } from '../app/types';

interface RecurrencePickerProps {
  value: RecurrenceRule | null;
  onChange: (rule: RecurrenceRule | null) => void;
}

const FREQUENCY_OPTIONS: Array<{ value: RecurrenceFrequency; label: string }> = [
  { value: 'daily', label: '每天' },
  { value: 'weekdays', label: '工作日' },
  { value: 'weekends', label: '周末' },
  { value: 'weekly', label: '每周' },
  { value: 'every-n-days', label: '每 N 天' },
];

const WEEKDAY_CHIPS = ['日', '一', '二', '三', '四', '五', '六'];

const DEFAULT_RULE: RecurrenceRule = {
  frequency: 'daily',
  daysOfWeek: [],
  interval: 1,
};

export function describeRecurrence(rule: RecurrenceRule | null | undefined): string {
  if (!rule) return '';
  switch (rule.frequency) {
    case 'daily':
      return '每天';
    case 'weekdays':
      return '工作日';
    case 'weekends':
      return '周末';
    case 'weekly': {
      if (rule.daysOfWeek.length === 0) return '每周';
      const sorted = [...rule.daysOfWeek].sort((a, b) => a - b);
      return sorted.map((day) => `周${WEEKDAY_CHIPS[day] ?? ''}`).join(' ');
    }
    case 'every-n-days':
      return rule.interval <= 1 ? '每天' : `每 ${rule.interval} 天`;
    default:
      return '';
  }
}

export function RecurrencePicker({ value, onChange }: RecurrencePickerProps) {
  const enabled = value !== null;
  const rule = value ?? DEFAULT_RULE;

  function handleToggle() {
    if (enabled) {
      onChange(null);
    } else {
      onChange({ ...DEFAULT_RULE });
    }
  }

  function update(patch: Partial<RecurrenceRule>) {
    onChange({ ...rule, ...patch });
  }

  function toggleWeekday(day: number) {
    const has = rule.daysOfWeek.includes(day);
    const next = has ? rule.daysOfWeek.filter((d) => d !== day) : [...rule.daysOfWeek, day];
    update({ daysOfWeek: next });
  }

  return (
    <div className={`recurrence ${enabled ? 'is-on' : ''}`}>
      <button
        type="button"
        className={`recurrence__toggle ${enabled ? 'is-active' : ''}`}
        onClick={handleToggle}
      >
        <Repeat size={13} />
        <span>{enabled ? '已开启定时重复' : '设为定时重复'}</span>
      </button>

      {enabled ? (
        <div className="recurrence__panel">
          <div className="recurrence__row">
            <span className="recurrence__label">频率</span>
            <div className="segmented segmented--compact">
              {FREQUENCY_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`segmented__item ${rule.frequency === option.value ? 'is-active' : ''}`}
                  onClick={() => {
                    if (option.value === 'every-n-days') {
                      update({
                        frequency: option.value,
                        interval: Math.max(rule.interval || 1, 2),
                      });
                    } else {
                      update({ frequency: option.value });
                    }
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {rule.frequency === 'weekly' ? (
            <div className="recurrence__row">
              <span className="recurrence__label">星期</span>
              <div className="weekday-chips" role="group">
                {WEEKDAY_CHIPS.map((label, index) => (
                  <button
                    key={index}
                    type="button"
                    aria-pressed={rule.daysOfWeek.includes(index)}
                    className={`weekday-chip ${rule.daysOfWeek.includes(index) ? 'is-active' : ''}`}
                    onClick={() => toggleWeekday(index)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {rule.frequency === 'every-n-days' ? (
            <div className="recurrence__row">
              <span className="recurrence__label">间隔</span>
              <div className="recurrence__interval">
                <span>每</span>
                <input
                  type="number"
                  className="number-input"
                  min={1}
                  max={30}
                  value={rule.interval}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    if (!Number.isFinite(next)) return;
                    update({ interval: Math.max(1, Math.min(30, Math.round(next))) });
                  }}
                />
                <span>天</span>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
