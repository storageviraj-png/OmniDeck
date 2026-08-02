// src-tauri/src/main.rs
//
// Wires server.rs (the embedded local room server) into a Tauri 2.x app.
//
// NOT compiled here — this environment has no Rust toolchain. Run
// `cargo check` from src-tauri/ after this lands and fix whatever the
// compiler flags. The APIs below (tauri::Manager::path(), BaseDirectory,
// WebviewWindowBuilder/WebviewUrl) are written against Tauri 2.x as of
// this writing; if `cargo check` shows a method missing, it's most likely
// this exact surface having moved again between 2.x point releases —
// check tauri::path::PathResolver's current docs first.

mod server;

use server::Room;
use std::path::PathBuf;
use tauri::{path::BaseDirectory, Manager, WebviewUrl, WebviewWindowBuilder};

const PORT: u16 = 4747;

// ----------------------------------------------------------------------------
// "Display Output" from the controller UI. NOT a new renderer — it opens
// the exact same output.html this server already serves for Web Output, in
// a native fullscreen window on this machine (for a projector or a second
// monitor). controller.js already builds the correct session URL for Web
// Output (see fetchOutputUrl() in sync-local.js, which asks this app's own
// server for the room's read-only VIEWER token) and just hands that same
// URL here — so there is exactly one place, on the JS side, that knows how
// to construct an output URL. This command's only job is opening it.
//
// Calling this again while the window is already open focuses the
// existing one instead of stacking a duplicate, so the operator can click
// "Display Output" more than once with no ill effect.
#[tauri::command]
fn open_output_window(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let parsed = url.parse().map_err(|e| format!("invalid output URL: {e}"))?;

    if let Some(existing) = app.get_webview_window("output") {
        return existing.set_focus().map_err(|e| e.to_string());
    }

    WebviewWindowBuilder::new(&app, "output", WebviewUrl::External(parsed))
        .title("OmniDeck Output")
        .fullscreen(true)
        .decorations(false)
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![open_output_window])
        .setup(|app| {
            // Tauri 2.x: path_resolver() was removed in favor of app.path(),
            // which implements the same app_data_dir()/resolve() methods.
            let app_data_dir: PathBuf = app
                .path()
                .app_data_dir()
                .expect("no app data dir available");

            let room = Room::load_or_create(&app_data_dir.join("room.json"))
                .expect("failed to load or create room");

            // The existing static project (controller.html/output.html/js/css)
            // is bundled as a resource under the name "static" — see
            // tauri.conf.json's bundle.resources, which maps those unchanged
            // top-level files/folders into resources/static/ at build time.
            let static_dir: PathBuf = app
                .path()
                .resolve("static", BaseDirectory::Resource)
                .expect("static resource dir not found — check tauri.conf.json's bundle.resources");

            let room_for_server = room.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = server::run(PORT, static_dir, room_for_server).await {
                    eprintln!("[OmniDeck] local server failed to start: {e}");
                }
            });

            // Open straight into the controller with its control token
            // already in the URL — no manual pairing step needed for the
            // common case of controller + output on this same machine.
            let controller_url = format!(
                "http://localhost:{PORT}/controller.html?room={}&token={}",
                room.room_id, room.control_token
            );
            WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External(controller_url.parse().unwrap()),
            )
            .title("OmniDeck")
            .build()?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running OmniDeck");
}
