mod models;
mod storage;
mod windows_ext;

use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use std::time::{SystemTime, UNIX_EPOCH};

use models::{
    AppPreferences, AppSnapshot, ExportBundle, RecurrenceRule, TodoItem, FOCUS_NEW_TODO_EVENT,
    STATE_SYNC_EVENT,
};
use storage::{load_snapshot, persist_snapshot, read_import_file, write_export_file};
use tauri::{
    image::Image,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, PhysicalSize, State, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri_plugin_autostart::ManagerExt as AutostartManagerExt;
use uuid::Uuid;
use windows_ext::{apply_click_through, set_not_topmost as force_not_topmost};

const WINDOW_WIDGET: &str = "widget";
const WINDOW_SETTINGS: &str = "settings";
const WINDOW_MANAGE: &str = "manage";
const TRAY_ID: &str = "todo-tray";

const MENU_TOGGLE_WIDGET: &str = "toggle-widget";
const MENU_NEW_TODO: &str = "new-todo";
const MENU_ALWAYS_ON_TOP: &str = "toggle-topmost";
const MENU_CLICK_THROUGH: &str = "toggle-click-through";
const MENU_HIDE_COMPLETED: &str = "toggle-hide-completed";
const MENU_SIZE_SMALL: &str = "set-size-small";
const MENU_SIZE_MEDIUM: &str = "set-size-medium";
const MENU_SIZE_LARGE: &str = "set-size-large";
const MENU_OPACITY_FULL: &str = "set-opacity-full";
const MENU_OPACITY_SOFT: &str = "set-opacity-soft";
const MENU_OPACITY_MIST: &str = "set-opacity-mist";
const MENU_OPACITY_FAINT: &str = "set-opacity-faint";
const MENU_OPEN_SETTINGS: &str = "open-settings";
const MENU_OPEN_MANAGE: &str = "open-manage";
const MENU_QUIT: &str = "quit";

const EXPORT_BUNDLE_VERSION: u32 = 1;

type DesktopMenuItem = MenuItem<tauri::Wry>;
type DesktopCheckMenuItem = CheckMenuItem<tauri::Wry>;

struct TrayHandles {
    toggle_widget: DesktopMenuItem,
    always_on_top: DesktopCheckMenuItem,
    click_through: DesktopCheckMenuItem,
    hide_completed: DesktopCheckMenuItem,
}

struct AppRuntimeState {
    snapshot: Mutex<AppSnapshot>,
    tray_handles: Mutex<Option<TrayHandles>>,
    quitting: AtomicBool,
}

impl AppRuntimeState {
    fn new(snapshot: AppSnapshot) -> Self {
        Self {
            snapshot: Mutex::new(snapshot),
            tray_handles: Mutex::new(None),
            quitting: AtomicBool::new(false),
        }
    }
}

fn now_timestamp_ms() -> i64 {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(duration) => duration.as_millis() as i64,
        Err(_) => 0,
    }
}

fn setup_error(stage: &str, message: String) -> std::io::Error {
    std::io::Error::other(format!("{stage}: {message}"))
}

fn get_widget_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window(WINDOW_WIDGET)
        .ok_or_else(|| "widget window is unavailable".to_string())
}

fn get_settings_config(app: &AppHandle) -> Result<tauri::utils::config::WindowConfig, String> {
    app.config()
        .app
        .windows
        .iter()
        .find(|window| window.label == WINDOW_SETTINGS)
        .cloned()
        .ok_or_else(|| "settings config is missing".to_string())
}

fn ensure_settings_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(WINDOW_SETTINGS) {
        return Ok(window);
    }

    let config = get_settings_config(app)?;
    WebviewWindowBuilder::from_config(app, &config)
        .map_err(|error| error.to_string())?
        .build()
        .map_err(|error| error.to_string())
}

fn get_manage_config(app: &AppHandle) -> Result<tauri::utils::config::WindowConfig, String> {
    app.config()
        .app
        .windows
        .iter()
        .find(|window| window.label == WINDOW_MANAGE)
        .cloned()
        .ok_or_else(|| "manage config is missing".to_string())
}

fn ensure_manage_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(WINDOW_MANAGE) {
        return Ok(window);
    }

    let config = get_manage_config(app)?;
    WebviewWindowBuilder::from_config(app, &config)
        .map_err(|error| error.to_string())?
        .build()
        .map_err(|error| error.to_string())
}

fn clone_snapshot(state: &AppRuntimeState) -> Result<AppSnapshot, String> {
    state
        .snapshot
        .lock()
        .map(|snapshot| snapshot.clone())
        .map_err(|_| "failed to lock app snapshot".to_string())
}

fn replace_snapshot(state: &AppRuntimeState, snapshot: AppSnapshot) -> Result<(), String> {
    let mut guard = state
        .snapshot
        .lock()
        .map_err(|_| "failed to lock app snapshot".to_string())?;
    *guard = snapshot;
    Ok(())
}

fn resolve_widget_position(window: &WebviewWindow, preferences: &mut AppPreferences) -> Result<(), String> {
    if preferences.widget_x.is_some() && preferences.widget_y.is_some() {
        return Ok(());
    }

    let Some(monitor) = window.current_monitor().map_err(|error| error.to_string())? else {
        return Ok(());
    };

    let work_area = monitor.work_area();
    let margin = 28_i32;
    let max_x = work_area.position.x + work_area.size.width as i32 - preferences.widget_width.round() as i32 - margin;
    let max_y = work_area.position.y + work_area.size.height as i32 - preferences.widget_height.round() as i32 - margin;

    preferences.widget_x = Some(max_x.max(work_area.position.x + margin) as f64);
    preferences.widget_y = Some(max_y.max(work_area.position.y + margin) as f64);

    Ok(())
}

fn sync_autostart(app: &AppHandle, preferences: &AppPreferences) -> Result<(), String> {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let currently_enabled = app
            .autolaunch()
            .is_enabled()
            .map_err(|error| error.to_string())?;

        if preferences.autostart_enabled {
            if !currently_enabled {
                app.autolaunch().enable().map_err(|error| error.to_string())?;
            }
        } else if currently_enabled {
            app.autolaunch().disable().map_err(|error| error.to_string())?;
        }
    }

    Ok(())
}

fn apply_widget_preferences_runtime(app: &AppHandle, preferences: &AppPreferences) -> Result<(), String> {
    let window = get_widget_window(app)?;

    if preferences.last_collapsed {
        window
            .set_size(LogicalSize::new(
                preferences.collapsed_width,
                preferences.collapsed_height,
            ))
            .map_err(|error| error.to_string())?;
    } else {
        window
            .set_size(PhysicalSize::new(
                preferences.widget_width.round() as u32,
                preferences.widget_height.round() as u32,
            ))
            .map_err(|error| error.to_string())?;
    }

    if let (Some(x), Some(y)) = (preferences.widget_x, preferences.widget_y) {
        window
            .set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32))
            .map_err(|error| error.to_string())?;
    }

    window
        .set_always_on_top(preferences.always_on_top)
        .map_err(|error| error.to_string())?;
    window
        .set_focusable(!preferences.click_through)
        .map_err(|error| error.to_string())?;

    if preferences.always_on_top {
        // No extra work needed when the user explicitly wants the widget to float.
    } else {
        force_not_topmost(&window)?;
    }

    #[cfg(windows)]
    apply_click_through(&window, preferences.click_through)?;

    #[cfg(not(windows))]
    if preferences.click_through {
        return Err("click-through is only supported on Windows".to_string());
    }

    Ok(())
}

fn update_tray_items(app: &AppHandle, state: &AppRuntimeState, snapshot: &AppSnapshot) -> Result<(), String> {
    let tray_handles_guard = state
        .tray_handles
        .lock()
        .map_err(|_| "failed to lock tray handles".to_string())?;

    let Some(handles) = tray_handles_guard.as_ref() else {
        return Ok(());
    };

    let is_visible = get_widget_window(app)
        .and_then(|window| window.is_visible().map_err(|error| error.to_string()))
        .unwrap_or(snapshot.preferences.last_window_visible);

    handles
        .toggle_widget
        .set_text(if is_visible { "隐藏待办" } else { "显示待办" })
        .map_err(|error| error.to_string())?;
    handles
        .always_on_top
        .set_checked(snapshot.preferences.always_on_top)
        .map_err(|error| error.to_string())?;
    handles
        .click_through
        .set_checked(snapshot.preferences.click_through)
        .map_err(|error| error.to_string())?;
    handles
        .hide_completed
        .set_checked(snapshot.preferences.hide_completed)
        .map_err(|error| error.to_string())?;

    Ok(())
}

fn persist_and_broadcast(
    app: &AppHandle,
    state: &AppRuntimeState,
    mut snapshot: AppSnapshot,
    apply_runtime: bool,
) -> Result<AppSnapshot, String> {
    snapshot.refresh_recurring(now_timestamp_ms());
    snapshot.normalize();
    persist_snapshot(app, &snapshot)?;
    replace_snapshot(state, snapshot.clone())?;

    if apply_runtime {
        sync_autostart(app, &snapshot.preferences)?;
        apply_widget_preferences_runtime(app, &snapshot.preferences)?;
    }

    update_tray_items(app, state, &snapshot)?;
    app.emit(STATE_SYNC_EVENT, snapshot.clone())
        .map_err(|error| error.to_string())?;
    Ok(snapshot)
}

fn mutate_snapshot<F>(
    app: &AppHandle,
    state: &AppRuntimeState,
    apply_runtime: bool,
    mutator: F,
) -> Result<AppSnapshot, String>
where
    F: FnOnce(&mut AppSnapshot) -> Result<(), String>,
{
    let mut snapshot = clone_snapshot(state)?;
    mutator(&mut snapshot)?;
    persist_and_broadcast(app, state, snapshot, apply_runtime)
}

fn remember_widget_geometry(app: &AppHandle, state: &AppRuntimeState) -> Result<(), String> {
    let window = get_widget_window(app)?;
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let size = window.inner_size().map_err(|error| error.to_string())?;

    mutate_snapshot(app, state, false, |snapshot| {
        snapshot.preferences.widget_x = Some(position.x as f64);
        snapshot.preferences.widget_y = Some(position.y as f64);
        if !snapshot.preferences.last_collapsed {
            snapshot.preferences.widget_width = size.width as f64;
            snapshot.preferences.widget_height = size.height as f64;
        }
        Ok(())
    })?;

    Ok(())
}

fn show_widget_window_internal(
    app: &AppHandle,
    state: &AppRuntimeState,
    focus: bool,
    focus_new_todo: bool,
) -> Result<bool, String> {
    let snapshot = clone_snapshot(state)?;
    let window = get_widget_window(app)?;

    apply_widget_preferences_runtime(app, &snapshot.preferences)?;
    window.unminimize().map_err(|error| error.to_string())?;
    window.show().map_err(|error| error.to_string())?;

    if focus && !snapshot.preferences.click_through {
        let _ = window.set_focus();
    }

    let updated = mutate_snapshot(app, state, false, |current| {
        current.preferences.last_window_visible = true;
        Ok(())
    })?;
    update_tray_items(app, state, &updated)?;

    if focus_new_todo {
        app.emit_to(WINDOW_WIDGET, FOCUS_NEW_TODO_EVENT, ())
            .map_err(|error| error.to_string())?;
    }

    if !snapshot.preferences.always_on_top {
        force_not_topmost(&window)?;
    }

    Ok(true)
}

fn hide_widget_window_internal(app: &AppHandle, state: &AppRuntimeState) -> Result<bool, String> {
    remember_widget_geometry(app, state)?;
    let window = get_widget_window(app)?;
    window.hide().map_err(|error| error.to_string())?;

    let updated = mutate_snapshot(app, state, false, |snapshot| {
        snapshot.preferences.last_window_visible = false;
        Ok(())
    })?;
    update_tray_items(app, state, &updated)?;
    Ok(false)
}

fn open_settings_window_internal(app: &AppHandle) -> Result<(), String> {
    eprintln!("[settings] open_settings_window_internal: start");
    let window = ensure_settings_window(app)?;
    eprintln!("[settings] ensure_settings_window returned");
    window.unminimize().map_err(|error| error.to_string())?;
    eprintln!("[settings] unminimize ok");
    window.show().map_err(|error| error.to_string())?;
    eprintln!("[settings] show ok");
    let result = window.set_focus().map_err(|error| error.to_string());
    eprintln!("[settings] set_focus result: {:?}", result.is_ok());
    result
}

fn open_manage_window_internal(app: &AppHandle) -> Result<(), String> {
    let window = ensure_manage_window(app)?;
    window.unminimize().map_err(|error| error.to_string())?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

fn toggle_widget_window_internal(app: &AppHandle, state: &AppRuntimeState) -> Result<bool, String> {
    let window = get_widget_window(app)?;
    let is_visible = window.is_visible().map_err(|error| error.to_string())?;
    if is_visible {
        hide_widget_window_internal(app, state)
    } else {
        show_widget_window_internal(app, state, true, false)
    }
}

fn create_tray(app: &AppHandle, snapshot: &AppSnapshot) -> Result<TrayHandles, String> {
    let toggle_widget = MenuItem::with_id(app, MENU_TOGGLE_WIDGET, "显示待办", true, None::<&str>)
        .map_err(|error| error.to_string())?;
    let new_todo = MenuItem::with_id(app, MENU_NEW_TODO, "新建待办", true, None::<&str>)
        .map_err(|error| error.to_string())?;
    let always_on_top = CheckMenuItem::with_id(
        app,
        MENU_ALWAYS_ON_TOP,
        "始终置顶",
        true,
        snapshot.preferences.always_on_top,
        None::<&str>,
    )
    .map_err(|error| error.to_string())?;
    let click_through = CheckMenuItem::with_id(
        app,
        MENU_CLICK_THROUGH,
        "窗口穿透",
        true,
        snapshot.preferences.click_through,
        None::<&str>,
    )
    .map_err(|error| error.to_string())?;
    let hide_completed = CheckMenuItem::with_id(
        app,
        MENU_HIDE_COMPLETED,
        "隐藏已完成",
        true,
        snapshot.preferences.hide_completed,
        None::<&str>,
    )
    .map_err(|error| error.to_string())?;

    let size_small = MenuItem::with_id(app, MENU_SIZE_SMALL, "紧凑 420 × 560", true, None::<&str>)
        .map_err(|error| error.to_string())?;
    let size_medium = MenuItem::with_id(app, MENU_SIZE_MEDIUM, "标准 460 × 680", true, None::<&str>)
        .map_err(|error| error.to_string())?;
    let size_large = MenuItem::with_id(app, MENU_SIZE_LARGE, "舒展 520 × 760", true, None::<&str>)
        .map_err(|error| error.to_string())?;

    let opacity_full =
        MenuItem::with_id(app, MENU_OPACITY_FULL, "100%", true, None::<&str>).map_err(|error| error.to_string())?;
    let opacity_soft =
        MenuItem::with_id(app, MENU_OPACITY_SOFT, "92%", true, None::<&str>).map_err(|error| error.to_string())?;
    let opacity_mist =
        MenuItem::with_id(app, MENU_OPACITY_MIST, "84%", true, None::<&str>).map_err(|error| error.to_string())?;
    let opacity_faint =
        MenuItem::with_id(app, MENU_OPACITY_FAINT, "76%", true, None::<&str>).map_err(|error| error.to_string())?;

    let open_settings =
        MenuItem::with_id(app, MENU_OPEN_SETTINGS, "偏好设置", true, None::<&str>).map_err(|error| error.to_string())?;
    let open_manage =
        MenuItem::with_id(app, MENU_OPEN_MANAGE, "代办管理", true, None::<&str>).map_err(|error| error.to_string())?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "退出程序", true, None::<&str>)
        .map_err(|error| error.to_string())?;

    let separator_a = PredefinedMenuItem::separator(app).map_err(|error| error.to_string())?;
    let separator_b = PredefinedMenuItem::separator(app).map_err(|error| error.to_string())?;
    let separator_c = PredefinedMenuItem::separator(app).map_err(|error| error.to_string())?;

    let size_menu = Submenu::with_items(app, "窗口尺寸", true, &[&size_small, &size_medium, &size_large])
        .map_err(|error| error.to_string())?;
    let opacity_menu =
        Submenu::with_items(app, "不透明度", true, &[&opacity_full, &opacity_soft, &opacity_mist, &opacity_faint])
            .map_err(|error| error.to_string())?;

    let menu = Menu::with_items(
        app,
        &[
            &toggle_widget,
            &new_todo,
            &separator_a,
            &always_on_top,
            &click_through,
            &hide_completed,
            &size_menu,
            &opacity_menu,
            &separator_b,
            &open_manage,
            &open_settings,
            &separator_c,
            &quit,
        ],
    )
    .map_err(|error| error.to_string())?;

    let tray_icon = Image::from_bytes(include_bytes!("../icons/32x32.png"))
        .map_err(|e| e.to_string())?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(tray_icon)
        .icon_as_template(false)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let state = app.state::<AppRuntimeState>();
            let result = match event.id().as_ref() {
                MENU_TOGGLE_WIDGET => toggle_widget_window_internal(app, &state).map(|_| ()),
                MENU_NEW_TODO => {
                    let result = mutate_snapshot(app, &state, true, |snapshot| {
                        if snapshot.preferences.click_through {
                            snapshot.preferences.click_through = false;
                        }
                        Ok(())
                    });

                    match result {
                        Ok(_) => show_widget_window_internal(app, &state, true, true).map(|_| ()),
                        Err(error) => Err(error),
                    }
                }
                MENU_ALWAYS_ON_TOP => mutate_snapshot(app, &state, true, |snapshot| {
                    snapshot.preferences.always_on_top = !snapshot.preferences.always_on_top;
                    Ok(())
                })
                .map(|_| ()),
                MENU_CLICK_THROUGH => {
                    #[cfg(windows)]
                    {
                        mutate_snapshot(app, &state, true, |snapshot| {
                            snapshot.preferences.click_through = !snapshot.preferences.click_through;
                            Ok(())
                        })
                        .map(|_| ())
                    }
                    #[cfg(not(windows))]
                    {
                        Err("click-through is only supported on Windows".to_string())
                    }
                }
                MENU_HIDE_COMPLETED => mutate_snapshot(app, &state, false, |snapshot| {
                    snapshot.preferences.hide_completed = !snapshot.preferences.hide_completed;
                    Ok(())
                })
                .map(|_| ()),
                MENU_SIZE_SMALL => mutate_snapshot(app, &state, true, |snapshot| {
                    snapshot.preferences.widget_width = 420.0;
                    snapshot.preferences.widget_height = 560.0;
                    Ok(())
                })
                .map(|_| ()),
                MENU_SIZE_MEDIUM => mutate_snapshot(app, &state, true, |snapshot| {
                    snapshot.preferences.widget_width = 460.0;
                    snapshot.preferences.widget_height = 680.0;
                    Ok(())
                })
                .map(|_| ()),
                MENU_SIZE_LARGE => mutate_snapshot(app, &state, true, |snapshot| {
                    snapshot.preferences.widget_width = 520.0;
                    snapshot.preferences.widget_height = 760.0;
                    Ok(())
                })
                .map(|_| ()),
                MENU_OPACITY_FULL => mutate_snapshot(app, &state, false, |snapshot| {
                    snapshot.preferences.surface_opacity = 1.0;
                    Ok(())
                })
                .map(|_| ()),
                MENU_OPACITY_SOFT => mutate_snapshot(app, &state, false, |snapshot| {
                    snapshot.preferences.surface_opacity = 0.92;
                    Ok(())
                })
                .map(|_| ()),
                MENU_OPACITY_MIST => mutate_snapshot(app, &state, false, |snapshot| {
                    snapshot.preferences.surface_opacity = 0.84;
                    Ok(())
                })
                .map(|_| ()),
                MENU_OPACITY_FAINT => mutate_snapshot(app, &state, false, |snapshot| {
                    snapshot.preferences.surface_opacity = 0.76;
                    Ok(())
                })
                .map(|_| ()),
                MENU_OPEN_SETTINGS => open_settings_window_internal(app),
                MENU_OPEN_MANAGE => open_manage_window_internal(app),
                MENU_QUIT => {
                    state.quitting.store(true, Ordering::SeqCst);
                    let _ = remember_widget_geometry(app, &state);
                    app.exit(0);
                    Ok(())
                }
                _ => Ok(()),
            };

            if let Err(error) = result {
                let _ = app.emit("todo://error", error);
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                let state = app.state::<AppRuntimeState>();
                let _ = toggle_widget_window_internal(app, &state);
            }
        })
        .build(app)
        .map_err(|error| error.to_string())?;

    Ok(TrayHandles {
        toggle_widget,
        always_on_top,
        click_through,
        hide_completed,
    })
}

#[tauri::command]
fn load_app_state(state: State<'_, AppRuntimeState>) -> Result<AppSnapshot, String> {
    clone_snapshot(&state)
}

#[tauri::command]
fn show_widget_window(app: AppHandle, state: State<'_, AppRuntimeState>) -> Result<bool, String> {
    show_widget_window_internal(&app, &state, true, false)
}

#[tauri::command]
fn hide_widget_window(app: AppHandle, state: State<'_, AppRuntimeState>) -> Result<bool, String> {
    hide_widget_window_internal(&app, &state)
}

#[tauri::command]
fn toggle_widget_window(app: AppHandle, state: State<'_, AppRuntimeState>) -> Result<bool, String> {
    toggle_widget_window_internal(&app, &state)
}

#[tauri::command]
async fn open_settings_window(app: AppHandle) -> Result<(), String> {
    open_settings_window_internal(&app)
}

#[tauri::command]
fn apply_widget_preferences(
    app: AppHandle,
    state: State<'_, AppRuntimeState>,
    preferences: AppPreferences,
) -> Result<AppSnapshot, String> {
    mutate_snapshot(&app, &state, true, |snapshot| {
        snapshot.preferences = preferences;
        Ok(())
    })
}

#[tauri::command]
fn set_click_through(
    app: AppHandle,
    state: State<'_, AppRuntimeState>,
    enabled: bool,
) -> Result<AppSnapshot, String> {
    #[cfg(not(windows))]
    if enabled {
        return Err("click-through is only supported on Windows".to_string());
    }

    mutate_snapshot(&app, &state, true, |snapshot| {
        snapshot.preferences.click_through = enabled;
        Ok(())
    })
}

#[tauri::command]
fn set_not_topmost(app: AppHandle) -> Result<(), String> {
    let window = get_widget_window(&app)?;
    force_not_topmost(&window)
}

#[tauri::command]
fn create_todo(
    app: AppHandle,
    state: State<'_, AppRuntimeState>,
    content: String,
    color: String,
    text_color: Option<String>,
    recurrence: Option<RecurrenceRule>,
) -> Result<AppSnapshot, String> {
    let trimmed = content.trim_end_matches('\n').trim().to_string();
    if trimmed.is_empty() {
        return Err("待办内容不能为空".to_string());
    }

    mutate_snapshot(&app, &state, false, |snapshot| {
        let timestamp = now_timestamp_ms();
        let order = snapshot.todos.len() as i32;
        let resolved_text_color = text_color
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "default".to_string());
        snapshot.todos.push(TodoItem {
            id: Uuid::new_v4().to_string(),
            content: trimmed,
            completed: false,
            color: if color.trim().is_empty() {
                "mist".to_string()
            } else {
                color
            },
            text_color: resolved_text_color,
            order,
            created_at: timestamp,
            updated_at: timestamp,
            deleted_at: None,
            recurrence,
            last_completed_at: None,
        });
        Ok(())
    })
}

#[tauri::command]
fn update_todo(
    app: AppHandle,
    state: State<'_, AppRuntimeState>,
    todo: TodoItem,
) -> Result<AppSnapshot, String> {
    mutate_snapshot(&app, &state, false, |snapshot| {
        let Some(existing) = snapshot.todos.iter_mut().find(|item| item.id == todo.id) else {
            return Err("todo not found".to_string());
        };

        let trimmed = todo.content.trim_end_matches('\n').trim().to_string();
        if trimmed.is_empty() {
            return Err("待办内容不能为空".to_string());
        }

        existing.content = trimmed;
        existing.completed = todo.completed;
        existing.color = if todo.color.trim().is_empty() {
            "mist".to_string()
        } else {
            todo.color
        };
        existing.text_color = if todo.text_color.trim().is_empty() {
            "default".to_string()
        } else {
            todo.text_color
        };
        existing.order = todo.order;
        existing.updated_at = now_timestamp_ms();
        Ok(())
    })
}

#[tauri::command]
fn delete_todo(
    app: AppHandle,
    state: State<'_, AppRuntimeState>,
    id: String,
) -> Result<AppSnapshot, String> {
    mutate_snapshot(&app, &state, false, |snapshot| {
        let now = now_timestamp_ms();
        if let Some(todo) = snapshot.todos.iter_mut().find(|item| item.id == id) {
            if todo.deleted_at.is_none() {
                todo.deleted_at = Some(now);
                todo.updated_at = now;
            }
        }
        Ok(())
    })
}

#[tauri::command]
fn restore_todo(
    app: AppHandle,
    state: State<'_, AppRuntimeState>,
    id: String,
) -> Result<AppSnapshot, String> {
    mutate_snapshot(&app, &state, false, |snapshot| {
        let now = now_timestamp_ms();
        let active_count = snapshot
            .todos
            .iter()
            .filter(|todo| todo.deleted_at.is_none())
            .count() as i32;
        if let Some(todo) = snapshot.todos.iter_mut().find(|item| item.id == id) {
            if todo.deleted_at.is_some() {
                todo.deleted_at = None;
                todo.order = active_count;
                todo.updated_at = now;
            }
        }
        Ok(())
    })
}

#[tauri::command]
fn purge_todo(
    app: AppHandle,
    state: State<'_, AppRuntimeState>,
    id: String,
) -> Result<AppSnapshot, String> {
    mutate_snapshot(&app, &state, false, |snapshot| {
        snapshot.todos.retain(|todo| todo.id != id);
        Ok(())
    })
}

#[tauri::command]
fn empty_trash(
    app: AppHandle,
    state: State<'_, AppRuntimeState>,
) -> Result<AppSnapshot, String> {
    mutate_snapshot(&app, &state, false, |snapshot| {
        snapshot.todos.retain(|todo| todo.deleted_at.is_none());
        Ok(())
    })
}

#[tauri::command]
fn export_todos(
    state: State<'_, AppRuntimeState>,
    path: String,
) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("导出路径不能为空".to_string());
    }
    let snapshot = clone_snapshot(&state)?;
    let bundle = ExportBundle {
        version: EXPORT_BUNDLE_VERSION,
        exported_at: now_timestamp_ms(),
        preferences: snapshot.preferences,
        todos: snapshot.todos,
    };
    write_export_file(&PathBuf::from(path), &bundle)
}

#[tauri::command]
fn import_todos(
    app: AppHandle,
    state: State<'_, AppRuntimeState>,
    path: String,
    mode: String,
) -> Result<AppSnapshot, String> {
    let bundle = read_import_file(&PathBuf::from(&path))?;
    if bundle.version > EXPORT_BUNDLE_VERSION {
        return Err(format!(
            "不支持的导出版本 {} (当前最大 {})",
            bundle.version, EXPORT_BUNDLE_VERSION
        ));
    }

    let mode = mode.as_str();
    if !matches!(mode, "merge" | "replace") {
        return Err(format!("未知的导入模式: {mode}"));
    }

    mutate_snapshot(&app, &state, mode == "replace", |snapshot| {
        if mode == "replace" {
            snapshot.preferences = bundle.preferences.clone();
            snapshot.todos = bundle.todos.clone();
        } else {
            let now = now_timestamp_ms();
            let mut active_count = snapshot
                .todos
                .iter()
                .filter(|todo| todo.deleted_at.is_none())
                .count() as i32;
            for incoming in &bundle.todos {
                if let Some(existing) = snapshot
                    .todos
                    .iter_mut()
                    .find(|todo| todo.id == incoming.id)
                {
                    if incoming.updated_at >= existing.updated_at {
                        existing.content = incoming.content.clone();
                        existing.completed = incoming.completed;
                        existing.color = incoming.color.clone();
                        existing.text_color = incoming.text_color.clone();
                        existing.deleted_at = incoming.deleted_at;
                        existing.updated_at = incoming.updated_at;
                    }
                } else {
                    let mut cloned = incoming.clone();
                    if cloned.deleted_at.is_none() {
                        cloned.order = active_count;
                        active_count += 1;
                    }
                    if cloned.created_at == 0 {
                        cloned.created_at = now;
                    }
                    if cloned.updated_at == 0 {
                        cloned.updated_at = now;
                    }
                    snapshot.todos.push(cloned);
                }
            }
        }
        Ok(())
    })
}

#[tauri::command]
async fn open_manage_window(app: AppHandle) -> Result<(), String> {
    open_manage_window_internal(&app)
}

#[tauri::command]
fn set_todo_completed(
    app: AppHandle,
    state: State<'_, AppRuntimeState>,
    id: String,
    completed: bool,
) -> Result<AppSnapshot, String> {
    mutate_snapshot(&app, &state, false, |snapshot| {
        let Some(todo) = snapshot.todos.iter_mut().find(|item| item.id == id) else {
            return Err("todo not found".to_string());
        };
        let now = now_timestamp_ms();
        todo.completed = completed;
        todo.updated_at = now;
        todo.last_completed_at = if completed { Some(now) } else { None };
        Ok(())
    })
}

#[tauri::command]
fn sync_timezone(
    app: AppHandle,
    state: State<'_, AppRuntimeState>,
    offset_minutes: i32,
) -> Result<AppSnapshot, String> {
    mutate_snapshot(&app, &state, false, |snapshot| {
        snapshot.preferences.tz_offset_minutes = offset_minutes;
        Ok(())
    })
}

#[tauri::command]
fn reorder_todos(
    app: AppHandle,
    state: State<'_, AppRuntimeState>,
    ordered_ids: Vec<String>,
) -> Result<AppSnapshot, String> {
    mutate_snapshot(&app, &state, false, |snapshot| {
        let now = now_timestamp_ms();

        for (index, id) in ordered_ids.iter().enumerate() {
            if let Some(todo) = snapshot.todos.iter_mut().find(|item| item.id == *id) {
                if todo.deleted_at.is_none() {
                    todo.order = index as i32;
                    todo.updated_at = now;
                }
            }
        }

        let mut next_order = ordered_ids.len() as i32;
        let missing_active: Vec<String> = snapshot
            .todos
            .iter()
            .filter(|todo| todo.deleted_at.is_none() && !ordered_ids.iter().any(|id| id == &todo.id))
            .map(|todo| todo.id.clone())
            .collect();

        for id in missing_active {
            if let Some(todo) = snapshot.todos.iter_mut().find(|item| item.id == id) {
                todo.order = next_order;
                todo.updated_at = now;
                next_order += 1;
            }
        }

        Ok(())
    })
}

fn sync_initial_snapshot(app: &AppHandle, state: &AppRuntimeState) -> Result<AppSnapshot, String> {
    let mut snapshot = load_snapshot(app)?;

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        if let Ok(enabled) = app.autolaunch().is_enabled() {
            snapshot.preferences.autostart_enabled = enabled;
        }
    }

    snapshot.purge_expired_trash(now_timestamp_ms());

    let widget = get_widget_window(app)?;
    resolve_widget_position(&widget, &mut snapshot.preferences)?;
    persist_and_broadcast(app, state, snapshot, true)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::Builder::new().arg("--autostart").build())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let initial = load_snapshot(app.handle())
                .map_err(|error| setup_error("setup/load_snapshot", error))?;
            app.manage(AppRuntimeState::new(initial));

            let state = app.state::<AppRuntimeState>();
            let snapshot = sync_initial_snapshot(app.handle(), &state)
                .map_err(|error| setup_error("setup/sync_initial_snapshot", error))?;
            let tray_handles = create_tray(app.handle(), &snapshot)
                .map_err(|error| setup_error("setup/create_tray", error))?;
            {
                let mut guard = state
                    .tray_handles
                    .lock()
                    .map_err(|_| std::io::Error::other("failed to lock tray handles"))?;
                *guard = Some(tray_handles);
            }
            update_tray_items(app.handle(), &state, &snapshot)
                .map_err(|error| setup_error("setup/update_tray_items", error))?;

            let launched_from_autostart = std::env::args().any(|arg| arg == "--autostart");
            let visibility = snapshot.preferences.startup_visibility.as_str();
            let should_show = match visibility {
                "always_visible" => true,
                "tray" => false,
                _ => {
                    if launched_from_autostart {
                        snapshot.preferences.last_window_visible
                    } else {
                        true
                    }
                }
            };

            if should_show {
                show_widget_window_internal(app.handle(), &state, !launched_from_autostart, false)
                    .map_err(|error| setup_error("setup/show_widget_window_internal", error))?;
            } else {
                mutate_snapshot(app.handle(), &state, false, |current| {
                    current.preferences.last_window_visible = false;
                    Ok(())
                })
                .map_err(|error| setup_error("setup/remember_hidden_visibility", error))?;
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != WINDOW_WIDGET {
                return;
            }

            let app = window.app_handle();
            let state = app.state::<AppRuntimeState>();

            match event {
                WindowEvent::CloseRequested { api, .. } => {
                    if state.quitting.load(Ordering::SeqCst) {
                        return;
                    }
                    let close_behavior = clone_snapshot(&state)
                        .map(|snapshot| snapshot.preferences.close_behavior)
                        .unwrap_or_else(|_| "tray".to_string());
                    if close_behavior == "exit" {
                        state.quitting.store(true, Ordering::SeqCst);
                        let _ = remember_widget_geometry(&app, &state);
                        app.exit(0);
                    } else {
                        api.prevent_close();
                        let _ = hide_widget_window_internal(&app, &state);
                    }
                }
                WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
                    let _ = remember_widget_geometry(&app, &state);
                }
                WindowEvent::Focused(_) => {
                    if let Ok(snapshot) = clone_snapshot(&state) {
                        if !snapshot.preferences.always_on_top {
                            let _ = get_widget_window(&app).and_then(|widget| force_not_topmost(&widget));
                        }
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_app_state,
            show_widget_window,
            hide_widget_window,
            toggle_widget_window,
            open_settings_window,
            open_manage_window,
            apply_widget_preferences,
            set_click_through,
            set_not_topmost,
            create_todo,
            update_todo,
            delete_todo,
            restore_todo,
            purge_todo,
            empty_trash,
            export_todos,
            import_todos,
            set_todo_completed,
            sync_timezone,
            reorder_todos
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
