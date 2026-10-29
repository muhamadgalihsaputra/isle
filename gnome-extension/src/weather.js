// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 zickrian

// Current conditions for the compact island. GWeather fetches asynchronously; this watcher
// only updates while the closed island is mapped, then stops its timer and request when hidden.

import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import GWeather from 'gi://GWeather?version=4.0';

import * as WorldClocks from './worldClocks.js';

const REFRESH_MS = 30 * 60 * 1000;
const APP_ID = 'io.github.zickrian.isle';
const CONTACT = 'https://github.com/zickrian/isle/issues';

/** Signals `changed` when the current conditions or selected location change. */
export const WeatherWatcher = GObject.registerClass({
    Signals: {'changed': {}},
}, class WeatherWatcher extends GObject.Object {
    _init(settings) {
        super._init();
        this._settings = settings;
        this._clocks = WorldClocks.shellSettings();
        this._active = false;
        this._info = null;
        this._updated = 0;
        this._refreshTimer = 0;
        this.state = {temperature: '', iconName: '', summary: '', locationName: ''};
        this._settingsIds = [
            settings.connect('changed::weather-enabled', () => this._configure()),
            settings.connect('changed::weather-location', () => this._configure()),
        ];
        this._clocksId = this._clocks?.connect('changed::locations', () => {
            if (!WorldClocks.hasWeatherLocation(settings))
                this._configure();
        }) ?? 0;
        this._configure();
    }

    get active() {
        return this._active;
    }

    set active(active) {
        active = Boolean(active);
        if (active === this._active)
            return;
        this._active = active;
        if (active)
            this._requestUpdate();
        else {
            this._cancelRefresh();
            this._info?.abort();
        }
    }

    /** Drops old city data and creates an async GWeather request for the current setting. */
    _configure() {
        this._cancelRefresh();
        if (this._info) {
            this._info.abort();
            if (this._updated)
                this._info.disconnect(this._updated);
        }
        this._info = null;
        this._updated = 0;
        this.state = {temperature: '', iconName: '', summary: '', locationName: ''};

        const location = this._settings.get_boolean('weather-enabled')
            ? WorldClocks.weatherLocation(this._settings, this._clocks) : null;
        if (!location) {
            this.emit('changed');
            return;
        }

        this.state.locationName = [location.get_city_name() || location.get_name(), location.get_country_name()]
            .filter(Boolean).join(', ');
        const info = GWeather.Info.new(location);
        info.set_application_id(APP_ID);
        info.set_contact_info(CONTACT);
        info.set_enabled_providers(GWeather.Provider.METAR);
        this._info = info;
        this._updated = info.connect('updated', () => this._onUpdated(info));
        this.emit('changed');
        if (this._active)
            this._requestUpdate();
    }

    /** Starts one request and leaves one low-frequency refresh scheduled while visible. */
    _requestUpdate() {
        if (!this._active || !this._info)
            return;
        this._info.update();
        this._cancelRefresh();
        this._refreshTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, REFRESH_MS, () => {
            this._refreshTimer = 0;
            this._requestUpdate();
            return GLib.SOURCE_REMOVE;
        });
    }

    _cancelRefresh() {
        if (this._refreshTimer) {
            GLib.source_remove(this._refreshTimer);
            this._refreshTimer = 0;
        }
    }

    /** Keeps the last successful reading if a later network request fails. */
    _onUpdated(info) {
        if (info !== this._info || !info.is_valid())
            return;
        const temperature = info.get_temp();
        if (!temperature)
            return;
        this.state = {
            temperature,
            iconName: info.get_symbolic_icon_name() || 'weather-clear-symbolic',
            summary: info.get_weather_summary() || '',
            locationName: this.state.locationName,
        };
        this.emit('changed');
    }

    destroy() {
        this._active = false;
        this._cancelRefresh();
        if (this._info) {
            this._info.abort();
            if (this._updated)
                this._info.disconnect(this._updated);
        }
        for (const id of this._settingsIds)
            this._settings.disconnect(id);
        if (this._clocksId)
            this._clocks.disconnect(this._clocksId);
    }
});
