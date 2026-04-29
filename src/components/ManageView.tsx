import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpFromLine,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Download,
  FolderInput,
  Inbox,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Square,
  Trash2,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';

import { useAppStore, type ManageSort, type ManageTab } from '../app/store';
import { CURRENT_WINDOW } from '../app/tauri';
import type { AppPreferences, AppSnapshot, ImportMode, RecurrenceRule, TodoItem } from '../app/types';
import { TodoCard } from './TodoCard';
import { TodoComposer } from './TodoComposer';

interface ManageViewProps {
  snapshot: AppSnapshot;
  onClose: () => Promise<void>;
  onPatchPreferences: (patch: Partial<AppPreferences>) => Promise<void>;
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
  onRestoreTodo: (id: string) => Promise<void>;
  onPurgeTodo: (id: string) => Promise<void>;
  onEmptyTrash: () => Promise<void>;
  onExportTodos: (path: string) => Promise<void>;
  onImportTodos: (path: string, mode: ImportMode) => Promise<void>;
}

const TABS: Array<{ key: ManageTab; label: string; icon: typeof ClipboardList }> = [
  { key: 'all', label: '全部', icon: ClipboardList },
  { key: 'by-date', label: '按日期', icon: CalendarDays },
  { key: 'completed', label: '已完成', icon: CheckCircle2 },
  { key: 'trash', label: '回收站', icon: Trash2 },
  { key: 'io', label: '导入导出', icon: FolderInput },
];

const SORT_OPTIONS: Array<{ value: ManageSort; label: string }> = [
  { value: 'created-desc', label: '最新创建' },
  { value: 'created-asc', label: '最早创建' },
  { value: 'updated-desc', label: '最近更新' },
  { value: 'alpha', label: '按字母' },
];

const RETENTION_PRESETS = [7, 30, 90, 365];

function formatDay(timestamp: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date(timestamp));
}

function dayKey(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

function formatStamp(timestamp: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function formatRelative(timestamp: number) {
  const diff = timestamp - Date.now();
  const rtf = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 60_000) return rtf.format(Math.round(diff / 1000), 'second');
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), 'minute');
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), 'hour');
  return rtf.format(Math.round(diff / 86_400_000), 'day');
}

function sortTodos(todos: TodoItem[], mode: ManageSort) {
  const list = [...todos];
  switch (mode) {
    case 'created-asc':
      return list.sort((a, b) => a.createdAt - b.createdAt);
    case 'updated-desc':
      return list.sort((a, b) => b.updatedAt - a.updatedAt);
    case 'alpha':
      return list.sort((a, b) => a.content.localeCompare(b.content, 'zh-CN'));
    case 'created-desc':
    default:
      return list.sort((a, b) => b.createdAt - a.createdAt);
  }
}

function defaultExportName() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `todos-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours(),
  )}${pad(now.getMinutes())}.json`;
}

export function ManageView({
  snapshot,
  onClose,
  onPatchPreferences,
  onCreateTodo,
  onToggleCompleted,
  onDeleteTodo,
  onUpdateTodo,
  onReorderTodos,
  onRestoreTodo,
  onPurgeTodo,
  onEmptyTrash,
  onExportTodos,
  onImportTodos,
}: ManageViewProps) {
  const tab = useAppStore((state) => state.manageTab);
  const setTab = useAppStore((state) => state.setManageTab);
  const search = useAppStore((state) => state.manageSearch);
  const setSearch = useAppStore((state) => state.setManageSearch);
  const sort = useAppStore((state) => state.manageSort);
  const setSort = useAppStore((state) => state.setManageSort);
  const composerOpen = useAppStore((state) => state.manageComposerOpen);
  const composerFocusToken = useAppStore((state) => state.manageComposerFocusToken);
  const openComposer = useAppStore((state) => state.openManageComposer);
  const closeComposer = useAppStore((state) => state.closeManageComposer);

  const [isMaximized, setIsMaximized] = useState(false);
  const [importMode, setImportMode] = useState<ImportMode>('merge');
  const [draftRetention, setDraftRetention] = useState(snapshot.preferences.trashRetentionDays);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    setDraftRetention(snapshot.preferences.trashRetentionDays);
  }, [snapshot.preferences.trashRetentionDays]);

  useEffect(() => {
    if (draftRetention === snapshot.preferences.trashRetentionDays) return;
    const timer = window.setTimeout(() => {
      void onPatchPreferences({ trashRetentionDays: draftRetention });
    }, 320);
    return () => window.clearTimeout(timer);
  }, [draftRetention, onPatchPreferences, snapshot.preferences.trashRetentionDays]);

  useEffect(() => {
    let active = true;
    CURRENT_WINDOW.isMaximized()
      .then((value) => active && setIsMaximized(value))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const activeTodos = useMemo(
    () => snapshot.todos.filter((todo) => !todo.deletedAt),
    [snapshot.todos],
  );
  const trashedTodos = useMemo(
    () =>
      snapshot.todos
        .filter((todo): todo is TodoItem & { deletedAt: number } => Boolean(todo.deletedAt))
        .sort((a, b) => b.deletedAt - a.deletedAt),
    [snapshot.todos],
  );
  const completedCount = activeTodos.filter((todo) => todo.completed).length;
  const pendingCount = activeTodos.length - completedCount;

  const filteredBySearch = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return activeTodos;
    return activeTodos.filter((todo) => todo.content.toLowerCase().includes(query));
  }, [activeTodos, search]);

  const allList = useMemo(() => {
    if (tab !== 'all') return [];
    const hideCompleted = snapshot.preferences.hideCompleted;
    const visible = hideCompleted
      ? filteredBySearch.filter((todo) => !todo.completed)
      : filteredBySearch;
    return sortTodos(visible, sort);
  }, [filteredBySearch, snapshot.preferences.hideCompleted, sort, tab]);

  const completedList = useMemo(() => {
    if (tab !== 'completed') return [];
    return sortTodos(
      filteredBySearch.filter((todo) => todo.completed),
      sort === 'alpha' ? 'alpha' : 'updated-desc',
    );
  }, [filteredBySearch, sort, tab]);

  const dateGroups = useMemo(() => {
    if (tab !== 'by-date') return [] as Array<{ key: string; label: string; todos: TodoItem[] }>;
    const hideCompleted = snapshot.preferences.hideCompleted;
    const base = hideCompleted
      ? filteredBySearch.filter((todo) => !todo.completed)
      : filteredBySearch;
    const sorted = [...base].sort((a, b) => b.createdAt - a.createdAt);
    const map = new Map<string, { label: string; todos: TodoItem[] }>();
    for (const todo of sorted) {
      const key = dayKey(todo.createdAt);
      const entry = map.get(key);
      if (entry) {
        entry.todos.push(todo);
      } else {
        map.set(key, { label: formatDay(todo.createdAt), todos: [todo] });
      }
    }
    return Array.from(map.entries()).map(([key, value]) => ({ key, ...value }));
  }, [filteredBySearch, snapshot.preferences.hideCompleted, tab]);

  async function handleToggleMaximize() {
    try {
      await CURRENT_WINDOW.toggleMaximize();
      setIsMaximized(await CURRENT_WINDOW.isMaximized());
    } catch (error) {
      console.error(error);
    }
  }

  async function handleMinimize() {
    try {
      await CURRENT_WINDOW.minimize();
    } catch (error) {
      console.error(error);
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    if (sort !== 'created-desc') return;
    const visibleIds = allList.map((todo) => todo.id);
    const oldIndex = visibleIds.indexOf(String(active.id));
    const newIndex = visibleIds.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(visibleIds, oldIndex, newIndex);
    const hiddenActive = activeTodos
      .filter((todo) => !reordered.includes(todo.id))
      .map((todo) => todo.id);
    await onReorderTodos([...reordered, ...hiddenActive]);
  }

  async function handleExport() {
    try {
      const path = await saveDialog({
        title: '导出全部待办',
        defaultPath: defaultExportName(),
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (!path) return;
      await onExportTodos(path);
    } catch (error) {
      console.error(error);
    }
  }

  async function handleImport() {
    try {
      const path = await openDialog({
        title: '选择备份文件',
        multiple: false,
        directory: false,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (!path || Array.isArray(path)) return;
      await onImportTodos(path, importMode);
    } catch (error) {
      console.error(error);
    }
  }

  function handleRestoreAll() {
    for (const todo of trashedTodos) {
      void onRestoreTodo(todo.id);
    }
  }

  function handleConfirmEmpty() {
    if (trashedTodos.length === 0) return;
    const ok = window.confirm(`确定要永久删除 ${trashedTodos.length} 条待办？此操作不可撤销。`);
    if (!ok) return;
    void onEmptyTrash();
  }

  const showToolbar = tab === 'all' || tab === 'by-date' || tab === 'completed';
  const draggableEnabled = tab === 'all' && sort === 'created-desc' && !search.trim();

  function renderRow(todo: TodoItem, options: { draggable: boolean }) {
    return (
      <TodoCard
        key={todo.id}
        todo={todo}
        draggable={options.draggable}
        onToggleCompleted={onToggleCompleted}
        onDelete={onDeleteTodo}
        onSave={onUpdateTodo}
      />
    );
  }

  function renderAllTab() {
    if (allList.length === 0) {
      return (
        <div className="empty-state">
          <div className="empty-state__icon">
            <Inbox size={18} />
          </div>
          <div>
            <h3>{search ? '没有找到匹配项' : '暂无待办'}</h3>
            <p>{search ? '换个关键词试试，或清空搜索框。' : '点击左上「新建」即可添加第一条。'}</p>
          </div>
        </div>
      );
    }
    if (draggableEnabled) {
      return (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext
            items={allList.map((todo) => todo.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="manage-list">
              <AnimatePresence initial={false}>
                {allList.map((todo) => renderRow(todo, { draggable: true }))}
              </AnimatePresence>
            </div>
          </SortableContext>
        </DndContext>
      );
    }
    return (
      <div className="manage-list">
        <AnimatePresence initial={false}>
          {allList.map((todo) => renderRow(todo, { draggable: false }))}
        </AnimatePresence>
      </div>
    );
  }

  function renderDateTab() {
    if (dateGroups.length === 0) {
      return (
        <div className="empty-state">
          <div className="empty-state__icon">
            <CalendarDays size={18} />
          </div>
          <div>
            <h3>没有符合条件的记录</h3>
            <p>当前分组为空，试试调整搜索词或取消隐藏已完成。</p>
          </div>
        </div>
      );
    }
    return (
      <div className="date-group-stack">
        {dateGroups.map((group) => (
          <section key={group.key} className="date-group">
            <header className="date-group__header">
              <CalendarDays size={13} />
              <h3>{group.label}</h3>
              <span className="count">{group.todos.length}</span>
            </header>
            <div className="manage-list">
              <AnimatePresence initial={false}>
                {group.todos.map((todo) => renderRow(todo, { draggable: false }))}
              </AnimatePresence>
            </div>
          </section>
        ))}
      </div>
    );
  }

  function renderCompletedTab() {
    if (completedList.length === 0) {
      return (
        <div className="empty-state">
          <div className="empty-state__icon">
            <CheckCircle2 size={18} />
          </div>
          <div>
            <h3>还没有已完成的待办</h3>
            <p>勾选某条待办后它会出现在这里。</p>
          </div>
        </div>
      );
    }
    return (
      <div className="manage-list">
        <AnimatePresence initial={false}>
          {completedList.map((todo) => renderRow(todo, { draggable: false }))}
        </AnimatePresence>
      </div>
    );
  }

  function renderTrashTab() {
    return (
      <div className="trash-wrap">
        <div className="trash-actions">
          <div>
            <h3>回收站</h3>
            <p>
              已软删除 {trashedTodos.length} 条，超过 {snapshot.preferences.trashRetentionDays}{' '}
              天的条目下次启动时会被自动清理。
            </p>
          </div>
          <div className="trash-actions__buttons">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={trashedTodos.length === 0}
              onClick={handleRestoreAll}
            >
              <Undo2 size={14} />
              全部恢复
            </button>
            <button
              type="button"
              className="btn btn--danger btn--sm"
              disabled={trashedTodos.length === 0}
              onClick={handleConfirmEmpty}
            >
              <Trash2 size={14} />
              清空回收站
            </button>
          </div>
        </div>

        {trashedTodos.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state__icon">
              <Trash2 size={18} />
            </div>
            <div>
              <h3>回收站是空的</h3>
              <p>误删的待办会先进入这里，可随时恢复或彻底删除。</p>
            </div>
          </div>
        ) : (
          <div className="trash-list">
            {trashedTodos.map((todo) => (
              <article key={todo.id} className="trash-row">
                <div className="trash-row__body">
                  <p className="trash-row__content">{todo.content}</p>
                  <div className="trash-row__meta">
                    <span>删除于 {formatRelative(todo.deletedAt)}</span>
                    <span>·</span>
                    <span>创建于 {formatStamp(todo.createdAt)}</span>
                  </div>
                </div>
                <div className="trash-row__actions">
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => void onRestoreTodo(todo.id)}
                  >
                    <RotateCcw size={13} />
                    恢复
                  </button>
                  <button
                    type="button"
                    className="btn btn--danger btn--sm"
                    onClick={() => void onPurgeTodo(todo.id)}
                  >
                    <Trash2 size={13} />
                    彻底删除
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    );
  }

  function renderIoTab() {
    return (
      <section className="settings-section">
        <div className="settings-section-head">
          <h2>导入导出</h2>
          <p>手动备份或迁移你的全部待办与偏好。回收站内容也会一并包含。</p>
        </div>

        <div className="settings-row">
          <div className="settings-row__title">
            <h3>导出 JSON</h3>
            <p>保存当前数据快照，包含已删除与偏好设置。</p>
          </div>
          <div className="settings-row__control">
            <button type="button" className="btn btn--primary btn--sm" onClick={handleExport}>
              <Download size={14} />
              选择位置并导出
            </button>
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-row__title">
            <h3>导入策略</h3>
            <p>合并按 ID 比较更新时间；替换会整体覆盖当前数据，慎用。</p>
          </div>
          <div className="settings-row__control">
            <div className="segmented">
              <button
                type="button"
                className={`segmented__item ${importMode === 'merge' ? 'is-active' : ''}`}
                onClick={() => setImportMode('merge')}
              >
                合并
              </button>
              <button
                type="button"
                className={`segmented__item ${importMode === 'replace' ? 'is-active' : ''}`}
                onClick={() => setImportMode('replace')}
              >
                替换
              </button>
            </div>
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-row__title">
            <h3>从文件导入</h3>
            <p>选择之前导出的 JSON 文件，会按上方策略同步。</p>
          </div>
          <div className="settings-row__control">
            <button type="button" className="btn btn--ghost btn--sm" onClick={handleImport}>
              <Upload size={14} />
              选择文件
            </button>
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-row__title">
            <h3>回收站保留天数</h3>
            <p>超过此天数的软删除项将在下次启动时被清理。</p>
          </div>
          <div className="settings-row__control">
            <div className="segmented">
              {RETENTION_PRESETS.map((days) => (
                <button
                  key={days}
                  type="button"
                  className={`segmented__item ${draftRetention === days ? 'is-active' : ''}`}
                  onClick={() => setDraftRetention(days)}
                >
                  {days}
                </button>
              ))}
            </div>
            <input
              type="number"
              className="number-input"
              min={7}
              max={365}
              value={draftRetention}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (!Number.isFinite(next)) return;
                setDraftRetention(Math.max(7, Math.min(365, Math.round(next))));
              }}
            />
          </div>
        </div>
      </section>
    );
  }

  const activeContent = (() => {
    switch (tab) {
      case 'all':
        return renderAllTab();
      case 'by-date':
        return renderDateTab();
      case 'completed':
        return renderCompletedTab();
      case 'trash':
        return renderTrashTab();
      case 'io':
        return renderIoTab();
      default:
        return null;
    }
  })();

  const counts: Record<ManageTab, number> = {
    all: activeTodos.length,
    'by-date': activeTodos.length,
    completed: completedCount,
    trash: trashedTodos.length,
    io: 0,
  };

  return (
    <main className="settings-shell manage-shell">
      <header className="settings-header" data-tauri-drag-region>
        <h1 data-tauri-drag-region>代办管理</h1>
        <div className="settings-header__actions" data-tauri-drag-region="false">
          <button
            className="btn btn--icon btn--sm window-btn"
            type="button"
            onClick={() => void handleMinimize()}
            title="最小化"
            aria-label="最小化"
          >
            <Minus size={14} />
          </button>
          <button
            className="btn btn--icon btn--sm window-btn"
            type="button"
            onClick={() => void handleToggleMaximize()}
            title={isMaximized ? '还原' : '最大化'}
            aria-label={isMaximized ? '还原' : '最大化'}
          >
            <Square size={12} strokeWidth={2} />
          </button>
          <button
            className="btn btn--icon btn--sm window-btn window-btn--close"
            type="button"
            onClick={() => void onClose()}
            title="关闭"
            aria-label="关闭"
          >
            <X size={15} />
          </button>
        </div>
      </header>

      <div className="settings-layout">
        <aside className="settings-sidebar">
          <div>
            <div className="sidebar-section-title">分类</div>
            <nav className="settings-nav">
              {TABS.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  type="button"
                  className={`settings-nav__item ${tab === key ? 'is-active' : ''}`}
                  onClick={() => setTab(key)}
                >
                  <Icon size={15} />
                  <span>{label}</span>
                  {key !== 'io' && counts[key] > 0 ? (
                    <span className="settings-nav__count">{counts[key]}</span>
                  ) : null}
                </button>
              ))}
            </nav>
          </div>

          <div>
            <div className="sidebar-section-title">概览</div>
            <div className="stats-block">
              <div className="stats-row">
                <span>活跃总数</span>
                <strong>{activeTodos.length}</strong>
              </div>
              <div className="stats-row">
                <span>未完成</span>
                <strong>{pendingCount}</strong>
              </div>
              <div className="stats-row">
                <span>已完成</span>
                <strong>{completedCount}</strong>
              </div>
              <div className="stats-row">
                <span>回收站</span>
                <strong>{trashedTodos.length}</strong>
              </div>
              <div className="stats-row">
                <span>保留天数</span>
                <strong>{snapshot.preferences.trashRetentionDays}</strong>
              </div>
            </div>
          </div>
        </aside>

        <div className="settings-content manage-content">
          {showToolbar ? (
            <div className="manage-toolbar">
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={() => openComposer(true)}
              >
                <Plus size={14} />
                新建
              </button>
              <div className="manage-toolbar__search">
                <Search size={13} />
                <input
                  type="text"
                  placeholder="搜索内容..."
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                {search ? (
                  <button
                    type="button"
                    className="manage-toolbar__clear"
                    onClick={() => setSearch('')}
                    aria-label="清除搜索"
                  >
                    <X size={12} />
                  </button>
                ) : null}
              </div>
              <select
                className="manage-toolbar__sort"
                value={sort}
                onChange={(event) => setSort(event.target.value as ManageSort)}
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={`btn btn--ghost btn--sm ${
                  snapshot.preferences.hideCompleted ? 'is-active' : ''
                }`}
                onClick={() =>
                  void onPatchPreferences({
                    hideCompleted: !snapshot.preferences.hideCompleted,
                  })
                }
                title="切换隐藏已完成"
              >
                <RefreshCw size={13} />
                {snapshot.preferences.hideCompleted ? '已隐藏完成' : '显示全部'}
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={handleExport}
                title="快速导出"
              >
                <ArrowUpFromLine size={13} />
                快速导出
              </button>
            </div>
          ) : null}

          {showToolbar ? (
            <div className="manage-composer-wrap">
              <AnimatePresence initial={false}>
                {composerOpen ? (
                  <motion.div
                    key="manage-composer"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                    style={{ overflow: 'hidden' }}
                  >
                    <TodoComposer
                      focusToken={composerFocusToken}
                      onCreate={async (content, color, textColor, recurrence) => {
                        await onCreateTodo(content, color, textColor, recurrence);
                      }}
                      onClose={closeComposer}
                    />
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          ) : null}

          <div className="manage-panel">{activeContent}</div>
        </div>
      </div>
    </main>
  );
}
