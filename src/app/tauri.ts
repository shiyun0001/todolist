import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';

import type {
  AppPreferences,
  AppSnapshot,
  ImportMode,
  RecurrenceRule,
  ResolvedTheme,
  TodoItem,
} from './types';

export const CURRENT_WINDOW = getCurrentWindow();
export const CURRENT_WINDOW_LABEL = CURRENT_WINDOW.label;

export async function loadAppState() {
  return invoke<AppSnapshot>('load_app_state');
}

export async function showWidgetWindow() {
  return invoke<boolean>('show_widget_window');
}

export async function hideWidgetWindow() {
  return invoke<boolean>('hide_widget_window');
}

export async function toggleWidgetWindow() {
  return invoke<boolean>('toggle_widget_window');
}

export async function openSettingsWindow() {
  return invoke<void>('open_settings_window');
}

export async function openManageWindow() {
  return invoke<void>('open_manage_window');
}

export async function applyWidgetPreferences(preferences: AppPreferences) {
  return invoke<AppSnapshot>('apply_widget_preferences', { preferences });
}

export async function setClickThrough(enabled: boolean) {
  return invoke<AppSnapshot>('set_click_through', { enabled });
}

export async function setNotTopmost() {
  return invoke<void>('set_not_topmost');
}

export async function createTodo(
  content: string,
  color: string,
  textColor: string,
  recurrence: RecurrenceRule | null = null,
) {
  return invoke<AppSnapshot>('create_todo', { content, color, textColor, recurrence });
}

export async function updateTodo(todo: TodoItem) {
  return invoke<AppSnapshot>('update_todo', { todo });
}

export async function deleteTodo(id: string) {
  return invoke<AppSnapshot>('delete_todo', { id });
}

export async function restoreTodo(id: string) {
  return invoke<AppSnapshot>('restore_todo', { id });
}

export async function purgeTodo(id: string) {
  return invoke<AppSnapshot>('purge_todo', { id });
}

export async function emptyTrash() {
  return invoke<AppSnapshot>('empty_trash');
}

export async function exportTodos(path: string) {
  return invoke<void>('export_todos', { path });
}

export async function importTodos(path: string, mode: ImportMode) {
  return invoke<AppSnapshot>('import_todos', { path, mode });
}

export async function setTodoCompleted(id: string, completed: boolean) {
  return invoke<AppSnapshot>('set_todo_completed', { id, completed });
}

export async function reorderTodos(orderedIds: string[]) {
  return invoke<AppSnapshot>('reorder_todos', { orderedIds });
}

export async function syncTimezone(offsetMinutes: number) {
  return invoke<AppSnapshot>('sync_timezone', { offsetMinutes });
}

export async function getSystemTheme(): Promise<ResolvedTheme> {
  const theme = await CURRENT_WINDOW.theme();
  return theme === 'dark' ? 'dark' : 'light';
}

export async function resizeCurrentWindow(width: number, height: number) {
  await CURRENT_WINDOW.setSize(new LogicalSize(Math.round(width), Math.round(height)));
}

export async function getCurrentInnerSize() {
  return CURRENT_WINDOW.innerSize();
}

export async function onStateSync(handler: (snapshot: AppSnapshot) => void): Promise<UnlistenFn> {
  return listen<AppSnapshot>('todo://state-sync', (event) => handler(event.payload));
}

export async function onFocusNewTodo(handler: () => void): Promise<UnlistenFn> {
  return listen('todo://focus-new-todo', () => handler());
}

export async function onBackendError(handler: (message: string) => void): Promise<UnlistenFn> {
  return listen<string>('todo://error', (event) => handler(event.payload));
}

export async function onWindowThemeChanged(handler: (theme: ResolvedTheme) => void): Promise<UnlistenFn> {
  return CURRENT_WINDOW.onThemeChanged(({ payload }) => handler(payload === 'dark' ? 'dark' : 'light'));
}
