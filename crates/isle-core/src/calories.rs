// SPDX-License-Identifier: GPL-3.0-or-later

//! A small local food log. No account or nutrition service is needed.

use serde::{Deserialize, Serialize};

pub const CAPACITY: usize = 2_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FoodEntry {
    pub id: u64,
    pub food: String,
    pub calories: u32,
    /// Unix milliseconds in the user's local time zone.
    pub at_ms: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FoodLog {
    entries: Vec<FoodEntry>,
    next_id: u64,
}

impl FoodLog {
    pub fn entries(&self) -> &[FoodEntry] {
        &self.entries
    }

    pub fn add(&mut self, food: &str, calories: u32, at_ms: i64) -> Option<u64> {
        let food = food.trim();
        if food.is_empty()
            || food.chars().count() > 200
            || calories > 100_000
            || self.entries.len() >= CAPACITY
        {
            return None;
        }
        self.next_id += 1;
        let id = self.next_id;
        self.entries.push(FoodEntry {
            id,
            food: food.to_owned(),
            calories,
            at_ms,
        });
        self.entries.sort_by_key(|entry| entry.at_ms);
        Some(id)
    }

    pub fn update(&mut self, id: u64, food: &str, calories: u32) -> bool {
        let food = food.trim();
        if food.is_empty() || food.chars().count() > 200 || calories > 100_000 {
            return false;
        }
        let Some(entry) = self.entries.iter_mut().find(|entry| entry.id == id) else {
            return false;
        };
        entry.food = food.to_owned();
        entry.calories = calories;
        true
    }

    pub fn remove(&mut self, id: u64) -> bool {
        let before = self.entries.len();
        self.entries.retain(|entry| entry.id != id);
        self.entries.len() != before
    }
}
