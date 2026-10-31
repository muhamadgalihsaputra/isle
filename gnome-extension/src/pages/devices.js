// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 zickrian

// Devices: the GSConnect devices paired with this computer — their battery,
// a ring to find them, and the clipboard sent over. No device connected, no
// tab; see docs/gsconnect-plan.md.

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {VERTICAL} from '../compat.js';
import * as Palette from '../palette.js';
import {Ring, icon, iconButton, label} from '../widgets.js';
import {Page} from './page.js';

/** The battery ring's size (CSS px). */
const RING_SIZE = 30;

// The Devices page: one row per connected device.
export const DevicesPage = GObject.registerClass(
class DevicesPage extends Page {
    /** `height` is the expanded island's page height. */
    _init(daemon, {height}) {
        super._init(daemon, {
            style_class: 'isle-page isle-devices',
            layout_manager: new Clutter.BinLayout(),
            height,
            reactive: true,
        });
        this.name = 'devices';

        this._box = new St.BoxLayout({...VERTICAL, style_class: 'isle-devices-list',
            x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this.add_child(this._box);

        this.watch(['system'], () => this._sync());
        this._sync();
    }

    /** A tab only while a device is connected; GSConnect gone, none. */
    get available() {
        return !this.hidden && this._devices().length > 0;
    }

    /** The first device's battery washes the island: red when low, otherwise blue. */
    get tint() {
        const device = this._devices().find(device => device.battery !== null && device.battery !== undefined);
        if (!device)
            return null;
        return device.battery <= 20 ? Palette.RED : Palette.BLUE;
    }

    /** Whether anything shows. */
    get relevant() {
        return this.available;
    }

    /** Rebuilt on the next showing, so the tab comes and goes with the devices. */
    markCold() {
        super.markCold();
        this.emit('availability-changed');
    }

    _devices() {
        return this.daemon.state.system?.devices ?? [];
    }

    /** Rebuilds the rows if what is on changed, else just their figures. */
    _sync() {
        const devices = this._devices();
        const key = devices.map(device => device.id).join(',');
        if (key !== this._key) {
            this._key = key;
            this._box.destroy_all_children();
            for (const device of devices)
                this._box.add_child(this._row(device));
            this.emit('availability-changed');
        }
        for (const row of this._box.get_children()) {
            const device = devices.find(device => device.id === row.deviceId);
            if (!device)
                continue;
            row.battery.progress = (device.battery ?? 0) / 100;
            const known = device.battery !== null && device.battery !== undefined;
            row.figure.text = known ? `${device.battery}%` : '';
            row.battery.visible = known;
        }
    }

    /** One device: its type's icon and name, its battery's ring and figure, and its actions. */
    _row(device) {
        const row = new St.BoxLayout({style_class: 'isle-devices-row'});
        row.deviceId = device.id;
        const glyph = new St.Icon({gicon: icon('isle-phone-symbolic'), icon_size: 16,
            y_align: Clutter.ActorAlign.CENTER});
        const name = label(device.name, 'isle-devices-name', {x_expand: true});
        row.add_child(glyph);
        row.add_child(name);

        const figure = label('', 'isle-devices-figure');
        const battery = new Ring({size: RING_SIZE, lineWidth: 3, child: figure});
        battery.y_align = Clutter.ActorAlign.CENTER;
        row.battery = battery;
        row.figure = figure;
        row.add_child(battery);

        // Ring it (Find My Phone), and send the clipboard over; failures are the daemon's plain answers.
        const actions = new St.BoxLayout({style_class: 'isle-devices-actions'});
        actions.add_child(iconButton('isle-phone', 'isle-button-round',
            () => this.daemon.call('devices', 'Ring', device.id), {size: 16, accessibleName: `Ring ${device.name}`}));
        actions.add_child(iconButton('isle-clipboard', 'isle-button-round',
            () => this.daemon.call('devices', 'SendClipboard', device.id), {size: 16, accessibleName: `Send the clipboard to ${device.name}`}));
        row.add_child(actions);
        return row;
    }

    onActivate() {
        this._sync();
    }
});
