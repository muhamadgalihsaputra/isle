// SPDX-License-Identifier: GPL-3.0-or-later

use isle_core::water::{MAX_DRINK_ML, MIN_DRINK_ML, WaterLog};
use zbus::object_server::SignalEmitter;
use zbus::{fdo, interface};

use crate::clock::now_ms;
use crate::store::Store;

pub struct WaterService {
    log: WaterLog,
    store: Store<WaterLog>,
}

impl WaterService {
    pub fn load() -> Self {
        let mut store = Store::new("water");
        let log = store.load();
        Self { log, store }
    }

    async fn changed(&self, emitter: &SignalEmitter<'_>) -> zbus::Result<()> {
        self.store.save(&self.log);
        self.entries_changed(emitter).await
    }
}

fn invalid() -> fdo::Error {
    fdo::Error::InvalidArgs(format!(
        "a drink must be between {MIN_DRINK_ML} and {MAX_DRINK_ML} ml"
    ))
}

#[interface(name = "io.github.zickrian.isle.Water1")]
impl WaterService {
    async fn drink(
        &mut self,
        amount_ml: u32,
        #[zbus(signal_emitter)] emitter: SignalEmitter<'_>,
    ) -> fdo::Result<u64> {
        let id = self.log.drink(amount_ml, now_ms()).ok_or_else(invalid)?;
        self.changed(&emitter).await?;
        Ok(id)
    }

    async fn remove(
        &mut self,
        id: u64,
        #[zbus(signal_emitter)] emitter: SignalEmitter<'_>,
    ) -> fdo::Result<()> {
        if !self.log.remove(id) {
            return Err(fdo::Error::InvalidArgs(format!(
                "no water entry with id {id}"
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
