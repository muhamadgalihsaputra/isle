// Copyright (C) 2026 zickrian

//! GSConnect's paired devices on the session bus: their battery, read when
//! GSConnect says a device changed, never on a timer. With GSConnect missing
//! or no device paired, the state stays empty and nothing is published.
//!
//! GSConnect's D-Bus surface (src/service/manager.js): one object per device
//! under an `ObjectManager`, its `Device` interface holding `Connected`,
//! `Name` and `Type`. The battery is not a property there; it is the state of
//! the device's `battery` action, exported over `org.gtk.Actions`.

use futures_util::StreamExt;
use zbus::object_server::InterfaceRef;
use zbus::zvariant::Value as ZValue;
use zbus::{Connection, MatchRule, MessageStream, message::Type as MessageType};

use super::{Device, SystemEvent, SystemService, publish};

const SERVICE: &str = "org.gnome.Shell.Extensions.GSConnect";
const DEVICE: &str = "org.gnome.Shell.Extensions.GSConnect.Device";
/// The object manager's root, where the devices hang beneath.
const MANAGER: &str = "/org/gnome/Shell/Extensions/GSConnect";

/// A battery at or under this is low; at 100 it is full. Each crossing is one alert, not one per report.
const LOW: i16 = 15;

/// Follows GSConnect: each connected device and its battery, published to the state as it changes.
pub async fn watch(session: Connection, iface: InterfaceRef<SystemService>) -> anyhow::Result<()> {
    // The object manager's own signals say a device came or went; each device's property
    // changes say one that stayed changed what it shows. Both re-read the list afresh, so
    // no list of properties is kept in step (the battery is read anew with each).
    let manager = MatchRule::builder()
        .msg_type(MessageType::Signal)
        .sender(SERVICE)?
        .interface("org.freedesktop.DBus.ObjectManager")?
        .build();
    let mut manager = MessageStream::for_match_rule(manager, &session, None).await?;
    let properties = MatchRule::builder()
        .msg_type(MessageType::Signal)
        .sender(SERVICE)?
        .interface("org.freedesktop.DBus.Properties")?
        .member("PropertiesChanged")?
        .arg(1, DEVICE)?
        .build();
    let mut properties = MessageStream::for_match_rule(properties, &session, None).await?;

    // Devices that were already paired when Isle started, before their first change is an event.
    let mut before: Vec<Device> = read_devices(&session).await;
    publish(&iface, |state| state.devices = before.clone(), None).await;

    loop {
        let changed = tokio::select! {
            message = manager.next() => {
                let Some(message) = message else { return Ok(()) };
                message.is_ok()
            }
            message = properties.next() => {
                let Some(Ok(_)) = message else { continue };
                true
            }
        };
        if !changed {
            continue;
        }
        // Any device change re-reads the list: which device changed matters less
        // than the list being right, and one read costs no more than a diff.
        let after = read_devices(&session).await;
        let events = changes(&before, &after);
        before.clone_from(&after);
        publish(
            &iface,
            |state| state.devices = after,
            events.first().cloned(),
        )
        .await;
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
            events.push(SystemEvent::Device {
                connected: true,
                name: device.name.clone(),
            });
            continue;
        };
        let Some(level) = device.battery else {
            continue;
        };
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
            events.push(SystemEvent::Device {
                connected: false,
                name: device.name.clone(),
            });
        }
    }
    events
}

/// Every connected device, as the object manager reports them: one object per
/// device, its `Device` interface holding the name and type.
async fn read_devices(session: &Connection) -> Vec<Device> {
    let reply = session
        .call_method(
            Some(SERVICE),
            MANAGER,
            Some("org.freedesktop.DBus.ObjectManager"),
            "GetManagedObjects",
            &(),
        )
        .await;
    if let Err(err) = &reply {
        // The service away is the common case (GSConnect not installed); a bus error with it
        // running is what the user needs to see when a connected phone does not show up.
        log::debug!("GSConnect devices unreadable: {err}");
    }
    let reply = reply.ok();
    let Some(reply) = reply else {
        return Vec::new();
    };
    let body = reply.body();
    let objects = body
        .deserialize::<ZValue>()
        .ok()
        .and_then(|objects| serde_json::to_value(&objects).ok());
    let Some(objects) = objects.and_then(|objects| objects.as_object().cloned()) else {
        return Vec::new();
    };
    let mut devices = Vec::new();
    for (path, interfaces) in objects {
        // One device that cannot be read must not cost us the others.
        if let Some(device) = read_device(session, &path, interfaces.get(DEVICE)).await {
            devices.push(device);
        }
    }
    devices.sort_by(|a, b| a.id.cmp(&b.id));
    devices
}

/// One device's name and type from its object-manager entry; only while GSConnect reports it
/// connected. The battery is read afresh from its action state, for the level and charge.
async fn read_device(
    session: &Connection,
    path: &str,
    device: Option<&serde_json::Value>,
) -> Option<Device> {
    let device = device?;
    // Only a connected device shows; a paired-but-disconnected phone is silence, not noise.
    if !device
        .get("Connected")
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
    {
        return None;
    }
    let (battery, charging) = read_battery(session, path).await;
    Some(Device {
        id: path.to_owned(),
        name: device
            .get("Name")
            .and_then(|value| value.as_str())
            .unwrap_or("Device")
            .to_owned(),
        kind: device
            .get("Type")
            .and_then(|value| value.as_str())
            .unwrap_or("smartphone")
            .to_owned(),
        battery,
        charging,
    })
}

/// The device's battery, as the state of its `battery` action over `org.gtk.Actions`
/// (`DescribeAll`): `{"battery": [["state", <(bsii)>]], ...}` — charging, icon name,
/// level (-1 when the device reports none), time remaining.
async fn read_battery(session: &Connection, path: &str) -> (Option<u8>, bool) {
    let state = session
        .call_method(
            Some(SERVICE),
            path,
            Some("org.gtk.Actions"),
            "DescribeAll",
            &(),
        )
        .await
        .ok()
        .and_then(|reply| {
            let body = reply.body();
            let state = body.deserialize::<ZValue>().ok()?;
            serde_json::to_value(&state).ok()
        });
    let Some(state) = state else {
        return (None, false);
    };
    let tuple = state
        .get("battery")
        .and_then(|value| value.as_array())
        .and_then(|entry| entry.first())
        .and_then(|value| value.as_array());
    let Some(tuple) = tuple else {
        return (None, false);
    };
    let mut fields = tuple.iter();
    let charging = fields
        .next()
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    let level = fields
        .nth(1)
        .and_then(|value| value.as_i64())
        .filter(|level| (0..=100).contains(level))
        .map(|level| level as u8);
    (level, charging)
}
