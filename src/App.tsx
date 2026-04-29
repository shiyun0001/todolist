import { startTransition, useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Info } from 'lucide-react';

import { useAppStore } from './app/store';
import {
  CURRENT_WINDOW,
  CURRENT_WINDOW_LABEL,
  applyWidgetPreferences,
  createTodo,
  deleteTodo,
  emptyTrash,
  exportTodos,
  getSystemTheme,
  hideWidgetWindow,
  importTodos,
  loadAppState,
  onBackendError,
  onFocusNewTodo,
  onStateSync,
  onWindowThemeChanged,
  openManageWindow,
  openSettingsWindow,
  purgeTodo,
  reorderTodos,
  restoreTodo,
  setClickThrough,
  setTodoCompleted,
  showWidgetWindow,
  syncTimezone,
  updateTodo,
} from './app/tauri';
import type {
  AppPreferences,
  AppSnapshot,
  ImportMode,
  RecurrenceRule,
  ResolvedTheme,
  TodoItem,
} from './app/types';
import { SettingsView } from './components/SettingsView';
import { ManageView } from './components/ManageView';
import { WidgetView } from './components/WidgetView';

function describeError(error: unknown) {
  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object' && 'toString' in error) {
    return error.toString();
  }

  return '操作没有成功完成，请稍后再试。';
}

function resolveTheme(
  preferences: AppPreferences | null,
  systemTheme: ResolvedTheme,
): ResolvedTheme {
  if (!preferences || preferences.themeMode === 'system') {
    return systemTheme;
  }
  return preferences.themeMode;
}

function LoadingFallback() {
  return (
    <main className="loading-shell">
      <div className="loading-card">
        <p className="eyebrow">SYNCING</p>
        <h1>正在同步桌面状态</h1>
        <span className="loading-line" />
      </div>
    </main>
  );
}

function Toast({ message }: { message: string }) {
  return (
    <motion.div
      className="toast"
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.98 }}
      transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
    >
      <Info size={15} className="toast__icon" />
      <span>{message}</span>
    </motion.div>
  );
}

export default function App() {
  const snapshot = useAppStore((store) => store.snapshot);
  const systemTheme = useAppStore((store) => store.systemTheme);
  const status = useAppStore((store) => store.status);
  const composerOpen = useAppStore((store) => store.composerOpen);
  const composerFocusToken = useAppStore((store) => store.composerFocusToken);
  const widgetCollapsed = useAppStore((store) => store.widgetCollapsed);
  const setSnapshot = useAppStore((store) => store.setSnapshot);
  const setSystemTheme = useAppStore((store) => store.setSystemTheme);
  const setStatus = useAppStore((store) => store.setStatus);
  const openComposer = useAppStore((store) => store.openComposer);
  const closeComposer = useAppStore((store) => store.closeComposer);
  const toggleWidgetCollapsed = useAppStore((store) => store.toggleWidgetCollapsed);
  const setWidgetCollapsed = useAppStore((store) => store.setWidgetCollapsed);

  useEffect(() => {
    if (CURRENT_WINDOW_LABEL !== 'widget') return;
    if (!snapshot) return;
    if (snapshot.preferences.lastCollapsed !== widgetCollapsed) {
      setWidgetCollapsed(snapshot.preferences.lastCollapsed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot?.preferences.lastCollapsed]);

  function syncSnapshot(nextSnapshot: AppSnapshot) {
    startTransition(() => {
      setSnapshot(nextSnapshot);
    });
  }

  function showError(error: unknown) {
    setStatus(describeError(error));
  }

  useEffect(() => {
    let mounted = true;
    const disposers: Array<() => void> = [];

    async function bootstrap() {
      try {
        const [initialSnapshot, theme] = await Promise.all([loadAppState(), getSystemTheme()]);
        if (!mounted) {
          return;
        }

        const tzOffset = -new Date().getTimezoneOffset();
        if (initialSnapshot.preferences.tzOffsetMinutes !== tzOffset) {
          void syncTimezone(tzOffset).catch((error) => console.error('syncTimezone failed', error));
        }

        startTransition(() => {
          setSnapshot(initialSnapshot);
        });
        setSystemTheme(theme);

        disposers.push(
          await onStateSync((nextSnapshot) => {
            startTransition(() => {
              setSnapshot(nextSnapshot);
            });
          }),
        );
        disposers.push(await onBackendError((message) => setStatus(message)));
        disposers.push(await onWindowThemeChanged((nextTheme) => setSystemTheme(nextTheme)));

        if (CURRENT_WINDOW_LABEL === 'widget') {
          disposers.push(
            await onFocusNewTodo(() => {
              openComposer(true);
            }),
          );
        }
      } catch (error) {
        if (mounted) {
          setStatus(describeError(error));
        }
      }
    }

    void bootstrap();

    return () => {
      mounted = false;
      for (const dispose of disposers) {
        dispose();
      }
    };
  }, [openComposer, setSnapshot, setStatus, setSystemTheme]);

  useEffect(() => {
    if (!status) {
      return;
    }

    const timer = window.setTimeout(() => setStatus(null), 3200);
    return () => window.clearTimeout(timer);
  }, [setStatus, status]);

  useEffect(() => {
    const resolved = resolveTheme(snapshot?.preferences ?? null, systemTheme);
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.window = CURRENT_WINDOW_LABEL;
    const opacity = snapshot?.preferences.surfaceOpacity ?? 0.9;
    document.documentElement.style.setProperty('--surface-alpha', `${opacity}`);
    const cardAlpha = Math.max(0.3, opacity - 0.35);
    document.documentElement.style.setProperty('--card-alpha', `${cardAlpha}`);
    const blur = Math.round(12 + (1 - opacity) * 40);
    document.documentElement.style.setProperty('--blur-strength', `${blur}px`);
  }, [snapshot?.preferences, systemTheme]);

  async function replacePreferences(nextPreferences: AppPreferences) {
    try {
      const nextSnapshot = await applyWidgetPreferences(nextPreferences);
      syncSnapshot(nextSnapshot);
    } catch (error) {
      showError(error);
    }
  }

  async function patchPreferences(patch: Partial<AppPreferences>) {
    if (!snapshot) {
      return;
    }

    try {
      const nextSnapshot =
        Object.keys(patch).length === 1 && Object.hasOwn(patch, 'clickThrough')
          ? await setClickThrough(Boolean(patch.clickThrough))
          : await applyWidgetPreferences({
              ...snapshot.preferences,
              ...patch,
            });

      syncSnapshot(nextSnapshot);
    } catch (error) {
      showError(error);
    }
  }

  async function handleCreateTodo(
    content: string,
    color: string,
    textColor: string,
    recurrence: RecurrenceRule | null = null,
  ) {
    try {
      const nextSnapshot = await createTodo(content, color, textColor, recurrence);
      syncSnapshot(nextSnapshot);
      openComposer(true);
    } catch (error) {
      showError(error);
    }
  }

  async function handleToggleCompleted(id: string, completed: boolean) {
    try {
      const nextSnapshot = await setTodoCompleted(id, completed);
      syncSnapshot(nextSnapshot);
    } catch (error) {
      showError(error);
    }
  }

  async function handleDeleteTodo(id: string) {
    try {
      const nextSnapshot = await deleteTodo(id);
      syncSnapshot(nextSnapshot);
    } catch (error) {
      showError(error);
    }
  }

  async function handleUpdateTodo(todo: TodoItem) {
    try {
      const nextSnapshot = await updateTodo(todo);
      syncSnapshot(nextSnapshot);
    } catch (error) {
      showError(error);
    }
  }

  async function handleReorderTodos(orderedIds: string[]) {
    try {
      const nextSnapshot = await reorderTodos(orderedIds);
      syncSnapshot(nextSnapshot);
    } catch (error) {
      showError(error);
    }
  }

  async function handleOpenSettings() {
    try {
      await openSettingsWindow();
    } catch (error) {
      showError(error);
    }
  }

  async function handleOpenManage() {
    try {
      await openManageWindow();
    } catch (error) {
      showError(error);
    }
  }

  async function handleRestoreTodo(id: string) {
    try {
      const nextSnapshot = await restoreTodo(id);
      syncSnapshot(nextSnapshot);
    } catch (error) {
      showError(error);
    }
  }

  async function handlePurgeTodo(id: string) {
    try {
      const nextSnapshot = await purgeTodo(id);
      syncSnapshot(nextSnapshot);
    } catch (error) {
      showError(error);
    }
  }

  async function handleEmptyTrash() {
    try {
      const nextSnapshot = await emptyTrash();
      syncSnapshot(nextSnapshot);
    } catch (error) {
      showError(error);
    }
  }

  async function handleExportTodos(path: string) {
    try {
      await exportTodos(path);
      setStatus('导出成功');
    } catch (error) {
      showError(error);
    }
  }

  async function handleImportTodos(path: string, mode: ImportMode) {
    try {
      const nextSnapshot = await importTodos(path, mode);
      syncSnapshot(nextSnapshot);
      setStatus(mode === 'replace' ? '替换导入完成' : '合并导入完成');
    } catch (error) {
      showError(error);
    }
  }

  async function handleHideWidget() {
    try {
      await hideWidgetWindow();
    } catch (error) {
      showError(error);
    }
  }

  async function handleShowWidget() {
    try {
      await showWidgetWindow();
    } catch (error) {
      showError(error);
    }
  }

  async function handleCloseSettings() {
    try {
      await CURRENT_WINDOW.close();
    } catch (error) {
      showError(error);
    }
  }

  const toastLayer = (
    <div className="toast-stack" aria-live="polite">
      <AnimatePresence>{status ? <Toast key={status} message={status} /> : null}</AnimatePresence>
    </div>
  );

  if (!snapshot) {
    return (
      <>
        <LoadingFallback />
        {toastLayer}
      </>
    );
  }

  if (CURRENT_WINDOW_LABEL === 'settings') {
    return (
      <>
        <SettingsView
          snapshot={snapshot}
          onClose={handleCloseSettings}
          onShowWidget={handleShowWidget}
          onPatchPreferences={patchPreferences}
          onReplacePreferences={replacePreferences}
        />
        {toastLayer}
      </>
    );
  }

  if (CURRENT_WINDOW_LABEL === 'manage') {
    return (
      <>
        <ManageView
          snapshot={snapshot}
          onClose={handleCloseSettings}
          onPatchPreferences={patchPreferences}
          onCreateTodo={handleCreateTodo}
          onToggleCompleted={handleToggleCompleted}
          onDeleteTodo={handleDeleteTodo}
          onUpdateTodo={handleUpdateTodo}
          onReorderTodos={handleReorderTodos}
          onRestoreTodo={handleRestoreTodo}
          onPurgeTodo={handlePurgeTodo}
          onEmptyTrash={handleEmptyTrash}
          onExportTodos={handleExportTodos}
          onImportTodos={handleImportTodos}
        />
        {toastLayer}
      </>
    );
  }

  return (
    <>
      <WidgetView
        snapshot={snapshot}
        composerOpen={composerOpen}
        composerFocusToken={composerFocusToken}
        collapsed={widgetCollapsed}
        onToggleCollapsed={toggleWidgetCollapsed}
        onRequestNewTodo={() => openComposer(true)}
        onCloseComposer={closeComposer}
        onOpenSettings={handleOpenSettings}
        onOpenManage={handleOpenManage}
        onHideWidget={handleHideWidget}
        onCreateTodo={handleCreateTodo}
        onToggleCompleted={handleToggleCompleted}
        onDeleteTodo={handleDeleteTodo}
        onUpdateTodo={handleUpdateTodo}
        onReorderTodos={handleReorderTodos}
        onToggleHideCompleted={() =>
          patchPreferences({
            hideCompleted: !snapshot.preferences.hideCompleted,
          })
        }
      />
      {toastLayer}
    </>
  );
}
