use std::collections::{HashSet, VecDeque};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::image::Image;
use tauri::menu::{IsMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Position, Size, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder, WindowEvent, Wry,
};
use tauri_plugin_opener::OpenerExt;

const DEFAULT_SERVER_DOMAIN: &str = "la2speak.com";
const CONFIG_VERSION: &str = env!("CARGO_PKG_VERSION");
const BRIDGE_JS: &str = include_str!("../bridge.js");
const DRAG_JS: &str = include_str!("../drag.js");
const OVERLAY_FONT_DEFAULT: u32 = 11;
const OVERLAY_FONT_MIN: u32 = 10;
const OVERLAY_FONT_MAX: u32 = 24;
const OVERLAY_COLOR_DEFAULT: &str = "#dfe5f2";
const OVERLAY_WIDTH: f64 = 200.0;
const OVERLAY_ROW: f64 = 24.0;
const OVERLAY_EDIT_BAR: f64 = 30.0;

// ---------------------------------------------------------------------------
// Состояние приложения
// ---------------------------------------------------------------------------

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct OverlayPosition {
    pub x: i32,
    pub y: i32,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ServerEntry {
    pub url: String,
    pub name: String,
    pub last_used: u64,
}

impl Default for ServerEntry {
    fn default() -> Self {
        Self {
            url: String::new(),
            name: String::new(),
            last_used: 0,
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub server_url: String,
    pub ptt_key: String,
    pub overlay_enabled: bool,
    pub overlay_anchor: String,
    pub overlay_position: Option<OverlayPosition>,
    pub overlay_font_size: u32,
    pub overlay_color: String,
    pub servers: Vec<ServerEntry>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            server_url: String::new(),
            ptt_key: "V".into(),
            overlay_enabled: true,
            overlay_anchor: "top-left".into(),
            overlay_position: None,
            overlay_font_size: OVERLAY_FONT_DEFAULT,
            overlay_color: OVERLAY_COLOR_DEFAULT.into(),
            servers: Vec::new(),
        }
    }
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MicState {
    pub in_call: bool,
    pub on: bool,
    pub muted: bool,
    pub broadcasting: bool,
    pub channel_name: String,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum MicMode {
    Voice,
    Ptt,
    Toggle,
}

impl MicMode {
    fn parse(value: Option<&str>) -> Self {
        match value {
            Some("ptt") => MicMode::Ptt,
            Some("toggle") => MicMode::Toggle,
            _ => MicMode::Voice,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            MicMode::Voice => "voice",
            MicMode::Ptt => "ptt",
            MicMode::Toggle => "toggle",
        }
    }
}

#[derive(Clone)]
struct Hotkey {
    key: String,
    alt: bool,
    ctrl: bool,
    shift: bool,
    meta: bool,
}

#[derive(Clone)]
struct Binding {
    target: String,
    mode: String,
    hot: Hotkey,
}

#[derive(Default)]
struct Hotkeys {
    ptt: Option<Hotkey>,
    bindings: Vec<Binding>,
    broadcast_held: HashSet<String>,
    ptt_held: bool,
    mic_held: bool,
}

struct OverlayRuntime {
    state: Option<Value>,
    editing: bool,
}

struct TrayHandles {
    toggle: MenuItem<Wry>,
    tray: TrayIcon<Wry>,
}

pub struct Shared {
    config: Mutex<Config>,
    config_path: PathBuf,
    token: String,
    port: u16,
    queue: Mutex<VecDeque<Value>>,
    wake: Condvar,
    mic: Mutex<MicState>,
    mic_mode: Mutex<MicMode>,
    hotkeys: Mutex<Hotkeys>,
    hotkeys_ok: AtomicBool,
    overlay: Mutex<OverlayRuntime>,
    edit_generation: AtomicU64,
    maximized: AtomicBool,
    tray: Mutex<Option<TrayHandles>>,
}

impl Shared {
    fn new(config: Config, config_path: PathBuf, token: String, port: u16) -> Self {
        Self {
            config: Mutex::new(config),
            config_path,
            token,
            port,
            queue: Mutex::new(VecDeque::new()),
            wake: Condvar::new(),
            mic: Mutex::new(MicState::default()),
            mic_mode: Mutex::new(MicMode::Voice),
            hotkeys: Mutex::new(Hotkeys::default()),
            hotkeys_ok: AtomicBool::new(cfg!(target_os = "windows")),
            overlay: Mutex::new(OverlayRuntime {
                state: None,
                editing: false,
            }),
            edit_generation: AtomicU64::new(0),
            maximized: AtomicBool::new(false),
            tray: Mutex::new(None),
        }
    }
}

// ---------------------------------------------------------------------------
// Конфигурация и адреса серверов
// ---------------------------------------------------------------------------

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}

fn is_ipv4(host: &str) -> bool {
    let parts: Vec<&str> = host.split('.').collect();
    parts.len() == 4
        && parts
            .iter()
            .all(|part| !part.is_empty() && part.parse::<u8>().is_ok())
}

pub fn normalize_server_url(value: &str) -> Option<String> {
    let raw = value.trim();
    if raw.is_empty() {
        return None;
    }
    let lower = raw.to_ascii_lowercase();
    let with_scheme = if lower.starts_with("http://") || lower.starts_with("https://") {
        raw.to_string()
    } else {
        let (host, rest) = match raw.find(['/', '?', '#']) {
            Some(index) => (&raw[..index], &raw[index..]),
            None => (raw, ""),
        };
        // Короткое имя отделяем от порта: «chat:4000» -> chat.la2speak.com:4000.
        let (name, port) = match host.rsplit_once(':') {
            Some((name, port))
                if !name.contains(':') && !port.is_empty() && port.chars().all(|c| c.is_ascii_digit()) =>
            {
                (name, format!(":{port}"))
            }
            _ => (host, String::new()),
        };
        let resolved = if name.contains('.') || name.eq_ignore_ascii_case("localhost") || is_ipv4(name)
        {
            host.to_string()
        } else {
            format!("{name}.{DEFAULT_SERVER_DOMAIN}{port}")
        };
        format!("https://{resolved}{rest}")
    };
    let url = url::Url::parse(&with_scheme).ok()?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return None;
    }
    if url.host_str().is_none() {
        return None;
    }
    Some(url.origin().ascii_serialization())
}

fn sanitize_anchor(value: &str) -> String {
    const ANCHORS: [&str; 10] = [
        "top-left",
        "top-center",
        "top-right",
        "middle-left",
        "middle-center",
        "middle-right",
        "bottom-left",
        "bottom-center",
        "bottom-right",
        "manual",
    ];
    if ANCHORS.contains(&value) {
        value.to_string()
    } else {
        "top-left".to_string()
    }
}

fn sanitize_font_size(value: u32) -> u32 {
    value.clamp(OVERLAY_FONT_MIN, OVERLAY_FONT_MAX)
}

fn sanitize_color(value: &str) -> String {
    let color = value.trim().to_ascii_lowercase();
    if color.len() == 7 && color.starts_with('#') && color[1..].chars().all(|c| c.is_ascii_hexdigit())
    {
        color
    } else {
        OVERLAY_COLOR_DEFAULT.to_string()
    }
}

fn sanitize_servers(list: Vec<ServerEntry>) -> Vec<ServerEntry> {
    let mut result: Vec<ServerEntry> = Vec::new();
    for entry in list {
        let Some(url) = normalize_server_url(&entry.url) else {
            continue;
        };
        if result.iter().any(|existing| existing.url == url) {
            continue;
        }
        result.push(ServerEntry {
            url,
            name: entry.name.trim().chars().take(60).collect(),
            last_used: entry.last_used,
        });
        if result.len() >= 15 {
            break;
        }
    }
    result
}

fn sanitize_config(mut config: Config) -> Config {
    config.server_url = normalize_server_url(&config.server_url).unwrap_or_default();
    config.ptt_key = if config.ptt_key.trim().is_empty() {
        "V".to_string()
    } else {
        config.ptt_key.trim().to_string()
    };
    config.overlay_anchor = sanitize_anchor(&config.overlay_anchor);
    config.overlay_font_size = sanitize_font_size(config.overlay_font_size);
    config.overlay_color = sanitize_color(&config.overlay_color);
    config.servers = sanitize_servers(config.servers);
    config
}

fn load_config(path: &Path) -> Config {
    match std::fs::read_to_string(path) {
        Ok(raw) => serde_json::from_str::<Config>(&raw)
            .map(sanitize_config)
            .unwrap_or_default(),
        Err(_) => Config::default(),
    }
}

fn save_config(shared: &Shared, config: &Config) {
    if let Some(parent) = shared.config_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    match serde_json::to_string_pretty(config) {
        Ok(text) => {
            if let Err(error) = std::fs::write(&shared.config_path, text) {
                eprintln!("[la2speak] не удалось сохранить настройки: {error}");
            }
        }
        Err(error) => eprintln!("[la2speak] не удалось сериализовать настройки: {error}"),
    }
}

fn remember_server(shared: &Shared, url: &str, name: Option<&str>) {
    let mut config = shared.config.lock().unwrap();
    config.server_url = url.to_string();
    let clean_name: Option<String> = name
        .map(|value| value.trim().chars().take(60).collect())
        .filter(|value: &String| !value.is_empty());
    if let Some(index) = config.servers.iter().position(|entry| entry.url == url) {
        let mut entry = config.servers.remove(index);
        entry.last_used = now_millis();
        if let Some(clean) = clean_name {
            entry.name = clean;
        }
        config.servers.insert(0, entry);
    } else {
        config.servers.insert(
            0,
            ServerEntry {
                url: url.to_string(),
                name: clean_name.unwrap_or_default(),
                last_used: now_millis(),
            },
        );
    }
    config.servers = sanitize_servers(config.servers.clone());
    save_config(shared, &config);
}

// ---------------------------------------------------------------------------
// Очередь событий для веб-клиента (её читает bridge.js через long-poll)
// ---------------------------------------------------------------------------

fn emit_web(app: &AppHandle, event: Value) {
    let shared = app.state::<Shared>();
    {
        let mut queue = shared.queue.lock().unwrap();
        if queue.len() >= 500 {
            queue.pop_front();
        }
        queue.push_back(event);
    }
    shared.wake.notify_all();
}

fn poll_events(app: &AppHandle) -> Vec<Value> {
    let shared = app.state::<Shared>();
    let deadline = Instant::now() + Duration::from_secs(25);
    loop {
        let mut queue = shared.queue.lock().unwrap();
        if !queue.is_empty() {
            return queue.drain(..).collect();
        }
        let now = Instant::now();
        if now >= deadline {
            return Vec::new();
        }
        let (guard, _) = shared.wake.wait_timeout(queue, deadline - now).unwrap();
        drop(guard);
    }
}

// ---------------------------------------------------------------------------
// Горячие клавиши
// ---------------------------------------------------------------------------

fn is_key_token(token: &str) -> bool {
    if token.len() == 1 {
        let byte = token.as_bytes()[0];
        return byte.is_ascii_uppercase() || byte.is_ascii_digit();
    }
    const NAMED: [&str; 49] = [
        "Space",
        "Escape",
        "Backspace",
        "Enter",
        "Tab",
        "Delete",
        "Insert",
        "Home",
        "End",
        "PageUp",
        "PageDown",
        "PrintScreen",
        "NumLock",
        "ScrollLock",
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "CapsLock",
        "Semicolon",
        "Equal",
        "Comma",
        "Minus",
        "Period",
        "Slash",
        "Backquote",
        "BracketLeft",
        "Backslash",
        "BracketRight",
        "Quote",
        "Numpad0",
        "Numpad1",
        "Numpad2",
        "Numpad3",
        "Numpad4",
        "Numpad5",
        "Numpad6",
        "Numpad7",
        "Numpad8",
        "Numpad9",
        "NumpadMultiply",
        "NumpadAdd",
        "NumpadSubtract",
        "NumpadDecimal",
        "NumpadDivide",
        "Control",
        "Alt",
        "Shift",
        "Meta",
    ];
    if NAMED.contains(&token) || token == "Mouse3" || token == "Mouse4" || token == "Mouse5" {
        return true;
    }
    if let Some(rest) = token.strip_prefix('F') {
        if let Ok(number) = rest.parse::<u32>() {
            return (1..=24).contains(&number);
        }
    }
    false
}

fn parse_accelerator(value: &str) -> Option<Hotkey> {
    let parts: Vec<&str> = value
        .split('+')
        .map(|part| part.trim())
        .filter(|part| !part.is_empty())
        .collect();
    let key = parts.last()?.to_string();
    if !is_key_token(&key) {
        return None;
    }
    let modifiers = &parts[..parts.len() - 1];
    Some(Hotkey {
        key,
        alt: modifiers.contains(&"Alt"),
        ctrl: modifiers.contains(&"Control"),
        shift: modifiers.contains(&"Shift"),
        meta: modifiers.contains(&"Meta"),
    })
}

fn modifiers_match(hot: &Hotkey, modifiers: &HashSet<String>) -> bool {
    (!hot.alt || modifiers.contains("Alt"))
        && (!hot.ctrl || modifiers.contains("Control"))
        && (!hot.shift || modifiers.contains("Shift"))
        && (!hot.meta || modifiers.contains("Meta"))
}

fn is_modifier(token: &str) -> bool {
    matches!(token, "Control" | "Alt" | "Shift" | "Meta")
}

// rdev отдаёт клавиши как enum с отладочными именами в стиле W3C KeyboardEvent.code.
fn key_token(key: rdev::Key) -> Option<String> {
    let name = format!("{key:?}");
    if let Some(rest) = name.strip_prefix("Key") {
        if rest.len() == 1 {
            let byte = rest.as_bytes()[0];
            if byte.is_ascii_uppercase() {
                return Some(rest.to_string());
            }
        }
    }
    if let Some(rest) = name.strip_prefix("Num") {
        if rest.len() == 1 {
            let byte = rest.as_bytes()[0];
            if byte.is_ascii_digit() {
                return Some(rest.to_string());
            }
        }
    }
    if let Some(rest) = name.strip_prefix('F') {
        if rest.parse::<u32>().is_ok() {
            return Some(name);
        }
    }
    if let Some(rest) = name.strip_prefix("Kp") {
        if rest.len() == 1 {
            let byte = rest.as_bytes()[0];
            if byte.is_ascii_digit() {
                return Some(format!("Numpad{rest}"));
            }
        }
    }
    let token = match name.as_str() {
        "Space" => "Space",
        "Escape" => "Escape",
        "Return" => "Enter",
        "Backspace" => "Backspace",
        "Tab" => "Tab",
        "Delete" => "Delete",
        "Insert" => "Insert",
        "Home" => "Home",
        "End" => "End",
        "PageUp" => "PageUp",
        "PageDown" => "PageDown",
        "PrintScreen" => "PrintScreen",
        "ScrollLock" => "ScrollLock",
        "NumLock" => "NumLock",
        "CapsLock" => "CapsLock",
        "UpArrow" => "ArrowUp",
        "DownArrow" => "ArrowDown",
        "LeftArrow" => "ArrowLeft",
        "RightArrow" => "ArrowRight",
        "Minus" => "Minus",
        "Equal" => "Equal",
        "Comma" => "Comma",
        "Dot" => "Period",
        "Slash" => "Slash",
        "BackSlash" => "Backslash",
        "SemiColon" => "Semicolon",
        "Quote" => "Quote",
        "BackQuote" => "Backquote",
        "LeftBracket" => "BracketLeft",
        "RightBracket" => "BracketRight",
        "KpMultiply" => "NumpadMultiply",
        "KpPlus" => "NumpadAdd",
        "KpMinus" => "NumpadSubtract",
        "KpDelete" => "NumpadDecimal",
        "KpDivide" => "NumpadDivide",
        "ControlLeft" | "ControlRight" => "Control",
        "ShiftLeft" | "ShiftRight" => "Shift",
        "Alt" | "AltGr" => "Alt",
        "MetaLeft" | "MetaRight" => "Meta",
        _ => return None,
    };
    Some(token.to_string())
}

fn button_token(button: rdev::Button) -> Option<String> {
    match button {
        rdev::Button::Middle => Some("Mouse3".into()),
        // Windows отдаёт боковые кнопки как XBUTTON1/XBUTTON2.
        rdev::Button::Unknown(1) => Some("Mouse4".into()),
        rdev::Button::Unknown(2) => Some("Mouse5".into()),
        _ => None,
    }
}

fn handle_press(app: &AppHandle, token: &str, modifiers: &HashSet<String>) {
    let shared = app.state::<Shared>();
    let (ptt, bindings, held) = {
        let hotkeys = shared.hotkeys.lock().unwrap();
        (
            hotkeys.ptt.clone(),
            hotkeys.bindings.clone(),
            hotkeys.broadcast_held.clone(),
        )
    };

    if let Some(binding) = bindings
        .iter()
        .find(|binding| binding.hot.key == token && modifiers_match(&binding.hot, modifiers))
    {
        if held.contains(&binding.target) {
            return;
        }
        shared
            .hotkeys
            .lock()
            .unwrap()
            .broadcast_held
            .insert(binding.target.clone());
        if binding.mode == "ptt" {
            emit_web(
                app,
                json!({ "type": "broadcast-state", "target": binding.target, "active": true }),
            );
        } else {
            emit_web(
                app,
                json!({ "type": "broadcast-toggle", "target": binding.target }),
            );
        }
        return;
    }

    let mode = *shared.mic_mode.lock().unwrap();
    let Some(ptt) = ptt else {
        return;
    };
    if ptt.key != token || !modifiers_match(&ptt, modifiers) {
        return;
    }
    match mode {
        MicMode::Toggle => {
            let mut hotkeys = shared.hotkeys.lock().unwrap();
            if hotkeys.mic_held {
                return;
            }
            hotkeys.mic_held = true;
            drop(hotkeys);
            emit_web(app, json!({ "type": "mic-toggle" }));
        }
        MicMode::Ptt => {
            let mut hotkeys = shared.hotkeys.lock().unwrap();
            if hotkeys.ptt_held {
                return;
            }
            hotkeys.ptt_held = true;
            drop(hotkeys);
            emit_web(app, json!({ "type": "ptt", "down": true }));
        }
        MicMode::Voice => {}
    }
}

fn handle_release(app: &AppHandle, token: &str) {
    let shared = app.state::<Shared>();
    let mode = *shared.mic_mode.lock().unwrap();
    let (bindings, ptt) = {
        let hotkeys = shared.hotkeys.lock().unwrap();
        (hotkeys.bindings.clone(), hotkeys.ptt.clone())
    };

    let mut released: Vec<String> = Vec::new();
    {
        let mut hotkeys = shared.hotkeys.lock().unwrap();
        for binding in &bindings {
            if binding.hot.key != token {
                continue;
            }
            if hotkeys.broadcast_held.remove(&binding.target) && binding.mode == "ptt" {
                released.push(binding.target.clone());
            }
        }
    }
    for target in released {
        emit_web(
            app,
            json!({ "type": "broadcast-state", "target": target, "active": false }),
        );
    }

    let Some(ptt) = ptt else {
        return;
    };
    if ptt.key != token {
        return;
    }
    let mut hotkeys = shared.hotkeys.lock().unwrap();
    hotkeys.mic_held = false;
    let was_held = hotkeys.ptt_held;
    hotkeys.ptt_held = false;
    drop(hotkeys);
    if mode == MicMode::Ptt && was_held {
        emit_web(app, json!({ "type": "ptt", "down": false }));
    }
}

fn start_hotkeys(app: AppHandle) {
    thread::spawn(move || {
        let mut modifiers: HashSet<String> = HashSet::new();
        let callback_app = app.clone();
        let result = rdev::listen(move |event| match event.event_type {
            rdev::EventType::KeyPress(key) => {
                if let Some(token) = key_token(key) {
                    if is_modifier(&token) {
                        modifiers.insert(token.clone());
                    }
                    handle_press(&callback_app, &token, &modifiers);
                }
            }
            rdev::EventType::KeyRelease(key) => {
                if let Some(token) = key_token(key) {
                    handle_release(&callback_app, &token);
                    modifiers.remove(&token);
                }
            }
            rdev::EventType::ButtonPress(button) => {
                if let Some(token) = button_token(button) {
                    handle_press(&callback_app, &token, &modifiers);
                }
            }
            rdev::EventType::ButtonRelease(button) => {
                if let Some(token) = button_token(button) {
                    handle_release(&callback_app, &token);
                }
            }
            _ => {}
        });
        if result.is_err() {
            let shared = app.state::<Shared>();
            shared.hotkeys_ok.store(false, Ordering::SeqCst);
            eprintln!("[la2speak] глобальные горячие клавиши недоступны");
        }
    });
}

// ---------------------------------------------------------------------------
// Микрофон и трей
// ---------------------------------------------------------------------------

fn sanitize_mic_state(value: &Value) -> MicState {
    MicState {
        in_call: value.get("inCall").and_then(|v| v.as_bool()).unwrap_or(false),
        on: value.get("on").and_then(|v| v.as_bool()).unwrap_or(false),
        muted: value.get("muted").and_then(|v| v.as_bool()).unwrap_or(false),
        broadcasting: value
            .get("broadcasting")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        channel_name: value
            .get("channelName")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .chars()
            .take(60)
            .collect(),
    }
}

fn tray_image(name: &str) -> tauri::Result<Image<'static>> {
    let bytes: &'static [u8] = match name {
        "mic-on" => include_bytes!("../icons/mic-on.png"),
        "mic-off" => include_bytes!("../icons/mic-off.png"),
        "overlay-on" => include_bytes!("../icons/overlay-on.png"),
        "overlay-off" => include_bytes!("../icons/overlay-off.png"),
        _ => include_bytes!("../icons/mic-idle.png"),
    };
    Image::from_bytes(bytes)
}

fn update_tray(app: &AppHandle) {
    let shared = app.state::<Shared>();
    let mic = shared.mic.lock().unwrap().clone();
    let tray = shared.tray.lock().unwrap();
    let Some(handles) = tray.as_ref() else {
        return;
    };
    let icon_name = if mic.in_call {
        if mic.on {
            "mic-on"
        } else {
            "mic-off"
        }
    } else {
        "mic-idle"
    };
    if let Ok(image) = tray_image(icon_name) {
        let _ = handles.tray.set_icon(Some(image));
    }
    let label = if mic.in_call {
        format!(
            "Микрофон: {}",
            if mic.on { "включён" } else { "выключен" }
        )
    } else {
        "Микрофон: не в канале".to_string()
    };
    let _ = handles.toggle.set_text(label);
    let _ = handles.toggle.set_enabled(mic.in_call);

    let mut parts: Vec<String> = vec!["LA2Speak".into()];
    if !mic.in_call {
        parts.push("не в голосовом канале".into());
    } else {
        if !mic.channel_name.is_empty() {
            parts.push(format!("«{}»", mic.channel_name));
        }
        parts.push(if mic.on {
            "микрофон включён".into()
        } else {
            "микрофон выключен".into()
        });
    }
    if mic.broadcasting {
        parts.push("эфир".into());
    }
    let tooltip = parts.join(" · ");
    let _ = handles.tray.set_tooltip(Some(tooltip.as_str()));
}

fn send_mic_toggle(app: &AppHandle) {
    emit_web(app, json!({ "type": "mic-toggle" }));
}

fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let toggle = MenuItem::with_id(
        app,
        "mic-toggle",
        "Микрофон: не в канале",
        false,
        None::<&str>,
    )?;
    let show = MenuItem::with_id(app, "show", "Показать LA2Speak", true, None::<&str>)?;
    let change = MenuItem::with_id(app, "change-server", "Сменить сервер…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
    let separator_one = PredefinedMenuItem::separator(app)?;
    let separator_two = PredefinedMenuItem::separator(app)?;
    let items: [&dyn IsMenuItem<Wry>; 6] = [
        &toggle,
        &separator_one,
        &show,
        &change,
        &separator_two,
        &quit,
    ];
    let menu = Menu::with_items(app, &items)?;
    let tray = TrayIconBuilder::new()
        .icon(tray_image("mic-idle")?)
        .tooltip("LA2Speak")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "mic-toggle" => send_mic_toggle(app),
            "show" => show_main(app),
            "change-server" => {
                let _ = open_launcher(app);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;

    app.state::<Shared>()
        .tray
        .lock()
        .unwrap()
        .replace(TrayHandles { toggle, tray });
    update_tray(app);
    Ok(())
}

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }
    if let Some(window) = app.get_webview_window("launcher") {
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }
    if let Err(error) = open_launcher(app) {
        eprintln!("[la2speak] не удалось открыть лаунчер: {error}");
    }
}

// ---------------------------------------------------------------------------
// Окна
// ---------------------------------------------------------------------------

fn bridge_script(shared: &Shared) -> String {
    BRIDGE_JS
        .replace("__BRIDGE_PORT__", &shared.port.to_string())
        .replace("__BRIDGE_TOKEN__", &shared.token)
        .replace("__BRIDGE_PLATFORM__", std::env::consts::OS)
}

fn create_main_window(app: &AppHandle, url: &str) -> Result<WebviewWindow, String> {
    let parsed = url::Url::parse(url).map_err(|error| error.to_string())?;
    if let Some(window) = app.get_webview_window("main") {
        window
            .navigate(parsed)
            .map_err(|error| error.to_string())?;
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(window);
    }

    let shared = app.state::<Shared>();
    let script = bridge_script(&shared);
    let origin = parsed.origin().ascii_serialization();
    let nav_app = app.clone();

    let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(parsed))
        .title("LA2Speak")
        .inner_size(1320.0, 860.0)
        .min_inner_size(960.0, 600.0)
        .decorations(false)
        .initialization_script(&script)
        .initialization_script(DRAG_JS)
        .on_navigation(move |target| {
            let same = target.origin().ascii_serialization() == origin;
            if !same && (target.scheme() == "http" || target.scheme() == "https") {
                let _ = nav_app.opener().open_url(target.as_str(), None::<&str>);
            }
            same
        })
        .build()
        .map_err(|error| error.to_string())?;

    let event_app = app.clone();
    let event_window = window.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::Resized(_) => {
            let maximized = event_window.is_maximized().unwrap_or(false);
            let shared = event_app.state::<Shared>();
            if shared.maximized.swap(maximized, Ordering::SeqCst) != maximized {
                emit_web(
                    &event_app,
                    json!({ "type": "maximize-changed", "maximized": maximized }),
                );
            }
        }
        WindowEvent::CloseRequested { .. } => event_app.exit(0),
        _ => {}
    });

    Ok(window)
}

fn open_launcher(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("launcher") {
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }
    WebviewWindowBuilder::new(app, "launcher", WebviewUrl::App("launcher.html".into()))
        .title("LA2Speak — подключение")
        .inner_size(560.0, 640.0)
        .resizable(false)
        .maximizable(false)
        .decorations(false)
        .build()?;
    Ok(())
}

fn resolve_start_url(shared: &Shared) -> Option<String> {
    let config = shared.config.lock().unwrap();
    normalize_server_url(&config.server_url)
}

// ---------------------------------------------------------------------------
// Оверлей канала
// ---------------------------------------------------------------------------

fn overlay_config_value(config: &Config, editing: bool) -> Value {
    json!({
        "enabled": config.overlay_enabled,
        "anchor": sanitize_anchor(&config.overlay_anchor),
        "position": config.overlay_position,
        "editing": editing,
        "fontSize": config.overlay_font_size,
        "color": config.overlay_color,
    })
}

fn overlay_metrics(font_size: u32) -> (f64, f64) {
    let delta = font_size as f64 - OVERLAY_FONT_DEFAULT as f64;
    (OVERLAY_WIDTH + delta * 8.0, OVERLAY_ROW + delta)
}

fn overlay_bounds(
    window: &WebviewWindow,
    config: &Config,
    count: usize,
    editing: bool,
) -> (f64, f64, f64, f64) {
    let (monitor_x, monitor_y, monitor_width, monitor_height) = match window.primary_monitor() {
        Ok(Some(monitor)) => {
            let scale = monitor.scale_factor();
            (
                monitor.position().x as f64 / scale,
                monitor.position().y as f64 / scale,
                monitor.size().width as f64 / scale,
                monitor.size().height as f64 / scale,
            )
        }
        _ => (0.0, 0.0, 1920.0, 1080.0),
    };
    let (mut width, row) = overlay_metrics(sanitize_font_size(config.overlay_font_size));
    width = width.min(monitor_width - 24.0);
    let rows = count.clamp(1, 30) as f64;
    let height = (14.0 + rows * row + if editing { OVERLAY_EDIT_BAR } else { 0.0 })
        .min(monitor_height * 0.7);
    let margin = 12.0;
    let anchor = sanitize_anchor(&config.overlay_anchor);

    if anchor == "manual" {
        if let Some(position) = &config.overlay_position {
            let x = (position.x as f64)
                .min(monitor_x + monitor_width - width)
                .max(monitor_x);
            let y = (position.y as f64)
                .min(monitor_y + monitor_height - height)
                .max(monitor_y);
            return (x, y, width, height);
        }
    }

    let (vertical, horizontal) = anchor.split_once('-').unwrap_or(("top", "left"));
    let x = match horizontal {
        "left" => monitor_x + margin,
        "right" => monitor_x + monitor_width - width - margin,
        _ => monitor_x + (monitor_width - width) / 2.0,
    };
    let y = match vertical {
        "top" => monitor_y + margin,
        "bottom" => monitor_y + monitor_height - height - margin,
        _ => monitor_y + (monitor_height - height) / 2.0,
    };
    (
        x.min(monitor_x + monitor_width - width).max(monitor_x),
        y.min(monitor_y + monitor_height - height).max(monitor_y),
        width,
        height,
    )
}

fn ensure_overlay_window(app: &AppHandle) -> Option<WebviewWindow> {
    if let Some(window) = app.get_webview_window("overlay") {
        return Some(window);
    }
    let window = WebviewWindowBuilder::new(app, "overlay", WebviewUrl::App("overlay.html".into()))
        .title("LA2Speak — канал")
        .inner_size(OVERLAY_WIDTH, 100.0)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .shadow(false)
        .focused(false)
        .visible(false)
        .build();
    match window {
        Ok(window) => {
            let _ = window.set_ignore_cursor_events(true);
            Some(window)
        }
        Err(error) => {
            eprintln!("[la2speak] не удалось создать оверлей: {error}");
            None
        }
    }
}

fn apply_overlay(app: &AppHandle) {
    let shared = app.state::<Shared>();
    let config = shared.config.lock().unwrap().clone();
    let (state, editing) = {
        let runtime = shared.overlay.lock().unwrap();
        (runtime.state.clone(), runtime.editing)
    };
    let visible = editing || (config.overlay_enabled && state.is_some());
    let Some(window) = ensure_overlay_window(app) else {
        return;
    };
    if !visible {
        let _ = window.hide();
        return;
    }
    let count = state
        .as_ref()
        .and_then(|value| value.get("participants"))
        .and_then(|value| value.as_array())
        .map(|list| list.len())
        .unwrap_or(0);
    let (x, y, width, height) = overlay_bounds(&window, &config, count, editing);
    // Пока включён режим настройки, окно не переставляем: иначе очередное
    // обновление состояния вернуло бы его на якорь посреди перетаскивания.
    if !editing {
        let _ = window.set_position(Position::Logical(LogicalPosition::new(x, y)));
    }
    let _ = window.set_size(Size::Logical(LogicalSize::new(width, height)));
    if let Some(state) = state {
        let _ = window.emit("overlay:state", state);
    }
    let _ = window.emit(
        "overlay:style",
        json!({ "fontSize": config.overlay_font_size, "color": config.overlay_color }),
    );
    let _ = window.emit("overlay:edit", editing);
    let _ = window.show();
}

fn set_overlay_editing(app: &AppHandle, editing: bool) {
    let shared = app.state::<Shared>();
    if shared.overlay.lock().unwrap().editing == editing {
        return;
    }
    shared.overlay.lock().unwrap().editing = editing;

    if let Some(window) = ensure_overlay_window(app) {
        let _ = window.set_ignore_cursor_events(!editing);
        if editing {
            // Перед перетаскиванием ставим окно на сохранённый якорь.
            let config = shared.config.lock().unwrap().clone();
            let (x, y, width, height) = overlay_bounds(&window, &config, 0, true);
            let _ = window.set_position(Position::Logical(LogicalPosition::new(x, y)));
            let _ = window.set_size(Size::Logical(LogicalSize::new(width, height)));
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
    apply_overlay(app);

    let config_value = {
        let config = shared.config.lock().unwrap();
        overlay_config_value(&config, editing)
    };
    emit_web(
        app,
        json!({ "type": "overlay-config", "config": config_value }),
    );

    if editing {
        // Режим настройки не должен остаться включённым навсегда: иначе
        // оверлей продолжит перехватывать мышь поверх чужих окон.
        let generation = shared.edit_generation.fetch_add(1, Ordering::SeqCst) + 1;
        let timer_app = app.clone();
        thread::spawn(move || {
            thread::sleep(Duration::from_secs(120));
            let shared = timer_app.state::<Shared>();
            if shared.edit_generation.load(Ordering::SeqCst) == generation
                && shared.overlay.lock().unwrap().editing
            {
                finish_overlay_editing(&timer_app);
            }
        });
    } else {
        shared.edit_generation.fetch_add(1, Ordering::SeqCst);
    }
}

fn finish_overlay_editing(app: &AppHandle) {
    let shared = app.state::<Shared>();
    if !shared.overlay.lock().unwrap().editing {
        return;
    }
    if let Some(window) = app.get_webview_window("overlay") {
        if let Ok(position) = window.outer_position() {
            let scale = window.scale_factor().unwrap_or(1.0);
            let mut config = shared.config.lock().unwrap();
            config.overlay_anchor = "manual".into();
            config.overlay_position = Some(OverlayPosition {
                x: (position.x as f64 / scale).round() as i32,
                y: (position.y as f64 / scale).round() as i32,
            });
            save_config(&shared, &config);
        }
    }
    set_overlay_editing(app, false);
    apply_overlay(app);
}

fn apply_overlay_config(app: &AppHandle, patch: &Value) -> Value {
    let shared = app.state::<Shared>();
    let mut editing: Option<bool> = None;
    {
        let mut config = shared.config.lock().unwrap();
        if let Some(enabled) = patch.get("enabled").and_then(|value| value.as_bool()) {
            config.overlay_enabled = enabled;
        }
        if let Some(anchor) = patch.get("anchor").and_then(|value| value.as_str()) {
            let normalized = sanitize_anchor(anchor);
            if normalized == anchor {
                config.overlay_anchor = normalized;
            }
        }
        if let Some(font_size) = patch.get("fontSize").and_then(|value| value.as_u64()) {
            config.overlay_font_size = sanitize_font_size(font_size as u32);
        }
        if let Some(color) = patch.get("color").and_then(|value| value.as_str()) {
            config.overlay_color = sanitize_color(color);
        }
        if let Some(value) = patch.get("editing").and_then(|value| value.as_bool()) {
            editing = Some(value);
        }
        save_config(&shared, &config);
    }
    if let Some(editing) = editing {
        set_overlay_editing(app, editing);
    }
    apply_overlay(app);
    let config = shared.config.lock().unwrap();
    let value = overlay_config_value(&config, shared.overlay.lock().unwrap().editing);
    emit_web(
        app,
        json!({ "type": "overlay-config", "config": value.clone() }),
    );
    value
}

fn sanitize_overlay_state(value: &Value) -> Option<Value> {
    let participants = value.get("participants")?.as_array()?;
    let mut cleaned: Vec<Value> = Vec::new();
    for item in participants.iter().take(100) {
        let Some(person) = item.as_object() else {
            continue;
        };
        let name: String = person
            .get("name")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .trim()
            .chars()
            .take(48)
            .collect();
        if name.is_empty() {
            continue;
        }
        cleaned.push(json!({
            "sessionId": person.get("sessionId").and_then(|v| v.as_str()).unwrap_or("").chars().take(80).collect::<String>(),
            "name": name,
            "self": person.get("self").and_then(|v| v.as_bool()).unwrap_or(false),
            "speaking": person.get("speaking").and_then(|v| v.as_bool()).unwrap_or(false),
            "muted": person.get("muted").and_then(|v| v.as_bool()).unwrap_or(false),
            "deafened": person.get("deafened").and_then(|v| v.as_bool()).unwrap_or(false),
            "broadcasting": person.get("broadcasting").and_then(|v| v.as_bool()).unwrap_or(false),
            "screen": person.get("screen").and_then(|v| v.as_bool()).unwrap_or(false),
        }));
    }
    if cleaned.is_empty() {
        return None;
    }
    let channel_name: String = value
        .get("channelName")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .trim()
        .chars()
        .take(60)
        .collect();
    Some(json!({ "channelName": channel_name, "participants": cleaned }))
}

// ---------------------------------------------------------------------------
// HTTP-мост для удалённого веб-клиента
// ---------------------------------------------------------------------------

fn random_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn serve(server: tiny_http::Server, app: AppHandle) {
    for request in server.incoming_requests() {
        let app = app.clone();
        thread::spawn(move || handle_http(&app, request));
    }
}

fn cors_headers(origin: Option<&str>) -> Vec<(String, String)> {
    vec![
        (
            "Access-Control-Allow-Origin".into(),
            origin.unwrap_or("*").to_string(),
        ),
        ("Access-Control-Allow-Methods".into(), "POST, OPTIONS".into()),
        (
            "Access-Control-Allow-Headers".into(),
            "content-type, x-bridge-token".into(),
        ),
        (
            "Access-Control-Allow-Private-Network".into(),
            "true".into(),
        ),
        ("Access-Control-Max-Age".into(), "600".into()),
        ("Cache-Control".into(), "no-store".into()),
        ("Vary".into(), "Origin".into()),
    ]
}

fn respond(request: tiny_http::Request, cors: &[(String, String)], body: String) {
    let mut headers: Vec<tiny_http::Header> = Vec::new();
    for (name, value) in cors {
        if let Ok(header) = tiny_http::Header::from_bytes(name.as_bytes(), value.as_bytes()) {
            headers.push(header);
        }
    }
    if let Ok(header) = tiny_http::Header::from_bytes(
        &b"Content-Type"[..],
        &b"application/json; charset=utf-8"[..],
    ) {
        headers.push(header);
    }
    let mut response = tiny_http::Response::from_string(body);
    for header in headers {
        response.add_header(header);
    }
    let _ = request.respond(response);
}

fn handle_http(app: &AppHandle, mut request: tiny_http::Request) {
    let origin = request
        .headers()
        .iter()
        .find(|header| header.field.equiv("Origin"))
        .map(|header| header.value.as_str().to_string());
    let cors = cors_headers(origin.as_deref());

    if request.method() == &tiny_http::Method::Options {
        respond(request, &cors, "{}".into());
        return;
    }
    if request.method() != &tiny_http::Method::Post || request.url() != "/rpc" {
        respond(request, &cors, "{\"error\":\"not found\"}".into());
        return;
    }

    let token = request
        .headers()
        .iter()
        .find(|header| header.field.equiv("x-bridge-token"))
        .map(|header| header.value.as_str().to_string());
    let shared = app.state::<Shared>();
    if token.as_deref() != Some(shared.token.as_str()) {
        respond(request, &cors, "{\"error\":\"forbidden\"}".into());
        return;
    }

    let mut body = String::new();
    if request
        .as_reader()
        .take(1_048_576)
        .read_to_string(&mut body)
        .is_err()
    {
        respond(request, &cors, "{\"error\":\"bad body\"}".into());
        return;
    }
    let payload: Value = match serde_json::from_str(&body) {
        Ok(value) => value,
        Err(_) => {
            respond(request, &cors, "{\"error\":\"bad json\"}".into());
            return;
        }
    };
    let method = payload
        .get("method")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    let params = payload.get("params").cloned().unwrap_or(Value::Null);
    let response = match dispatch(app, method, &params) {
        Ok(result) => json!({ "result": result }),
        Err(error) => json!({ "error": error }),
    };
    respond(request, &cors, response.to_string());
}

fn current_origin(app: &AppHandle, shared: &Shared) -> String {
    if let Some(window) = app.get_webview_window("main") {
        if let Ok(url) = window.url() {
            return url.origin().ascii_serialization();
        }
    }
    let config = shared.config.lock().unwrap();
    normalize_server_url(&config.server_url).unwrap_or_default()
}

fn server_list(app: &AppHandle, shared: &Shared) -> Vec<Value> {
    let current = current_origin(app, shared);
    let config = shared.config.lock().unwrap();
    config
        .servers
        .iter()
        .map(|entry| {
            json!({
                "url": entry.url,
                "name": entry.name,
                "lastUsed": entry.last_used,
                "current": entry.url == current,
            })
        })
        .collect()
}

fn dispatch(app: &AppHandle, method: &str, params: &Value) -> Result<Value, String> {
    let shared = app.state::<Shared>();
    match method {
        "poll" => Ok(Value::Array(poll_events(app))),
        "setPttKey" => {
            let accelerator = params
                .get("accelerator")
                .and_then(|value| value.as_str())
                .unwrap_or("")
                .to_string();
            let parsed = parse_accelerator(&accelerator);
            {
                let mut config = shared.config.lock().unwrap();
                config.ptt_key = if accelerator.trim().is_empty() {
                    "V".into()
                } else {
                    accelerator.trim().to_string()
                };
                save_config(&shared, &config);
            }
            let was_held = {
                let mut hotkeys = shared.hotkeys.lock().unwrap();
                hotkeys.ptt = parsed.clone();
                hotkeys.mic_held = false;
                let held = hotkeys.ptt_held;
                hotkeys.ptt_held = false;
                held
            };
            if was_held {
                emit_web(app, json!({ "type": "ptt", "down": false }));
            }
            Ok(json!({ "ok": parsed.is_some() }))
        }
        "setMicMode" => {
            let mode = MicMode::parse(params.get("mode").and_then(|value| value.as_str()));
            *shared.mic_mode.lock().unwrap() = mode;
            let was_held = {
                let mut hotkeys = shared.hotkeys.lock().unwrap();
                hotkeys.mic_held = false;
                let held = hotkeys.ptt_held;
                hotkeys.ptt_held = false;
                held
            };
            if was_held {
                emit_web(app, json!({ "type": "ptt", "down": false }));
            }
            Ok(json!({ "mode": mode.as_str() }))
        }
        "setMicState" => {
            let state = params.get("state").cloned().unwrap_or(Value::Null);
            *shared.mic.lock().unwrap() = sanitize_mic_state(&state);
            update_tray(app);
            Ok(json!({ "ok": true }))
        }
        "setOverlayState" => {
            let state = params.get("state").cloned().unwrap_or(Value::Null);
            let cleaned = sanitize_overlay_state(&state);
            shared.overlay.lock().unwrap().state = cleaned;
            apply_overlay(app);
            Ok(json!({ "ok": true }))
        }
        "getOverlayConfig" => {
            let config = shared.config.lock().unwrap();
            let editing = shared.overlay.lock().unwrap().editing;
            Ok(overlay_config_value(&config, editing))
        }
        "setOverlayConfig" => {
            let patch = params.get("patch").cloned().unwrap_or(Value::Null);
            Ok(apply_overlay_config(app, &patch))
        }
        "setOverlayEditMode" => {
            let editing = params
                .get("editing")
                .and_then(|value| value.as_bool())
                .unwrap_or(false);
            if editing {
                set_overlay_editing(app, true);
            } else {
                finish_overlay_editing(app);
            }
            let config = shared.config.lock().unwrap();
            Ok(overlay_config_value(
                &config,
                shared.overlay.lock().unwrap().editing,
            ))
        }
        "setBroadcastKeys" => {
            let mut parsed: Vec<Binding> = Vec::new();
            if let Some(list) = params.get("bindings").and_then(|value| value.as_array()) {
                for item in list {
                    let Some(target) = item.get("target").and_then(|value| value.as_str()) else {
                        continue;
                    };
                    let Some(accelerator) = item.get("accelerator").and_then(|value| value.as_str())
                    else {
                        continue;
                    };
                    let Some(hot) = parse_accelerator(accelerator) else {
                        continue;
                    };
                    parsed.push(Binding {
                        target: target.to_string(),
                        mode: if item.get("mode").and_then(|value| value.as_str()) == Some("ptt") {
                            "ptt".into()
                        } else {
                            "toggle".into()
                        },
                        hot,
                    });
                }
            }
            let count = parsed.len();
            {
                let mut hotkeys = shared.hotkeys.lock().unwrap();
                hotkeys.bindings = parsed;
                hotkeys.broadcast_held.clear();
            }
            Ok(json!({ "count": count }))
        }
        "hotkeysAvailable" => Ok(json!({
            "available": shared.hotkeys_ok.load(Ordering::SeqCst)
        })),
        "changeServer" => {
            open_launcher(app).map_err(|error| error.to_string())?;
            Ok(json!({}))
        }
        "listServers" => Ok(json!({ "servers": server_list(app, &shared) })),
        "switchServer" => {
            let value = params
                .get("url")
                .and_then(|value| value.as_str())
                .unwrap_or("");
            let normalized =
                normalize_server_url(value).ok_or_else(|| "Некорректный адрес сервера".to_string())?;
            remember_server(&shared, &normalized, None);
            create_main_window(app, &normalized)?;
            Ok(json!({ "url": normalized }))
        }
        "setServerName" => {
            let name = params
                .get("name")
                .and_then(|value| value.as_str())
                .unwrap_or("")
                .trim()
                .chars()
                .take(60)
                .collect::<String>();
            if name.is_empty() {
                return Ok(json!({}));
            }
            let current = current_origin(app, &shared);
            let normalized = normalize_server_url(&current).ok_or_else(|| "Нет сервера".to_string())?;
            let mut config = shared.config.lock().unwrap();
            if let Some(entry) = config.servers.iter_mut().find(|entry| entry.url == normalized) {
                entry.name = name;
            } else {
                config.servers.insert(
                    0,
                    ServerEntry {
                        url: normalized,
                        name,
                        last_used: now_millis(),
                    },
                );
            }
            save_config(&shared, &config);
            Ok(json!({}))
        }
        "getVersion" => Ok(json!({ "version": CONFIG_VERSION })),
        "window.minimize" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.minimize();
            }
            Ok(json!({}))
        }
        "window.toggleMaximize" => {
            let Some(window) = app.get_webview_window("main") else {
                return Ok(json!({ "maximized": false }));
            };
            let maximized = window.is_maximized().unwrap_or(false);
            if maximized {
                let _ = window.unmaximize();
            } else {
                let _ = window.maximize();
            }
            Ok(json!({ "maximized": !maximized }))
        }
        "window.isMaximized" => {
            let maximized = app
                .get_webview_window("main")
                .and_then(|window| window.is_maximized().ok())
                .unwrap_or(false);
            Ok(json!({ "maximized": maximized }))
        }
        "window.close" => {
            app.exit(0);
            Ok(json!({}))
        }
        "window.startDragging" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.start_dragging();
            }
            Ok(json!({}))
        }
        _ => Err(format!("unknown method: {method}")),
    }
}

// ---------------------------------------------------------------------------
// Команды лаунчера и оверлея (локальные окна)
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SwitchResult {
    ok: bool,
    url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerInfo {
    url: String,
    name: String,
    last_used: u64,
    current: bool,
}

fn launcher_server_list(shared: &Shared) -> Vec<ServerInfo> {
    let config = shared.config.lock().unwrap();
    let current = normalize_server_url(&config.server_url).unwrap_or_default();
    config
        .servers
        .iter()
        .map(|entry| ServerInfo {
            url: entry.url.clone(),
            name: entry.name.clone(),
            last_used: entry.last_used,
            current: entry.url == current,
        })
        .collect()
}

#[tauri::command]
fn launcher_servers(shared: tauri::State<'_, Shared>) -> Vec<ServerInfo> {
    launcher_server_list(&shared)
}

#[tauri::command]
fn launcher_current_url(shared: tauri::State<'_, Shared>) -> String {
    shared.config.lock().unwrap().server_url.clone()
}

#[tauri::command]
fn launcher_default_domain() -> String {
    DEFAULT_SERVER_DOMAIN.to_string()
}

#[tauri::command]
fn launcher_connect(
    app: AppHandle,
    shared: tauri::State<'_, Shared>,
    url: String,
) -> Result<SwitchResult, String> {
    let normalized = normalize_server_url(&url)
        .ok_or_else(|| "Укажите адрес сервера, например chat или chat.la2speak.com".to_string())?;
    remember_server(&shared, &normalized, None);
    if let Some(window) = app.get_webview_window("launcher") {
        let _ = window.close();
    }
    create_main_window(&app, &normalized)?;
    Ok(SwitchResult {
        ok: true,
        url: normalized,
    })
}

#[tauri::command]
fn launcher_quit(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn app_version() -> String {
    CONFIG_VERSION.to_string()
}

#[tauri::command]
fn window_minimize(window: WebviewWindow) {
    let _ = window.minimize();
}

#[tauri::command]
fn window_close(app: AppHandle, window: WebviewWindow) {
    let _ = window.close();
    // Как в Electron: закрытие последнего окна завершает приложение.
    if app.get_webview_window("main").is_none() {
        app.exit(0);
    }
}

#[tauri::command]
fn overlay_snapshot(shared: tauri::State<'_, Shared>) -> Value {
    let config = shared.config.lock().unwrap().clone();
    let (state, editing) = {
        let runtime = shared.overlay.lock().unwrap();
        (runtime.state.clone(), runtime.editing)
    };
    json!({
        "state": state,
        "editing": editing,
        "fontSize": config.overlay_font_size,
        "color": config.overlay_color,
    })
}

#[tauri::command]
fn overlay_end_edit(app: AppHandle) {
    finish_overlay_editing(&app);
}

// ---------------------------------------------------------------------------
// Запуск
// ---------------------------------------------------------------------------

pub fn run() {
    let server = match tiny_http::Server::http("127.0.0.1:0") {
        Ok(server) => server,
        Err(error) => {
            eprintln!("[la2speak] не удалось запустить локальный мост: {error}");
            return;
        }
    };
    let port = server
        .server_addr()
        .to_ip()
        .map(|address| address.port())
        .unwrap_or(0);
    let token = random_token();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            let handle = app.handle().clone();
            let config_path = handle
                .path()
                .app_config_dir()
                .unwrap_or_else(|_| PathBuf::from("."))
                .join("config.json");
            let config = load_config(&config_path);
            app.manage(Shared::new(config, config_path, token.clone(), port));

            let server_app = handle.clone();
            thread::spawn(move || serve(server, server_app));

            start_hotkeys(handle.clone());
            create_tray(&handle)?;

            let start_url = {
                let shared = handle.state::<Shared>();
                resolve_start_url(&shared)
            };
            if let Some(url) = start_url {
                if let Err(error) = create_main_window(&handle, &url) {
                    eprintln!("[la2speak] не удалось открыть сервер: {error}");
                    if let Err(error) = open_launcher(&handle) {
                        eprintln!("[la2speak] не удалось открыть лаунчер: {error}");
                    }
                }
            } else if let Err(error) = open_launcher(&handle) {
                eprintln!("[la2speak] не удалось открыть лаунчер: {error}");
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            launcher_servers,
            launcher_current_url,
            launcher_default_domain,
            launcher_connect,
            launcher_quit,
            app_version,
            window_minimize,
            window_close,
            overlay_snapshot,
            overlay_end_edit
        ])
        .build(tauri::generate_context!())
        .expect("не удалось собрать приложение LA2Speak")
        .run(|_app, _event| {});
}
