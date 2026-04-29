import { useEffect, useState } from 'react';
import {
  AppWindow,
  ArrowUpRight,
  Eye,
  EyeOff,
  Info,
  Keyboard,
  Minus,
  Palette,
  Pin,
  Power,
  ScanLine,
  Square,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

import { CURRENT_WINDOW } from '../app/tauri';
import type { AppPreferences, AppSnapshot, ThemeMode } from '../app/types';

interface SettingsViewProps {
  snapshot: AppSnapshot;
  onClose: () => Promise<void>;
  onShowWidget: () => Promise<void>;
  onPatchPreferences: (patch: Partial<AppPreferences>) => Promise<void>;
  onReplacePreferences: (preferences: AppPreferences) => Promise<void>;
}

type TabKey = 'appearance' | 'behavior' | 'startup' | 'shortcuts' | 'about';

const TABS: Array<{ key: TabKey; label: string; icon: typeof Palette }> = [
  { key: 'appearance', label: '外观', icon: Palette },
  { key: 'behavior', label: '桌面行为', icon: AppWindow },
  { key: 'startup', label: '启动与常驻', icon: Power },
  { key: 'shortcuts', label: '快捷键', icon: Keyboard },
  { key: 'about', label: '关于', icon: Info },
];

const SIZE_PRESETS = [
  { label: '紧凑', width: 420, height: 560 },
  { label: '标准', width: 460, height: 680 },
  { label: '舒展', width: 520, height: 760 },
];

const OPACITY_PRESETS = [
  { label: '100%', value: 1 },
  { label: '92%', value: 0.92 },
  { label: '84%', value: 0.84 },
  { label: '76%', value: 0.76 },
];

interface ToggleProps {
  active: boolean;
  onClick: () => void;
  label: string;
}

function Toggle({ active, onClick, label }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      aria-label={label}
      className={`toggle-switch ${active ? 'is-active' : ''}`}
      onClick={onClick}
    >
      <span className="toggle-switch__thumb" />
    </button>
  );
}

export function SettingsView({
  snapshot,
  onClose,
  onShowWidget,
  onPatchPreferences,
  onReplacePreferences,
}: SettingsViewProps) {
  const [tab, setTab] = useState<TabKey>('appearance');
  const [draftWidth, setDraftWidth] = useState(snapshot.preferences.widgetWidth);
  const [draftHeight, setDraftHeight] = useState(snapshot.preferences.widgetHeight);
  const [draftOpacity, setDraftOpacity] = useState(snapshot.preferences.surfaceOpacity);
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let active = true;
    CURRENT_WINDOW.isMaximized()
      .then((value) => {
        if (active) setIsMaximized(value);
      })
      .catch(() => {
        /* ignore, fall back to false */
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleMinimize() {
    try {
      await CURRENT_WINDOW.minimize();
    } catch (error) {
      console.error(error);
    }
  }

  async function handleToggleMaximize() {
    try {
      await CURRENT_WINDOW.toggleMaximize();
      const value = await CURRENT_WINDOW.isMaximized();
      setIsMaximized(value);
    } catch (error) {
      console.error(error);
    }
  }

  useEffect(() => {
    setDraftWidth(snapshot.preferences.widgetWidth);
    setDraftHeight(snapshot.preferences.widgetHeight);
    setDraftOpacity(snapshot.preferences.surfaceOpacity);
  }, [
    snapshot.preferences.widgetWidth,
    snapshot.preferences.widgetHeight,
    snapshot.preferences.surfaceOpacity,
  ]);

  useEffect(() => {
    const nextPreferences = snapshot.preferences;
    if (
      Math.round(draftWidth) === Math.round(nextPreferences.widgetWidth) &&
      Math.round(draftHeight) === Math.round(nextPreferences.widgetHeight) &&
      Math.abs(draftOpacity - nextPreferences.surfaceOpacity) < 0.005
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      void onReplacePreferences({
        ...nextPreferences,
        widgetWidth: draftWidth,
        widgetHeight: draftHeight,
        surfaceOpacity: draftOpacity,
      });
    }, 180);

    return () => window.clearTimeout(timer);
  }, [draftHeight, draftOpacity, draftWidth, onReplacePreferences, snapshot.preferences]);

  function renderThemeTab() {
    return (
      <section className="settings-section">
        <div className="settings-section-head">
          <h2>外观</h2>
          <p>主题、透明度与主窗尺寸，所有修改即时生效。</p>
        </div>

        <div className="settings-row">
          <div className="settings-row__title">
            <h3>主题模式</h3>
            <p>提供浅色、深色和跟随系统三种模式。</p>
          </div>
          <div className="settings-row__control">
            <div className="segmented">
              {(['system', 'light', 'dark'] as ThemeMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`segmented__item ${
                    snapshot.preferences.themeMode === mode ? 'is-active' : ''
                  }`}
                  onClick={() => void onPatchPreferences({ themeMode: mode })}
                >
                  {mode === 'system' ? '跟随系统' : mode === 'light' ? '浅色' : '深色'}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-row__title">
            <h3>表面不透明度</h3>
            <p>调节小组件面板透明度，对托盘菜单不生效。</p>
          </div>
          <div className="settings-row__control">
            <div className="slider-stack">
              <input
                type="range"
                min={0.55}
                max={1}
                step={0.02}
                value={draftOpacity}
                onChange={(event) => setDraftOpacity(Number(event.target.value))}
              />
              <span className="slider-readout">{Math.round(draftOpacity * 100)}%</span>
              <div className="preset-row">
                {OPACITY_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => setDraftOpacity(preset.value)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-row__title">
            <h3>窗口尺寸</h3>
            <p>也可以在托盘右键菜单快速切换预设。</p>
          </div>
          <div className="settings-row__control">
            <div className="size-controls">
              <label className="size-controls__field">
                宽
                <input
                  type="number"
                  className="number-input"
                  min={360}
                  max={760}
                  value={Math.round(draftWidth)}
                  onChange={(event) => setDraftWidth(Number(event.target.value))}
                />
              </label>
              <label className="size-controls__field">
                高
                <input
                  type="number"
                  className="number-input"
                  min={420}
                  max={980}
                  value={Math.round(draftHeight)}
                  onChange={(event) => setDraftHeight(Number(event.target.value))}
                />
              </label>
            </div>
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-row__title">
            <h3>尺寸预设</h3>
            <p>快速套用紧凑 / 标准 / 舒展三档。</p>
          </div>
          <div className="settings-row__control">
            <div className="preset-row">
              {SIZE_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => {
                    setDraftWidth(preset.width);
                    setDraftHeight(preset.height);
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    );
  }

  function renderBehaviorTab() {
    return (
      <section className="settings-section">
        <div className="settings-section-head">
          <h2>桌面行为</h2>
          <p>控制主窗如何与 Windows 桌面交互。托盘菜单与这里保持同步。</p>
        </div>

        <div className="settings-row">
          <div className="settings-row__title">
            <h3>始终置顶</h3>
            <p>默认关闭，以规避 Windows 多桌面切换时跑到顶层的问题。</p>
          </div>
          <div className="settings-row__control">
            <Pin size={14} style={{ color: 'var(--text-muted)' }} />
            <Toggle
              active={snapshot.preferences.alwaysOnTop}
              label="始终置顶"
              onClick={() =>
                void onPatchPreferences({ alwaysOnTop: !snapshot.preferences.alwaysOnTop })
              }
            />
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-row__title">
            <h3>窗口穿透</h3>
            <p>开启后主窗不再接收鼠标事件，可随时从托盘关闭。</p>
          </div>
          <div className="settings-row__control">
            <ScanLine size={14} style={{ color: 'var(--text-muted)' }} />
            <Toggle
              active={snapshot.preferences.clickThrough}
              label="窗口穿透"
              onClick={() =>
                void onPatchPreferences({ clickThrough: !snapshot.preferences.clickThrough })
              }
            />
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-row__title">
            <h3>隐藏已完成</h3>
            <p>主窗只显示未完成事项，已完成事项可从底部入口快速展开。</p>
          </div>
          <div className="settings-row__control">
            {snapshot.preferences.hideCompleted ? (
              <EyeOff size={14} style={{ color: 'var(--text-muted)' }} />
            ) : (
              <Eye size={14} style={{ color: 'var(--text-muted)' }} />
            )}
            <Toggle
              active={snapshot.preferences.hideCompleted}
              label="隐藏已完成"
              onClick={() =>
                void onPatchPreferences({ hideCompleted: !snapshot.preferences.hideCompleted })
              }
            />
          </div>
        </div>
      </section>
    );
  }

  function renderStartupTab() {
    return (
      <section className="settings-section">
        <div className="settings-section-head">
          <h2>启动与常驻</h2>
          <p>开机启动、启动可见策略和关闭行为。</p>
        </div>

        <div className="settings-row">
          <div className="settings-row__title">
            <h3>开机自启动</h3>
            <p>启用后会根据上次窗口可见状态决定是直接显示还是后台托盘启动。</p>
          </div>
          <div className="settings-row__control">
            <Power size={14} style={{ color: 'var(--text-muted)' }} />
            <Toggle
              active={snapshot.preferences.autostartEnabled}
              label="开机自启动"
              onClick={() =>
                void onPatchPreferences({
                  autostartEnabled: !snapshot.preferences.autostartEnabled,
                })
              }
            />
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-row__title">
            <h3>关闭行为</h3>
            <p>点击主窗关闭按钮时的行为：收起到托盘保留数据，直接退出会结束进程。</p>
          </div>
          <div className="settings-row__control">
            <div className="segmented">
              <button
                type="button"
                className={`segmented__item ${
                  snapshot.preferences.closeBehavior !== 'exit' ? 'is-active' : ''
                }`}
                onClick={() => void onPatchPreferences({ closeBehavior: 'tray' })}
              >
                收起到托盘
              </button>
              <button
                type="button"
                className={`segmented__item ${
                  snapshot.preferences.closeBehavior === 'exit' ? 'is-active' : ''
                }`}
                onClick={() => void onPatchPreferences({ closeBehavior: 'exit' })}
              >
                直接退出
              </button>
            </div>
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-row__title">
            <h3>启动可见策略</h3>
            <p>应用启动或开机自启时是否显示主窗。</p>
          </div>
          <div className="settings-row__control">
            <div className="segmented">
              <button
                type="button"
                className={`segmented__item ${
                  snapshot.preferences.startupVisibility === 'remember' ||
                  !['always_visible', 'tray'].includes(snapshot.preferences.startupVisibility)
                    ? 'is-active'
                    : ''
                }`}
                onClick={() => void onPatchPreferences({ startupVisibility: 'remember' })}
              >
                记忆上次
              </button>
              <button
                type="button"
                className={`segmented__item ${
                  snapshot.preferences.startupVisibility === 'always_visible' ? 'is-active' : ''
                }`}
                onClick={() => void onPatchPreferences({ startupVisibility: 'always_visible' })}
              >
                总是显示
              </button>
              <button
                type="button"
                className={`segmented__item ${
                  snapshot.preferences.startupVisibility === 'tray' ? 'is-active' : ''
                }`}
                onClick={() => void onPatchPreferences({ startupVisibility: 'tray' })}
              >
                托盘启动
              </button>
            </div>
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-row__title">
            <h3>立即显示主窗</h3>
            <p>一键把小组件拉回桌面。</p>
          </div>
          <div className="settings-row__control">
            <button
              className="btn btn--primary btn--sm"
              type="button"
              onClick={() => void onShowWidget()}
            >
              <ArrowUpRight size={14} />
              显示小组件
            </button>
          </div>
        </div>
      </section>
    );
  }

  function renderShortcutsTab() {
    return (
      <section className="settings-section">
        <div className="settings-section-head">
          <h2>快捷键</h2>
          <p>在小组件窗口内可用的键盘操作。</p>
        </div>

        <div className="shortcut-list">
          <div className="shortcut-row">
            <span>添加当前待办</span>
            <div className="shortcut-row__keys">
              <kbd>Enter</kbd>
            </div>
          </div>
          <div className="shortcut-row">
            <span>换行</span>
            <div className="shortcut-row__keys">
              <kbd>Shift</kbd>
              <span>+</span>
              <kbd>Enter</kbd>
            </div>
          </div>
          <div className="shortcut-row">
            <span>取消 / 关闭输入</span>
            <div className="shortcut-row__keys">
              <kbd>Esc</kbd>
            </div>
          </div>
          <div className="shortcut-row">
            <span>编辑当前待办</span>
            <div className="shortcut-row__keys">
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>双击内容</span>
            </div>
          </div>
          <div className="shortcut-row">
            <span>托盘唤起输入框</span>
            <div className="shortcut-row__keys">
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>托盘右键 → 新建</span>
            </div>
          </div>
        </div>
      </section>
    );
  }

  function renderAboutTab() {
    return (
      <section className="settings-section">
        <div className="settings-section-head">
          <h2>关于</h2>
          <p>桌面端小组件，基于 Tauri 构建。</p>
        </div>

        <div>
          <div className="about-line">
            <span>名称</span>
            <strong>My TODOs Widget</strong>
          </div>
          <div className="about-line">
            <span>版本</span>
            <strong>0.1.0</strong>
          </div>
          <div className="about-line">
            <span>技术栈</span>
            <strong>Tauri · React · TypeScript</strong>
          </div>
          <div className="about-line">
            <span>主题模式</span>
            <strong>{snapshot.preferences.themeMode}</strong>
          </div>
        </div>
      </section>
    );
  }

  const activeContent = (() => {
    switch (tab) {
      case 'appearance':
        return renderThemeTab();
      case 'behavior':
        return renderBehaviorTab();
      case 'startup':
        return renderStartupTab();
      case 'shortcuts':
        return renderShortcutsTab();
      case 'about':
        return renderAboutTab();
      default:
        return null;
    }
  })();

  return (
    <main className="settings-shell">
      <header className="settings-header" data-tauri-drag-region>
        <h1 data-tauri-drag-region>偏好设置</h1>
        <div className="settings-header__actions" data-tauri-drag-region="false">
          <button
            className="btn btn--icon btn--sm"
            type="button"
            onClick={() => void onShowWidget()}
            title="显示主窗"
          >
            <ArrowUpRight size={15} />
          </button>
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
                </button>
              ))}
            </nav>
          </div>

          <div>
            <div className="sidebar-section-title">概览</div>
            <div className="stats-block">
              <div className="stats-row">
                <span>总待办</span>
                <strong>{snapshot.todos.length}</strong>
              </div>
              <div className="stats-row">
                <span>进行中</span>
                <strong>{snapshot.todos.filter((todo) => !todo.completed).length}</strong>
              </div>
              <div className="stats-row">
                <span>已完成</span>
                <strong>{snapshot.todos.filter((todo) => todo.completed).length}</strong>
              </div>
            </div>
          </div>
        </aside>

        <div className="settings-content">
          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              className="settings-panel"
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
            >
              {activeContent}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </main>
  );
}
