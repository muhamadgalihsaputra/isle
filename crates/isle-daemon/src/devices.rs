// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 zickrian

//! The Devices1 D-Bus object: what the island asks of a GSConnect device —
//! ring it, send it the clipboard, send it a file. Each call goes to the
//! device GSConnect names; a device that is gone answers plainly.

use std::sync::OnceLock;

use zbus::object_server::InterfaceRef;
use zbus::{Connection, interface};

use crate::system::{Device, SystemService};

/// The GSConnect service and its devices, on the session bus.
const SERVICE: &str = "org.gnome.Shell.Extensions.GSConnect";
const DEVICE: &str = "org.gnome.Shell.Extensions.GSConnect.Device";

/// The session bus and the system state, held for the AI's device tools once the service is built.
static SESSION: OnceLock<Connection> = OnceLock::new();
static SYSTEM: OnceLock<InterfaceRef<SystemService>> = OnceLock::new();

/// isled's `Devices1` D-Bus object.
pub struct DevicesService {
    session: Connection,
    system: InterfaceRef<SystemService>,
}

impl DevicesService {
    pub fn new(session: Connection, system: InterfaceRef<SystemService>) -> Self {
        SESSION.set(session.clone()).ok();
        SYSTEM.set(system.clone()).ok();
        Self { session, system }
    }

    /// A device's object path by its id in the state, if it is still connected.
    async fn device(&self, id: &str) -> zbus::Result<Device> {
        let devices = self.system.get().await.devices().to_vec();
        devices
            .into_iter()
            .find(|device| device.id == id)
            .ok_or_else(|| zbus::Error::Failure("no device connected".into()))
    }
}

#[interface(name = "io.github.zickrian.isle.Devices1")]
impl DevicesService {
    /// Rings the device, unless it is gone; returns an error text instead of failing silently.
    async fn ring(&self, id: &str) -> zbus::fdo::Result<()> {
        let device = self.device(id).await?;
        self.session
            .call_method(Some(SERVICE), device.id.as_str(), Some(DEVICE), "ring", &())
            .await?;
        Ok(())
    }

    /// Sends the clipboard to the device's share plugin.
    async fn send_clipboard(&self, id: &str, text: &str) -> zbus::fdo::Result<()> {
        let device = self.device(id).await?;
        self.session
            .call_method(Some(SERVICE), device.id.as_str(), Some(DEVICE), "shareText", &(text,))
            .await?;
        Ok(())
    }

    /// Sends a file to the device's share plugin; `path` is a local file path.
    async fn send_file(&self, id: &str, file: &str) -> zbus::fdo::Result<()> {
        let device = self.device(id).await?;
        self.session
            .call_method(Some(SERVICE), device.id.as_str(), Some(DEVICE), "shareUri", &(file,))
            .await?;
        Ok(())
    }

    /// Answers a ringing call on the device's telephony plugin; `accept` picks up or hangs up.
    async fn answer_call(&self, id: &str, accept: bool) -> zbus::fdo::Result<()> {
        let device = self.device(id).await?;
        self.session
            .call_method(Some(SERVICE), device.id.as_str(), Some(DEVICE), "reply", &(accept,))
            .await?;
        Ok(())
    }

    /// Sends a text back to the message's sender, through the device's telephony plugin.
    async fn reply_message(&self, id: &str, text: &str) -> zbus::fdo::Result<()> {
        let device = self.device(id).await?;
        self.session
            .call_method(Some(SERVICE), device.id.as_str(), Some(DEVICE), "reply", &(text,))
            .await?;
        Ok(())
    }
}

/// One of the AI's device tools (`find_phone`, `send_clipboard`), run on the session bus; its
/// outcome as text for the AI. GSConnect gone or no device connected answers plainly, never an
/// error dump.
pub async fn tool(call: &serde_json::Value) -> String {
    let (Some(session), Some(system)) = (SESSION.get(), SYSTEM.get()) else {
        return "No session bus, so no device tools.".into();
    };
    let devices = system.get().await.devices().to_vec();
    let Some(device) = devices.first() else {
        return "No device is connected through GSConnect.".into();
    };
    let method = match call["type"].as_str() {
        Some("find_phone") => "ring",
        Some("send_clipboard") => "shareText",
        _ => return "Unknown device tool.".into(),
    };
    let argument = call["text"].as_str().unwrap_or_default();
    let result = if method == "ring" {
        session
            .call_method(Some(SERVICE), device.id.as_str(), Some(DEVICE), method, &())
            .await
    } else {
        session
            .call_method(Some(SERVICE), device.id.as_str(), Some(DEVICE), method, &(argument,))
            .await
    };
    match result {
        Ok(_) => format!("Done on {}.", device.name),
        Err(_) => format!("{} did not answer; it may have gone.", device.name),
    }
}
