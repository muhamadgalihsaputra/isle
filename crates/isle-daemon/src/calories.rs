// SPDX-License-Identifier: GPL-3.0-or-later

use isle_core::calories::FoodLog;
use zbus::object_server::SignalEmitter;
use zbus::{fdo, interface};

use crate::clock::now_ms;
use crate::store::Store;

pub struct CaloriesService {
    log: FoodLog,
    store: Store<FoodLog>,
}

impl CaloriesService {
    pub fn load() -> Self {
        let mut store = Store::new("calories");
        let log = store.load();
        Self { log, store }
    }

    async fn changed(&self, emitter: &SignalEmitter<'_>) -> zbus::Result<()> {
        self.store.save(&self.log);
        self.entries_changed(emitter).await
    }
}

fn invalid() -> fdo::Error {
    fdo::Error::InvalidArgs(
        "food needs a name up to 200 characters and 0 to 100000 calories".into(),
    )
}

#[interface(name = "io.github.zickrian.isle.Calories1")]
impl CaloriesService {
    async fn add(
        &mut self,
        food: &str,
        calories: u32,
        #[zbus(signal_emitter)] emitter: SignalEmitter<'_>,
    ) -> fdo::Result<u64> {
        let id = self.log.add(food, calories, now_ms()).ok_or_else(invalid)?;
        self.changed(&emitter).await?;
        Ok(id)
    }

    async fn update(
        &mut self,
        id: u64,
        food: &str,
        calories: u32,
        #[zbus(signal_emitter)] emitter: SignalEmitter<'_>,
    ) -> fdo::Result<()> {
        if !self.log.update(id, food, calories) {
            return Err(invalid());
        }
        self.changed(&emitter).await?;
        Ok(())
    }

    async fn remove(
        &mut self,
        id: u64,
        #[zbus(signal_emitter)] emitter: SignalEmitter<'_>,
    ) -> fdo::Result<()> {
        if !self.log.remove(id) {
            return Err(fdo::Error::InvalidArgs(format!(
                "no food entry with id {id}"
            )));
        }
        self.changed(&emitter).await?;
        Ok(())
    }

    #[zbus(property)]
    fn entries(&self) -> String {
        serde_json::to_string(self.log.entries()).unwrap_or_default()
    }
}
