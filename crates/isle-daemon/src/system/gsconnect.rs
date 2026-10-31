// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 zickrian

//! GSConnect's paired devices on the session bus: their battery, read when
//! GSConnect says a device changed, never on a timer. With GSConnect missing
//! or no device paired, the state stays empty and nothing is published.

use futures_util::StreamExt;
use zbus::fdo::PropertiesProxy;
use zbus::names::InterfaceName;
use zbus::object_server::InterfaceRef;
use zbus::zvariant::ObjectPath;
use zbus::{Connection, MatchRule, MessageStream, message::Type as MessageType};

use super::{Device, SystemEvent, SystemService, publish};

const SERVICE: &str = "org.gnome.Shell.Extensions.GSConnect";
const DEVICE: &str = "org.gnome.Shell.Extensions.GSConnect.Device";

/// A battery at or under this is low; at 100 it is full. Each crossing is one alert, not one per report.
const LOW: i16 = 15;

/// Follows GSConnect: each connected device and its battery, published to the state as it changes.
pub async fn watch(session: Connection, iface: InterfaceRef<SystemService>) -> anyhow::Result<()> {
    // The service's own signals for devices coming, going and changing; the battery arrives as a
    // property on the device, read afresh each time, so no list of properties is kept in step.
    let rule = MatchRule::builder()
        .msg_type(MessageType::Signal)
        .sender(SERVICE)?
        .interface(SERVICE)?
        .build();
    let mut signals = MessageStream::for_match_rule(rule, &session, None).await?;
    // Devices that were already paired when Isle started, before their first change is an event.
    let mut before: Vec<Device> = read_devices(&session).await;
    publish(&iface, |state| state.devices = before.clone(), None).await;

    loop {
        let Some(message) = signals.next().await else {
            return Ok(());
        };
        let Ok(_) = message else { continue };
        // Any device signal re-reads the list: which device changed matters less
        // than the list being right, and one read costs no more than a diff.
        let after = read_devices(&session).await;
        let events = changes(&before, &after);
        before.clone_from(&after);
        publish(&iface, |state| state.devices = after, events.first().cloned()).await;
        for event in events.into_iter().skip(1) {
            publish(&iface, |_| (), Some(event)).await;
        }
    }
}

/// What changed between two reads of the device list, as events worth an alert: a device coming
/// or going, and a battery crossing a line (low under [`LOW`], full at 100). Each crossing alerts
/// once, by remembering the side it came from.
fn changes(before: &[Device], after: &[Device]) -> Vec<SystemEvent> {
    let mut events = Vec::new();
    for device in after {
        let was = before.iter().find(|d| d.id == device.id);
        // Newly connected: one event, whatever its battery says.
        let Some(was) = was else {
            events.push(SystemEvent::Device { connected: true, name: device.name.clone() });
            continue;
        };
        let Some(level) = device.battery else { continue };
        let was_level = was.battery;
        // Only a crossing alerts: into low from above it, to full from below it.
        let into_low = level <= LOW as u8 && was_level.is_some_and(|was| was > LOW as u8);
        let to_full = level == 100 && was_level.is_some_and(|was| was < 100);
        if into_low || to_full {
            events.push(SystemEvent::DeviceBattery {
                low: into_low,
                name: device.name.clone(),
                percent: level,
            });
        }
    }
    for device in before {
        if !after.iter().any(|d| d.id == device.id) {
            events.push(SystemEvent::Device { connected: false, name: device.name.clone() });
        }
    }
    events
}

/// Every paired device, with its battery and whether it is connected.
async fn read_devices(session: &Connection) -> Vec<Device> {
    // GSConnect's GetDevices returns the object paths of its paired devices.
    let paths = session
        .call_method(Some(SERVICE), "/", Some(SERVICE), "GetDevices", &())
        .await
        .ok()
        .and_then(|reply| reply.body().deserialize::<Vec<String>>().ok())
        .unwrap_or_default();
    let mut devices = Vec::new();
    for path in paths {
        // One device that cannot be read must not cost us the others.
        if let Some(device) = read_device(session, &path).await {
            devices.push(device);
        }
    }
    devices
}

/// One device's name, type and battery; only while GSConnect reports it connected.
async fn read_device(session: &Connection, path: &str) -> Option<Device> {
    let Ok(path) = ObjectPath::try_from(path) else {
        return None;
    };
    let properties = PropertiesProxy::builder(session)
        .destination(SERVICE)
        .ok()?
        .path(path.clone())
        .ok()?
        .build()
        .await
        .ok()?;
    let all = properties
        .get_all(InterfaceName::from_static_str_unchecked(DEVICE))
        .await
        .ok()?;
    let read = |key: &str| all.get(key).cloned();
    let text = |key: &str| {
        read(key)
            .and_then(|value| String::try_from(value).ok())
    };
    let flag = |key: &str| {
        read(key)
            .and_then(|value| bool::try_from(value).ok())
            .unwrap_or(false)
    };
    // Only a connected device shows; a paired-but-disconnected phone is silence, not noise.
    if !flag("Connected") {
        return None;
    }
    // GSConnect's battery: a whole number 0..100, or -1 when the device reports none.
    let battery = read("Battery")
        .and_then(|value| i16::try_from(value).ok())
        .filter(|level| *level >= 0)
        .map(|level| level.min(100) as u8);
    Some(Device {
        id: path.to_string(),
        name: text("Name").unwrap_or_else(|| "Device".into()),
        kind: text("Type").unwrap_or_else(|| "smartphone".into()),
        battery,
        charging: flag("Charging"),
    })
}
