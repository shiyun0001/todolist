import { useCallback, useEffect, useRef } from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { LogicalSize } from '@tauri-apps/api/window';
import {
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Eye,
  EyeOff,
  ListChecks,
  Minus,
  Plus,
  Settings2,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

import { TodoComposer } from './TodoComposer';
import { TodoCard } from './TodoCard';
import { CURRENT_WINDOW, applyWidgetPreferences } from '../app/tauri';
import type { AppPreferences, AppSnapshot, RecurrenceRule, TodoItem } from '../app/types';

const COLLAPSED_HEIGHT = 64;
const COLLAPSED_WIDTH = 320;
const PERSIST_MIN_WIDTH = 360;
const PERSIST_MIN_HEIGHT = 320;

interface WidgetViewProps {
  snapshot: AppSnapshot;
  composerOpen: boolean;
  composerFocusToken: number;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onRequestNewTodo: () => void;
  onCloseComposer: () => void;
  onOpenSettings: () => Promise<void>;
  onOpenManage: () => Promise<void>;
  onHideWidget: () => Promise<void>;
  onCreateTodo: (
    content: string,
    color: string,
    textColor: string,
    recurrence: RecurrenceRule | null,
  ) => Promise<void>;
  onToggleCompleted: (id: string, completed: boolean) => Promise<void>;
  onDeleteTodo: (id: string) => Promise<void>;
  onUpdateTodo: (todo: TodoItem) => Promise<void>;
  onReorderTodos: (orderedIds: string[]) => Promise<void>;
  onToggleHideCompleted: () => Promise<void>;
}

function ProgressRing({ progress, size = 44 }: { progress: number; size?: number }) {
  const stroke = 4;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, progress));
  const offset = circumference - circumference * clamped;

  return (
    <svg className="progress-ring" viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
      <circle className="progress-ring__track" cx={size / 2} cy={size / 2} r={radius} />
      <circle
        className="progress-ring__value"
        cx={size / 2}
        cy={size / 2}
        r={radius}
        strokeDasharray={`${circumference - offset} ${circumference}`}
      />
    </svg>
  );
}

export function WidgetView({
  snapshot,
  composerOpen,
  composerFocusToken,
  collapsed,
  onToggleCollapsed,
  onRequestNewTodo,
  onCloseComposer,
  onOpenSettings,
  onOpenManage,
  onHideWidget,
  onCreateTodo,
  onToggleCompleted,
  onDeleteTodo,
  onUpdateTodo,
  onReorderTodos,
  onToggleHideCompleted,
}: WidgetViewProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );

  const collapsedRef = useRef(collapsed);
  const preferencesRef = useRef<AppPreferences>(snapshot.preferences);
  const resizeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    collapsedRef.current = collapsed;
  }, [collapsed]);

  useEffect(() => {
    preferencesRef.current = snapshot.preferences;
  }, [snapshot.preferences]);

  useEffect(() => {
    let disposed = false;
    const unlistenPromise = CURRENT_WINDOW.onResized((event) => {
      if (collapsedRef.current) {
        return;
      }
      const dpr = window.devicePixelRatio || 1;
      const width = Math.round(event.payload.width / dpr);
      const height = Math.round(event.payload.height / dpr);
      if (width < PERSIST_MIN_WIDTH || height < PERSIST_MIN_HEIGHT) {
        return;
      }
      const prefs = preferencesRef.current;
      if (
        Math.abs(width - Math.round(prefs.widgetWidth)) < 2 &&
        Math.abs(height - Math.round(prefs.widgetHeight)) < 2
      ) {
        return;
      }
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current);
      }
      resizeTimerRef.current = window.setTimeout(() => {
        resizeTimerRef.current = null;
        if (collapsedRef.current || disposed) {
          return;
        }
        const latest = preferencesRef.current;
        if (
          Math.abs(width - Math.round(latest.widgetWidth)) < 2 &&
          Math.abs(height - Math.round(latest.widgetHeight)) < 2
        ) {
          return;
        }
        void applyWidgetPreferences({
          ...latest,
          widgetWidth: width,
          widgetHeight: height,
        }).catch((error) => console.error('persist resize failed', error));
      }, 450);
    });

    return () => {
      disposed = true;
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = null;
      }
      void unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);

  const handleToggleCollapsed = useCallback(async () => {
    const nextCollapsed = !collapsed;
    collapsedRef.current = nextCollapsed;
    onToggleCollapsed();
    try {
      const latest = preferencesRef.current;
      const collapsedWidth = Math.max(Math.round(latest.collapsedWidth || COLLAPSED_WIDTH), 240);
      const collapsedHeight = Math.max(Math.round(latest.collapsedHeight || COLLAPSED_HEIGHT), 48);
      if (nextCollapsed) {
        await CURRENT_WINDOW.setSize(new LogicalSize(collapsedWidth, collapsedHeight));
      } else {
        const width = Math.max(Math.round(latest.widgetWidth), 360);
        const height = Math.max(Math.round(latest.widgetHeight), 420);
        await CURRENT_WINDOW.setSize(new LogicalSize(width, height));
      }
      await applyWidgetPreferences({
        ...latest,
        lastCollapsed: nextCollapsed,
      });
    } catch (error) {
      console.error('resize widget window failed', error);
    }
  }, [collapsed, onToggleCollapsed]);

  const orderedTodos = [...snapshot.todos]
    .filter((todo) => !todo.deletedAt)
    .sort((left, right) => left.order - right.order);
  const hiddenTodos = orderedTodos.filter(
    (todo) => snapshot.preferences.hideCompleted && todo.completed,
  );
  const visibleTodos = orderedTodos.filter(
    (todo) => !(snapshot.preferences.hideCompleted && todo.completed),
  );
  const activeCount = orderedTodos.filter((todo) => !todo.completed).length;
  const completedCount = orderedTodos.length - activeCount;
  const progress = orderedTodos.length === 0 ? 0 : completedCount / orderedTodos.length;

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }

    const visibleIds = visibleTodos.map((todo) => todo.id);
    const oldIndex = visibleIds.indexOf(String(active.id));
    const newIndex = visibleIds.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) {
      return;
    }

    const reorderedVisible = arrayMove(visibleIds, oldIndex, newIndex);
    const hiddenIds = hiddenTodos.map((todo) => todo.id);
    await onReorderTodos([...reorderedVisible, ...hiddenIds]);
  }

  if (collapsed) {
    const total = orderedTodos.length;
    const allDone = total > 0 && activeCount === 0;
    const nextTodo = orderedTodos.find((t) => !t.completed);
    return (
      <main
        className="widget-shell is-collapsed"
        data-tauri-drag-region
        onDoubleClick={() => void handleToggleCollapsed()}
        title="双击展开"
      >
        <div className="collapsed-row" data-tauri-drag-region>
          <ProgressRing progress={progress} size={28} />
          <div className="collapsed-text" data-tauri-drag-region>
            {total === 0 ? (
              <span className="collapsed-empty">暂无待办</span>
            ) : allDone ? (
              <>
                <strong>{total}</strong>
                <span>已全部完成</span>
              </>
            ) : (
              <>
                <strong>{activeCount}</strong>
                <span>待处理</span>
                <span className="collapsed-dot">·</span>
                <span className="collapsed-done">
                  {completedCount}
                  <i>/</i>
                  {total}
                </span>
              </>
            )}
          </div>
          {nextTodo && (
            <div className="collapsed-preview" data-tauri-drag-region>
              {nextTodo.content.length > 12 ? nextTodo.content.slice(0, 12) + '…' : nextTodo.content}
            </div>
          )}
          <div className="collapsed-actions" data-tauri-drag-region="false">
            <button
              className="btn btn--icon btn--sm"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                void handleToggleCollapsed().then(() => onRequestNewTodo());
              }}
              aria-label="快速新建"
              title="快速新建"
            >
              <Plus size={14} />
            </button>
            <button
              className="btn btn--icon btn--sm"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                void handleToggleCollapsed();
              }}
              aria-label="展开"
              title="展开"
            >
              <ChevronDown size={14} />
            </button>
            <button
              className="btn btn--icon btn--sm"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                void onHideWidget();
              }}
              aria-label="隐藏到托盘"
              title="隐藏到托盘"
            >
              <Minus size={14} />
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="widget-shell">
      <header className="widget-header" data-tauri-drag-region>
        <div className="widget-title" data-tauri-drag-region>
          <span className="eyebrow">MY TODOS</span>
          <h1>我的清单</h1>
        </div>

        <div className="widget-actions" data-tauri-drag-region="false">
          <button
            className="btn btn--icon btn--sm"
            type="button"
            onClick={() => void onOpenManage()}
            aria-label="代办管理"
            title="代办管理"
          >
            <ClipboardList size={15} />
          </button>
          <button
            className="btn btn--icon btn--sm"
            type="button"
            onClick={() => void onOpenSettings()}
            aria-label="打开偏好设置"
            title="偏好设置"
          >
            <Settings2 size={15} />
          </button>
          <button
            className="btn btn--icon btn--sm"
            type="button"
            onClick={onRequestNewTodo}
            aria-label="新建待办"
            title="新建待办"
          >
            <Plus size={15} />
          </button>
          <button
            className="btn btn--icon btn--sm"
            type="button"
            onClick={() => void handleToggleCollapsed()}
            aria-label="折叠"
            title="折叠成横条"
          >
            <ChevronUp size={15} />
          </button>
          <button
            className="btn btn--icon btn--sm"
            type="button"
            onClick={() => void onHideWidget()}
            aria-label="隐藏到托盘"
            title="隐藏到托盘"
          >
            <Minus size={15} />
          </button>
        </div>
      </header>

      <section
        className="widget-overview"
        onDoubleClick={() => void handleToggleCollapsed()}
        title="双击折叠"
      >
        <ProgressRing progress={progress} />
        <div className="overview-copy">
          <strong>{activeCount}</strong>
          <span>件待处理</span>
        </div>
        <div className="overview-stats">
          <span>
            <em>{orderedTodos.length}</em> 总数
          </span>
          <span>
            <em>{completedCount}</em> 已完成
          </span>
        </div>
      </section>

      <div className="composer-wrap">
        <AnimatePresence initial={false}>
          {composerOpen && (
            <motion.div
              key="composer"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              style={{ overflow: 'hidden' }}
            >
              <TodoComposer
                focusToken={composerFocusToken}
                onCreate={onCreateTodo}
                onClose={onCloseComposer}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {hiddenTodos.length > 0 && (
          <motion.button
            key="hidden-banner"
            className="hidden-banner"
            type="button"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            onClick={() => void onToggleHideCompleted()}
          >
            {snapshot.preferences.hideCompleted ? <EyeOff size={13} /> : <Eye size={13} />}
            已隐藏 {hiddenTodos.length} 条已完成，点击切换
          </motion.button>
        )}
      </AnimatePresence>

      <section className="widget-list-section">
        <div className="todo-list-header">
          <h2>全部待办</h2>
          <span className="count">{visibleTodos.length}</span>
        </div>

        {visibleTodos.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state__icon">
              <ListChecks size={18} />
            </div>
            <div>
              <h3>暂无待办</h3>
              <p>点击上方 + 号，或按 Enter 快速添加第一条。</p>
            </div>
            <button className="btn btn--primary btn--sm" type="button" onClick={onRequestNewTodo}>
              <Plus size={14} />
              新建待办
            </button>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={visibleTodos.map((todo) => todo.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="todo-list">
                <AnimatePresence initial={false}>
                  {visibleTodos.map((todo) => (
                    <TodoCard
                      key={todo.id}
                      todo={todo}
                      onToggleCompleted={onToggleCompleted}
                      onDelete={onDeleteTodo}
                      onSave={onUpdateTodo}
                    />
                  ))}
                </AnimatePresence>
              </div>
            </SortableContext>
          </DndContext>
        )}
      </section>
    </main>
  );
}
