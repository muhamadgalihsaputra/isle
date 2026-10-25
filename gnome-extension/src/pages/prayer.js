// SPDX-License-Identifier: GPL-3.0-or-later

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {VERTICAL} from '../compat.js';
import {label} from '../widgets.js';
import {Page} from './page.js';

export const PrayerPage = GObject.registerClass(
class PrayerPage extends Page {
    _init(daemon, {height}) {
        super._init(daemon, {style_class: 'isle-page isle-prayer', layout_manager: new Clutter.BinLayout(), height});
        this.name = 'prayer';
        this._column = new St.BoxLayout({...VERTICAL, x_expand: true, y_expand: true});
        this.add_child(this._column);
        this.watch(['prayer'], () => this._update());
        this._update();
    }

    _update() {
        this._column.destroy_all_children();
        const schedule = this.daemon.state.prayer;
        if (schedule?.status !== 'ready') {
            this._column.add_child(label('Prayer times', 'isle-reminders-title'));
            const text = schedule?.status === 'error'
                ? 'Could not load prayer times. Check the city and your connection.'
                : 'Set a city in Settings → Daily Life';
            this._column.add_child(label(text, 'isle-reminders-empty', {
                x_align: Clutter.ActorAlign.CENTER, y_expand: true,
            }));
            return;
        }
        const header = new St.BoxLayout({style_class: 'isle-reminders-header'});
        header.add_child(label(`${schedule.city}, ${schedule.country}`, 'isle-reminders-title', {x_expand: true}));
        header.add_child(label(schedule.date, 'isle-reminders-count'));
        this._column.add_child(header);
        const row = new St.BoxLayout({x_expand: true, y_expand: true, style_class: 'isle-prayer-times'});
        for (const prayer of schedule.prayers ?? []) {
            const item = new St.BoxLayout({...VERTICAL, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
            item.add_child(label(prayer.name, 'isle-reminders-empty', {x_align: Clutter.ActorAlign.CENTER}));
            item.add_child(label(prayer.time, 'isle-reminders-title', {x_align: Clutter.ActorAlign.CENTER}));
            row.add_child(item);
        }
        this._column.add_child(row);
        this._column.add_child(label(`Kemenag · ${schedule.timezone}`, 'isle-reminders-empty', {
            x_align: Clutter.ActorAlign.CENTER,
        }));
    }
});
