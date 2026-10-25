// SPDX-License-Identifier: GPL-3.0-or-later

//! Prayer times from AlAdhan. The selected city and country are kept locally.

use std::time::Duration;

use chrono::Local;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use zbus::object_server::SignalEmitter;
use zbus::{fdo, interface};

use crate::http;
use crate::store::Store;

const METHOD: u8 = 20; // KEMENAG Indonesia

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
struct Location {
    city: String,
    country: String,
}

#[derive(Debug, Clone, Serialize)]
struct Schedule {
    status: String,
    city: String,
    country: String,
    date: String,
    timezone: String,
    prayers: Vec<Prayer>,
}

#[derive(Debug, Clone, Serialize)]
struct Prayer {
    name: String,
    time: String,
}

pub struct PrayerService {
    location: Location,
    store: Store<Location>,
    schedule: String,
}

impl PrayerService {
    pub fn load() -> Self {
        let mut store = Store::new("prayer-location");
        let location = store.load();
        Self {
            location,
            store,
            schedule: "{}".into(),
        }
    }

    async fn refresh(
        &mut self,
        date: Option<String>,
        emitter: &SignalEmitter<'_>,
    ) -> fdo::Result<()> {
        if self.location.city.trim().is_empty() || self.location.country.trim().is_empty() {
            self.schedule = serde_json::json!({"status":"needs_location"}).to_string();
            self.schedule_changed(emitter).await?;
            return Ok(());
        }
        let location = self.location.clone();
        let date = date.unwrap_or_else(|| Local::now().format("%Y-%m-%d").to_string());
        chrono::NaiveDate::parse_from_str(&date, "%Y-%m-%d")
            .map_err(|_| fdo::Error::InvalidArgs("date must use YYYY-MM-DD".into()))?;
        let fetched = tokio::task::spawn_blocking(move || fetch(&location, &date))
            .await
            .map_err(|err| fdo::Error::Failed(err.to_string()))?;
        self.schedule = match fetched {
            Ok(schedule) => serde_json::to_string(&schedule).unwrap_or_else(|_| "{}".into()),
            Err(err) => serde_json::json!({"status":"error", "message":err}).to_string(),
        };
        self.schedule_changed(emitter).await?;
        Ok(())
    }
}

#[interface(name = "io.github.zickrian.isle.Prayer1")]
impl PrayerService {
    async fn set_location(
        &mut self,
        city: &str,
        country: &str,
        #[zbus(signal_emitter)] emitter: SignalEmitter<'_>,
    ) -> fdo::Result<()> {
        let city = city.trim();
        let country = country.trim();
        if city.len() > 100 || country.len() > 100 {
            return Err(fdo::Error::InvalidArgs("location is too long".into()));
        }
        self.location = Location {
            city: city.to_owned(),
            country: country.to_owned(),
        };
        self.store.save(&self.location);
        self.refresh(None, &emitter).await
    }

    async fn refresh_now(
        &mut self,
        #[zbus(signal_emitter)] emitter: SignalEmitter<'_>,
    ) -> fdo::Result<()> {
        self.refresh(None, &emitter).await
    }

    async fn refresh_for_date(
        &mut self,
        date: &str,
        #[zbus(signal_emitter)] emitter: SignalEmitter<'_>,
    ) -> fdo::Result<()> {
        self.refresh(Some(date.to_owned()), &emitter).await
    }

    #[zbus(property)]
    fn schedule(&self) -> String {
        self.schedule.clone()
    }
}

fn fetch(location: &Location, date: &str) -> Result<Schedule, String> {
    let date =
        chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").map_err(|err| err.to_string())?;
    let url = format!(
        "https://api.aladhan.com/v1/timingsByCity/{}?city={}&country={}&method={METHOD}",
        date.format("%d-%m-%Y"),
        encode(&location.city),
        encode(&location.country),
    );
    let response: Value = http::get(&url, Duration::from_secs(12))
        .call()
        .map_err(|err| err.to_string())?
        .into_body()
        .read_json()
        .map_err(|err| err.to_string())?;
    let data = &response["data"];
    let timings = &data["timings"];
    let prayer = |key: &str, name: &str| -> Result<Prayer, String> {
        let raw = timings[key]
            .as_str()
            .ok_or_else(|| format!("missing {key} time"))?;
        let time = raw.split_whitespace().next().unwrap_or(raw).to_owned();
        Ok(Prayer {
            name: name.to_owned(),
            time,
        })
    };
    let prayers = [
        prayer("Fajr", "Fajr")?,
        prayer("Dhuhr", "Dhuhr")?,
        prayer("Asr", "Asr")?,
        prayer("Maghrib", "Maghrib")?,
        prayer("Isha", "Isha")?,
    ]
    .into();
    Ok(Schedule {
        status: "ready".into(),
        city: location.city.clone(),
        country: location.country.clone(),
        date: date.format("%Y-%m-%d").to_string(),
        timezone: data["meta"]["timezone"].as_str().unwrap_or("").to_owned(),
        prayers,
    })
}

fn encode(text: &str) -> String {
    let mut encoded = String::new();
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.') {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}
