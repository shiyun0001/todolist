import {
  type CSSProperties,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import { CSS } from '@dnd-kit/utilities';
import { useSortable } from '@dnd-kit/sortable';
import { Check, GripVertical, MoreHorizontal, Pencil, Repeat, Trash2, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

import {
  TODO_CARD_COLORS,
  TODO_TEXT_COLORS,
  resolveCardColor,
  resolveTextColor,
} from '../app/todoColors';
import type { RecurrenceRule, TodoItem } from '../app/types';
import { RecurrencePicker, describeRecurrence } from './RecurrencePicker';

interface TodoCardProps {
  todo: TodoItem;
  onToggleCompleted: (id: string, completed: boolean) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onSave: (todo: TodoItem) => Promise<void>;
  draggable?: boolean;
}

function formatStamp(timestamp: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

export function TodoCard({ todo, onToggleCompleted, onDelete, onSave, draggable = true }: TodoCardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(todo.content);
  const [draftCard, setDraftCard] = useState(todo.color);
  const [draftText, setDraftText] = useState(todo.textColor ?? 'default');
  const [draftRecurrence, setDraftRecurrence] = useState<RecurrenceRule | null>(
    todo.recurrence ?? null,
  );
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const actionsRef = useRef<HTMLDivElement | null>(null);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: todo.id,
  });

  useEffect(() => {
    setDraft(todo.content);
    setDraftCard(todo.color);
    setDraftText(todo.textColor ?? 'default');
    setDraftRecurrence(todo.recurrence ?? null);
  }, [todo]);

  useEffect(() => {
    if (!editing) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const element = textareaRef.current;
      if (!element) {
        return;
      }
      element.focus();
      element.setSelectionRange(element.value.length, element.value.length);
      element.style.height = '0px';
      element.style.height = `${Math.max(element.scrollHeight, 72)}px`;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [editing]);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!actionsRef.current) {
        return;
      }
      if (!actionsRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    window.addEventListener('pointerdown', handlePointerDown, true);
    return () => window.removeEventListener('pointerdown', handlePointerDown, true);
  }, [menuOpen]);

  const resolvedCard = resolveCardColor(editing ? draftCard : todo.color);
  const resolvedText = resolveTextColor(editing ? draftText : todo.textColor ?? 'default');

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    '--card-accent': resolvedCard.accent,
    '--todo-text-color': resolvedText.token,
  } as CSSProperties;

  async function saveDraft() {
    const trimmed = draft.trimEnd();
    if (!trimmed.trim() || busy) {
      return;
    }

    try {
      setBusy(true);
      await onSave({
        ...todo,
        content: trimmed,
        color: draftCard,
        textColor: draftText,
        recurrence: draftRecurrence,
      });
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  function cancelEdit() {
    setEditing(false);
    setDraft(todo.content);
    setDraftCard(todo.color);
    setDraftText(todo.textColor ?? 'default');
    setDraftRecurrence(todo.recurrence ?? null);
  }

  function handleEditKeys(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void saveDraft();
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      cancelEdit();
    }
  }

  function resizeEditor() {
    const element = textareaRef.current;
    if (!element) {
      return;
    }
    element.style.height = '0px';
    element.style.height = `${Math.max(element.scrollHeight, 72)}px`;
  }

  return (
    <motion.article
      ref={setNodeRef}
      layout
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4, scale: 0.98 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      style={style}
      className={`todo-card ${todo.completed ? 'is-complete' : ''} ${
        isDragging ? 'is-dragging' : ''
      } ${editing ? 'is-editing' : ''}`}
    >
      <span className="todo-card__accent" aria-hidden="true" />

      <button
        className={`todo-card__toggle ${todo.completed ? 'is-active' : ''}`}
        type="button"
        onClick={() => void onToggleCompleted(todo.id, !todo.completed)}
        aria-label={todo.completed ? '标记为未完成' : '标记为完成'}
      >
        <Check size={12} strokeWidth={3} />
      </button>

      <div className="todo-card__body">
        {editing ? (
          <div className="todo-editor">
            <textarea
              ref={textareaRef}
              className="todo-editor__textarea"
              rows={3}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                resizeEditor();
              }}
              onKeyDown={handleEditKeys}
            />

            <div className="todo-editor__footer">
              <div className="todo-editor__swatches">
                <div className="color-row">
                  <span className="color-row__label">卡片</span>
                  <div className="color-row__swatches">
                    {TODO_CARD_COLORS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        aria-label={option.label}
                        title={option.label}
                        className={`swatch ${option.value === 'none' ? 'swatch--none' : ''} ${
                          option.value === draftCard ? 'is-active' : ''
                        }`}
                        style={{ '--swatch-bg': option.swatch } as CSSProperties}
                        onClick={() => setDraftCard(option.value)}
                      />
                    ))}
                  </div>
                </div>
                <div className="color-row">
                  <span className="color-row__label">文字</span>
                  <div className="color-row__swatches">
                    {TODO_TEXT_COLORS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        aria-label={option.label}
                        title={option.label}
                        className={`swatch swatch--text ${option.value === draftText ? 'is-active' : ''}`}
                        style={{ '--swatch-bg': option.token } as CSSProperties}
                        onClick={() => setDraftText(option.value)}
                      />
                    ))}
                  </div>
                </div>

                <RecurrencePicker value={draftRecurrence} onChange={setDraftRecurrence} />
              </div>

              <div className="composer-actions">
                <button className="btn btn--ghost btn--sm" type="button" onClick={cancelEdit}>
                  <X size={14} />
                  取消
                </button>
                <button
                  className="btn btn--primary btn--sm"
                  type="button"
                  onClick={() => void saveDraft()}
                  disabled={busy}
                >
                  <Check size={14} />
                  保存
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <p
              className="todo-card__content"
              onDoubleClick={() => setEditing(true)}
            >
              {todo.content}
            </p>
            <div className="todo-card__meta">
              <span>{formatStamp(todo.updatedAt)}</span>
              {todo.recurrence ? (
                <span className="todo-card__badge todo-card__badge--repeat" title="重复任务">
                  <Repeat size={10} />
                  {describeRecurrence(todo.recurrence)}
                </span>
              ) : null}
            </div>
          </>
        )}
      </div>

      {!editing && (
        <div className="todo-card__actions" ref={actionsRef} style={{ position: 'relative' }}>
          <button
            className="btn btn--icon btn--sm"
            type="button"
            onClick={() => setMenuOpen((prev) => !prev)}
            aria-label="更多操作"
          >
            <MoreHorizontal size={14} />
          </button>
          {draggable ? (
            <div className="todo-card__drag" aria-label="拖拽排序" {...attributes} {...listeners}>
              <GripVertical size={14} />
            </div>
          ) : null}
          <AnimatePresence>
            {menuOpen && (
              <motion.div
                className="popover"
                role="menu"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.12, ease: [0.22, 1, 0.36, 1] }}
              >
                <button
                  type="button"
                  className="popover__item"
                  onClick={() => {
                    setMenuOpen(false);
                    setEditing(true);
                  }}
                >
                  <Pencil size={14} />
                  编辑
                </button>
                <button
                  type="button"
                  className="popover__item popover__item--danger"
                  onClick={() => {
                    setMenuOpen(false);
                    void onDelete(todo.id);
                  }}
                >
                  <Trash2 size={14} />
                  删除
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </motion.article>
  );
}
