#[cfg(windows)]
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use tauri::WebviewWindow;

#[cfg(windows)]
use windows::Win32::{
    Foundation::HWND,
    UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, HWND_NOTOPMOST,
        SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, WS_EX_LAYERED,
        WS_EX_TRANSPARENT,
    },
};

#[cfg(windows)]
fn hwnd_from_window(window: &WebviewWindow) -> Result<HWND, String> {
    let handle = window.window_handle().map_err(|error| error.to_string())?;
    match handle.as_raw() {
        RawWindowHandle::Win32(win32) => Ok(HWND(win32.hwnd.get() as *mut core::ffi::c_void)),
        _ => Err("unsupported raw window handle".to_string()),
    }
}

#[cfg(windows)]
pub fn apply_click_through(window: &WebviewWindow, enabled: bool) -> Result<(), String> {
    let hwnd = hwnd_from_window(window)?;
    let mut ex_style = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) } as u32;

    if enabled {
        ex_style |= WS_EX_TRANSPARENT.0 as u32;
        ex_style |= WS_EX_LAYERED.0 as u32;
    } else {
        ex_style &= !(WS_EX_TRANSPARENT.0 as u32);
    }

    unsafe {
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex_style as isize);
        SetWindowPos(
            hwnd,
            None,
            0,
            0,
            0,
            0,
            SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        )
        .map_err(|error| error.to_string())?;
    }

    Ok(())
}

#[cfg(not(windows))]
pub fn apply_click_through(_: &WebviewWindow, _: bool) -> Result<(), String> {
    Err("click-through is only supported on Windows".to_string())
}

#[cfg(windows)]
pub fn set_not_topmost(window: &WebviewWindow) -> Result<(), String> {
    let hwnd = hwnd_from_window(window)?;
    unsafe {
        SetWindowPos(
            hwnd,
            Some(HWND_NOTOPMOST),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        )
        .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn set_not_topmost(_: &WebviewWindow) -> Result<(), String> {
    Ok(())
}
