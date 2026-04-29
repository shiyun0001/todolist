use serde::{Deserialize, Serialize};

pub const STATE_SYNC_EVENT: &str = "todo://state-sync";
pub const FOCUS_NEW_TODO_EVENT: &str = "todo://focus-new-todo";

fn default_text_color() -> String {
    "default".to_string()
}

fn default_trash_retention_days() -> u32 {
    30
}

fn default_collapsed_width() -> f64 {
    320.0
}

fn default_collapsed_height() -> f64 {
    64.0
}

fn default_recurrence_interval() -> u32 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecurrenceRule {
    pub frequency: String,
    #[serde(default)]
    pub days_of_week: Vec<u8>,
    #[serde(default = "default_recurrence_interval")]
    pub interval: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoItem {
    pub id: String,
    pub content: String,
    pub completed: bool,
    pub color: String,
    #[serde(default = "default_text_color")]
    pub text_color: String,
    pub order: i32,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub deleted_at: Option<i64>,
    #[serde(default)]
    pub recurrence: Option<RecurrenceRule>,
    #[serde(default)]
    pub last_completed_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPreferences {
    pub theme_mode: String,
    pub always_on_top: bool,
    pub click_through: bool,
    pub hide_completed: bool,
    pub widget_width: f64,
    pub widget_height: f64,
    pub widget_x: Option<f64>,
    pub widget_y: Option<f64>,
    pub surface_opacity: f64,
    pub autostart_enabled: bool,
    pub startup_visibility: String,
    pub close_behavior: String,
    pub last_window_visible: bool,
    #[serde(default = "default_trash_retention_days")]
    pub trash_retention_days: u32,
    #[serde(default)]
    pub last_collapsed: bool,
    #[serde(default = "default_collapsed_width")]
    pub collapsed_width: f64,
    #[serde(default = "default_collapsed_height")]
    pub collapsed_height: f64,
    #[serde(default)]
    pub tz_offset_minutes: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppSnapshot {
    pub preferences: AppPreferences,
    pub todos: Vec<TodoItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportBundle {
    pub version: u32,
    pub exported_at: i64,
    pub preferences: AppPreferences,
    pub todos: Vec<TodoItem>,
}

impl Default for AppPreferences {
    fn default() -> Self {
        Self {
            theme_mode: "system".to_string(),
            always_on_top: false,
            click_through: false,
            hide_completed: false,
            widget_width: 460.0,
            widget_height: 680.0,
            widget_x: None,
            widget_y: None,
            surface_opacity: 0.9,
            autostart_enabled: false,
            startup_visibility: "remember".to_string(),
            close_behavior: "tray".to_string(),
            last_window_visible: true,
            trash_retention_days: default_trash_retention_days(),
            last_collapsed: false,
            collapsed_width: default_collapsed_width(),
            collapsed_height: default_collapsed_height(),
            tz_offset_minutes: 0,
        }
    }
}

impl AppSnapshot {
    pub fn normalize(&mut self) {
        self.preferences.widget_width = self.preferences.widget_width.clamp(360.0, 760.0);
        self.preferences.widget_height = self.preferences.widget_height.clamp(420.0, 980.0);
        self.preferences.surface_opacity = self.preferences.surface_opacity.clamp(0.55, 1.0);
        if !matches!(self.preferences.close_behavior.as_str(), "tray" | "exit") {
            self.preferences.close_behavior = "tray".to_string();
        }
        if !matches!(
            self.preferences.startup_visibility.as_str(),
            "remember" | "always_visible" | "tray"
        ) {
            self.preferences.startup_visibility = "remember".to_string();
        }
        if self.preferences.trash_retention_days == 0 {
            self.preferences.trash_retention_days = default_trash_retention_days();
        }
        self.preferences.trash_retention_days = self.preferences.trash_retention_days.clamp(7, 365);
        if !self.preferences.collapsed_width.is_finite() || self.preferences.collapsed_width < 240.0 {
            self.preferences.collapsed_width = default_collapsed_width();
        }
        if !self.preferences.collapsed_height.is_finite() || self.preferences.collapsed_height < 48.0 {
            self.preferences.collapsed_height = default_collapsed_height();
        }
        self.preferences.collapsed_width = self.preferences.collapsed_width.clamp(240.0, 520.0);
        self.preferences.collapsed_height = self.preferences.collapsed_height.clamp(48.0, 120.0);
        if self.preferences.tz_offset_minutes < -12 * 60 || self.preferences.tz_offset_minutes > 14 * 60 {
            self.preferences.tz_offset_minutes = 0;
        }
        self.todos.sort_by_key(|todo| todo.order);
        for (index, todo) in self.todos.iter_mut().enumerate() {
            todo.order = index as i32;
            if todo.color.trim().is_empty() {
                todo.color = "mist".to_string();
            }
            if todo.text_color.trim().is_empty() {
                todo.text_color = "default".to_string();
            }
            if let Some(ts) = todo.deleted_at {
                if ts < 0 {
                    todo.deleted_at = None;
                }
            }
            if let Some(rule) = todo.recurrence.as_mut() {
                if !matches!(
                    rule.frequency.as_str(),
                    "daily" | "weekdays" | "weekends" | "weekly" | "every-n-days"
                ) {
                    todo.recurrence = None;
                    continue;
                }
                if rule.interval == 0 {
                    rule.interval = 1;
                }
                rule.interval = rule.interval.clamp(1, 30);
                rule.days_of_week.retain(|day| *day <= 6);
                rule.days_of_week.sort_unstable();
                rule.days_of_week.dedup();
                if rule.frequency == "weekly" && rule.days_of_week.is_empty() {
                    todo.recurrence = None;
                }
            }
            if !todo.completed {
                todo.last_completed_at = None;
            }
        }
    }

    pub fn purge_expired_trash(&mut self, now: i64) {
        let retention_ms = self.preferences.trash_retention_days as i64 * 86_400_000;
        self.todos.retain(|todo| match todo.deleted_at {
            Some(ts) => now - ts <= retention_ms,
            None => true,
        });
    }

    pub fn refresh_recurring(&mut self, now: i64) {
        let tz_offset = self.preferences.tz_offset_minutes as i64 * 60_000;
        let today_day = (now + tz_offset).div_euclid(86_400_000);
        let today_weekday = (((today_day + 4) % 7 + 7) % 7) as u8;
        for todo in self.todos.iter_mut() {
            if todo.deleted_at.is_some() || !todo.completed {
                continue;
            }
            let Some(rule) = todo.recurrence.as_ref() else { continue };
            let Some(last) = todo.last_completed_at else { continue };
            let last_day = (last + tz_offset).div_euclid(86_400_000);
            if today_day == last_day {
                continue;
            }
            let due = match rule.frequency.as_str() {
                "daily" => true,
                "weekdays" => (1..=5).contains(&today_weekday),
                "weekends" => today_weekday == 0 || today_weekday == 6,
                "weekly" => rule.days_of_week.contains(&today_weekday),
                "every-n-days" => {
                    (today_day - last_day) >= rule.interval.max(1) as i64
                }
                _ => false,
            };
            if due {
                todo.completed = false;
                todo.last_completed_at = None;
                todo.updated_at = now;
            }
        }
    }
}
