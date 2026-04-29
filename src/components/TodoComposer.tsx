import { type CSSProperties, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';

import {
  TODO_CARD_COLORS,
  TODO_TEXT_COLORS,
  resolveCardColor,
  resolveTextColor,
} from '../app/todoColors';
import type { RecurrenceRule } from '../app/types';
import { RecurrencePicker } from './RecurrencePicker';

interface TodoComposerProps {
  focusToken: number;
  onCreate: (
    content: string,
    color: string,
    textColor: string,
    recurrence: RecurrenceRule | null,
  ) => Promise<void>;
  onClose: () => void;
}

export function TodoComposer({ focusToken, onCreate, onClose }: TodoComposerProps) {
  const [draft, setDraft] = useState('');
  const [cardColor, setCardColor] = useState<string>(TODO_CARD_COLORS[0].value);
  const [textColor, setTextColor] = useState<string>(TODO_TEXT_COLORS[0].value);
  const [recurrence, setRecurrence] = useState<RecurrenceRule | null>(null);
  const [busy, setBusy] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const element = textareaRef.current;
      if (!element) {
        return;
      }
      element.focus();
      element.setSelectionRange(element.value.length, element.value.length);
      resizeTo(element);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [focusToken]);

  function resizeTo(element: HTMLTextAreaElement) {
    element.style.height = '0px';
    element.style.height = `${Math.max(element.scrollHeight, 72)}px`;
  }

  async function submitDraft() {
    if (busy) {
      return;
    }

    const trimmed = draft.trimEnd();
    if (!trimmed.trim()) {
      return;
    }

    try {
      setBusy(true);
      await onCreate(trimmed, cardColor, textColor, recurrence);
      setDraft('');
      setRecurrence(null);
      const element = textareaRef.current;
      if (element) {
        element.style.height = '72px';
      }
    } finally {
      setBusy(false);
      window.requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submitDraft();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  }

  function handleInput(value: string) {
    setDraft(value);
    const element = textareaRef.current;
    if (element) {
      resizeTo(element);
    }
  }

  const resolvedText = resolveTextColor(textColor);

  return (
    <section className="composer" aria-label="新建待办">
      <textarea
        ref={textareaRef}
        className="composer-textarea"
        value={draft}
        style={{ color: resolvedText.token }}
        onChange={(event) => handleInput(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="写点什么…  Enter 添加 · Shift+Enter 换行"
        rows={3}
      />

      <div className="composer-divider" aria-hidden="true" />

      <div className="composer-footer">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="color-row">
            <span className="color-row__label">卡片</span>
            <div className="color-row__swatches" role="radiogroup" aria-label="卡片颜色">
              {TODO_CARD_COLORS.map((option) => {
                const resolved = resolveCardColor(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={option.value === cardColor}
                    aria-label={option.label}
                    title={option.label}
                    className={`swatch ${option.value === 'none' ? 'swatch--none' : ''} ${
                      option.value === cardColor ? 'is-active' : ''
                    }`}
                    style={{ '--swatch-bg': resolved.swatch } as CSSProperties}
                    onClick={() => setCardColor(option.value)}
                  />
                );
              })}
            </div>
          </div>

          <div className="color-row">
            <span className="color-row__label">文字</span>
            <div className="color-row__swatches" role="radiogroup" aria-label="文字颜色">
              {TODO_TEXT_COLORS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={option.value === textColor}
                  aria-label={option.label}
                  title={option.label}
                  className={`swatch swatch--text ${option.value === textColor ? 'is-active' : ''}`}
                  style={{ '--swatch-bg': option.token } as CSSProperties}
                  onClick={() => setTextColor(option.value)}
                />
              ))}
            </div>
          </div>

          <RecurrencePicker value={recurrence} onChange={setRecurrence} />
        </div>

        <div className="composer-actions">
          <span className="shortcut-hint">
            <kbd>Enter</kbd>
            添加
          </span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>
            <X size={14} />
            取消
          </button>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={() => void submitDraft()}
            disabled={busy || !draft.trim()}
          >
            <Check size={14} />
            添加
          </button>
        </div>
      </div>
    </section>
  );
}
