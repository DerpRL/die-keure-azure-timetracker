// Release builds on Windows are GUI apps: no console window next to the tray icon.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    att_desktop_lib::run();
}
