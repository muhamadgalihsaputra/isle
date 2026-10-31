// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 zickrian

//! The Devices1 D-Bus object: what the island asks of a GSConnect device —
//! ring it, send it the clipboard, send it a file. Each call goes to the
//! device GSConnect names; a device that is gone answers plainly.

use zbus::object_server::InterfaceRef;
use zbus::{Connection, interface};

use crate::system::{Device, SystemService};

/// The GSConnect service and its devices, on the session bus.
const SERVICE: &str = "org.gnome.Shell.Extensions.GSConnect";
const DEVICE: &str = "org.gnome.Shell.Extensions.GSConnect.Device";

/// isled's `Devices1` D-Bus object.
pub struct DevicesService {
    session: Connection,
    system: InterfaceRef<SystemService>,
}

impl DevicesService {
    pub fn new(session: Connection, system: InterfaceRef<SystemService>) -> Self {
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
}
