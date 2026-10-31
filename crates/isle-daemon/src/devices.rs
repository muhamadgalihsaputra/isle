// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 zickrian

//! The Devices1 D-Bus object: what the island asks of a GSConnect device —
//! ring it, send it the clipboard, send it a file. Each call goes to the
//! device GSConnect names; a device that is gone answers plainly.

use std::sync::OnceLock;

use zbus::object_server::InterfaceRef;
use zbus::zvariant::Value as ZValue;
use zbus::{Connection, interface};

use crate::system::{Device, SystemService};

/// The GSConnect service, on the session bus.
const SERVICE: &str = "org.gnome.Shell.Extensions.GSConnect";

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

    /// Activates one of the device's actions over `org.gtk.Actions`, GSConnect's own way of
    /// exposing its plugins' actions on the bus.
    async fn activate(&self, device: &Device, action: &str, arguments: &[ZValue<'_>]) -> zbus::fdo::Result<()> {
        self.session
            .call_method(
                Some(SERVICE),
                device.id.as_str(),
                Some("org.gtk.Actions"),
                "Activate",
                &(action, arguments, &std::collections::HashMap::<String, ZValue>::new()),
            )
            .await?;
        Ok(())
    }
}

#[interface(name = "io.github.zickrian.isle.Devices1")]
impl DevicesService {
    /// Rings the device (Find My Phone), unless it is gone; returns an error text instead of
    /// failing silently. GSConnect exports its plugins' actions over `org.gtk.Actions`.
    async fn ring(&self, id: &str) -> zbus::fdo::Result<()> {
        let device = self.device(id).await?;
        self.activate(&device, "ring", &[]).await
    }

    /// Sends the clipboard to the device's share plugin.
    async fn send_clipboard(&self, id: &str, text: &str) -> zbus::fdo::Result<()> {
        let device = self.device(id).await?;
        self.activate(&device, "shareText", &[ZValue::from(text)]).await
    }

    /// Sends a file to the device's share plugin; `path` is a local file path.
    async fn send_file(&self, id: &str, file: &str) -> zbus::fdo::Result<()> {
        let device = self.device(id).await?;
        self.activate(&device, "shareUri", &[ZValue::from(file)]).await
    }

    /// Mutes a ringing call on the device's telephony plugin: the only call action GSConnect
    /// exports (Accept/Decline stay on the phone itself).
    async fn mute_call(&self, id: &str) -> zbus::fdo::Result<()> {
        let device = self.device(id).await?;
        self.activate(&device, "muteCall", &[]).await
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
    let (action, argument) = match call["type"].as_str() {
        Some("find_phone") => ("ring", None),
        Some("send_clipboard") => ("shareText", Some(call["text"].as_str().unwrap_or_default())),
        _ => return "Unknown device tool.".into(),
    };
    let arguments: Vec<ZValue<'_>> = argument.map(ZValue::from).into_iter().collect();
    let result = session
        .call_method(
            Some(SERVICE),
            device.id.as_str(),
            Some("org.gtk.Actions"),
            "Activate",
            &(action, arguments.as_slice(), &std::collections::HashMap::<String, ZValue>::new()),
        )
        .await;
    match result {
        Ok(_) => format!("Done on {}.", device.name),
        Err(_) => format!("{} did not answer; it may have gone.", device.name),
    }
}
