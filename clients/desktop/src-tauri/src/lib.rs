use keyring::{Entry, Error as KeyringError};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Emitter, WebviewUrl, WebviewWindowBuilder};

const CREDENTIAL_SERVICE: &str = "com.triforce.remote";

pub fn smoke_test() {
    assert_eq!(CREDENTIAL_SERVICE, "com.triforce.remote");
    println!("Triforce desktop native entry point is ready");
}

#[tauri::command]
fn credential_get(host_id: String) -> Result<Option<String>, String> {
    match Entry::new(CREDENTIAL_SERVICE, &host_id)
        .map_err(|error| error.to_string())?
        .get_password()
    {
        Ok(value) => Ok(Some(value)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn credential_set(host_id: String, token: String) -> Result<(), String> {
    if token.is_empty() {
        return Err("credential cannot be empty".into());
    }
    Entry::new(CREDENTIAL_SERVICE, &host_id)
        .map_err(|error| error.to_string())?
        .set_password(&token)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn credential_delete(host_id: String) -> Result<(), String> {
    match Entry::new(CREDENTIAL_SERVICE, &host_id)
        .map_err(|error| error.to_string())?
        .delete_credential()
    {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let quit = PredefinedMenuItem::quit(app, Some("Quit Triforce"))?;
            let separator = PredefinedMenuItem::separator(app)?;
            let switch_host =
                MenuItem::with_id(app, "switch-host", "Switch Host", true, None::<&str>)?;
            let app_menu =
                Submenu::with_items(app, "Triforce", true, &[&switch_host, &separator, &quit])?;
            app.set_menu(Menu::with_items(app, &[&app_menu])?)?;
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Triforce Remote")
                .inner_size(1280.0, 820.0)
                .min_inner_size(360.0, 600.0)
                .resizable(true)
                .center()
                .on_navigation(|url| {
                    url.scheme() == "tauri"
                        || url.scheme() == "https" && url.host_str() == Some("tauri.localhost")
                        || url.scheme() == "http"
                            && matches!(url.host_str(), Some("127.0.0.1") | Some("localhost"))
                })
                .build()?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id().as_ref() == "switch-host" {
                let _ = app.emit("switch-host", ());
            }
        })
        .invoke_handler(tauri::generate_handler![
            credential_get,
            credential_set,
            credential_delete
        ])
        .run(tauri::generate_context!())
        .expect("error while running Triforce desktop");
}

#[cfg(test)]
mod tests {
    use super::CREDENTIAL_SERVICE;

    #[test]
    fn credential_namespace_is_application_specific() {
        assert_eq!(CREDENTIAL_SERVICE, "com.triforce.remote");
    }
}
