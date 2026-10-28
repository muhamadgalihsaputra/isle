// SPDX-License-Identifier: GPL-3.0-or-later

//! A local water log, timestamped for the hourly chart in the island.

use serde::{Deserialize, Serialize};

pub const CAPACITY: usize = 10_000;
pub const MIN_DRINK_ML: u32 = 50;
pub const MAX_DRINK_ML: u32 = 3_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WaterEntry {
    pub id: u64,
    pub amount_ml: u32,
    /// Unix milliseconds in the user's local time zone.
    pub at_ms: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WaterLog {
    entries: Vec<WaterEntry>,
    next_id: u64,
}

impl WaterLog {
    pub fn entries(&self) -> &[WaterEntry] {
        &self.entries
    }

    pub fn drink(&mut self, amount_ml: u32, at_ms: i64) -> Option<u64> {
        if !(MIN_DRINK_ML..=MAX_DRINK_ML).contains(&amount_ml) || self.entries.len() >= CAPACITY {
            return None;
        }
        self.next_id += 1;
        let id = self.next_id;
        self.entries.push(WaterEntry { id, amount_ml, at_ms });
        self.entries.sort_by_key(|entry| entry.at_ms);
        Some(id)
    }

    pub fn remove(&mut self, id: u64) -> bool {
        let before = self.entries.len();
        self.entries.retain(|entry| entry.id != id);
        self.entries.len() != before
    }
}
