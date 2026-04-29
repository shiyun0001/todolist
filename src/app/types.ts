export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';
export type CloseBehavior = 'tray' | 'exit';
export type StartupVisibility = 'remember' | 'always_visible' | 'tray';
export type ImportMode = 'merge' | 'replace';
export type RecurrenceFrequency = 'daily' | 'weekdays' | 'weekends' | 'weekly' | 'every-n-days';

export interface RecurrenceRule {
  frequency: RecurrenceFrequency;
  daysOfWeek: number[];
  interval: number;
}

export interface TodoItem {
  id: string;
  content: string;
  completed: boolean;
  color: string;
  textColor: string;
  order: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  recurrence: RecurrenceRule | null;
  lastCompletedAt: number | null;
}

export interface AppPreferences {
  themeMode: ThemeMode;
  alwaysOnTop: boolean;
  clickThrough: boolean;
  hideCompleted: boolean;
  widgetWidth: number;
  widgetHeight: number;
  widgetX: number | null;
  widgetY: number | null;
  surfaceOpacity: number;
  autostartEnabled: boolean;
  startupVisibility: StartupVisibility;
  closeBehavior: CloseBehavior;
  lastWindowVisible: boolean;
  trashRetentionDays: number;
  lastCollapsed: boolean;
  collapsedWidth: number;
  collapsedHeight: number;
  tzOffsetMinutes: number;
}

export interface AppSnapshot {
  preferences: AppPreferences;
  todos: TodoItem[];
}
