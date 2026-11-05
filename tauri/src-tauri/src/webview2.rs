//! WebView2 DevTools Protocol (CDP) — the Tauri counterpart of Electron's
//! `webContents.debugger`. Used for the same three things as main.js:
//! - `Emulation.setFocusEmulationEnabled`: X only checks for new posts while
//!   the page thinks it has focus.
//! - `Input.dispatchKeyEvent`: a real "." key press (X's load-new-posts key).
//! - `Runtime.evaluate`: run a page script and get its (awaited) result back,
//!   which Tauri's own `eval` can't do.

use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tauri::Webview;
use tokio::sync::oneshot;
use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
use windows::core::HSTRING;

type Reply = oneshot::Sender<Result<String, String>>;

/// Calls one CDP method on the webview and waits for its JSON reply.
pub async fn call(webview: &Webview, method: &str, params: Value) -> Result<Value, String> {
    let (tx, rx) = oneshot::channel();
    // Shared so whichever side finishes first (an early error here, or the
    // completion handler later) can send the reply.
    let tx: Arc<Mutex<Option<Reply>>> = Arc::new(Mutex::new(Some(tx)));
    let send = |tx: &Arc<Mutex<Option<Reply>>>, value: Result<String, String>| {
        if let Some(tx) = tx.lock().ok().and_then(|mut t| t.take()) {
            let _ = tx.send(value);
        }
    };

    let method = HSTRING::from(method);
    let params = HSTRING::from(params.to_string());
    let tx_main = tx.clone();
    webview
        .with_webview(move |platform| {
            let tx_done = tx_main.clone();
            let started = (|| -> windows::core::Result<()> {
                let core = unsafe { platform.controller().CoreWebView2()? };
                let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |hr, json| {
                    send(&tx_done, hr.map(|_| json.clone()).map_err(|e| format!("{e}: {json}")));
                    Ok(())
                }));
                unsafe { core.CallDevToolsProtocolMethod(&method, &params, &handler) }
            })();
            if let Err(e) = started {
                send(&tx_main, Err(e.to_string()));
            }
        })
        .map_err(|e| e.to_string())?;

    let text = rx.await.map_err(|_| "CDP call dropped".to_string())??;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

/// Evaluates an expression in the page (main world), awaiting a returned
/// promise, and returns its value.
pub async fn evaluate(webview: &Webview, expression: &str) -> Result<Value, String> {
    let reply = call(
        webview,
        "Runtime.evaluate",
        json!({ "expression": expression, "awaitPromise": true, "returnByValue": true }),
    )
    .await?;
    if let Some(details) = reply.get("exceptionDetails") {
        let text = details
            .pointer("/exception/description")
            .or_else(|| details.get("text"))
            .and_then(Value::as_str)
            .unwrap_or("script error");
        return Err(text.to_string());
    }
    Ok(reply.pointer("/result/value").cloned().unwrap_or(Value::Null))
}

pub async fn set_focus_emulation(webview: &Webview, enabled: bool) -> Result<(), String> {
    call(webview, "Emulation.setFocusEmulationEnabled", json!({ "enabled": enabled })).await?;
    Ok(())
}

/// Same key event main.js sends for X's "." shortcut.
pub async fn press_period(webview: &Webview) -> Result<(), String> {
    for kind in ["keyDown", "char", "keyUp"] {
        call(
            webview,
            "Input.dispatchKeyEvent",
            json!({
                "type": kind,
                "key": ".", "code": "Period", "text": ".", "unmodifiedText": ".",
                "windowsVirtualKeyCode": 190, "nativeVirtualKeyCode": 190,
            }),
        )
        .await?;
    }
    Ok(())
}
