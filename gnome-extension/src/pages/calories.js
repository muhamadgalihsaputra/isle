// SPDX-License-Identifier: GPL-3.0-or-later

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {VERTICAL} from '../compat.js';
import {iconButton, label} from '../widgets.js';
import {Page} from './page.js';

export const CaloriesPage = GObject.registerClass(
class CaloriesPage extends Page {
    _init(daemon, {height}) {
        super._init(daemon, {
            style_class: 'isle-page isle-calories',
            layout_manager: new Clutter.BinLayout(),
            height,
        });
        this.name = 'calories';
        const column = new St.BoxLayout({...VERTICAL, x_expand: true, y_expand: true});
        const header = new St.BoxLayout({style_class: 'isle-calorie-header'});
        header.add_child(label('Calories Today', 'isle-calorie-title', {x_expand: true}));
        this._total = label('0 kcal', 'isle-calorie-total');
        header.add_child(this._total);
        column.add_child(header);

        this._list = new St.BoxLayout({...VERTICAL, style_class: 'isle-calorie-list', x_expand: true});
        const scroll = new St.ScrollView({
            style_class: 'isle-calorie-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.EXTERNAL,
            x_expand: true,
            y_expand: true,
        });
        scroll.set_child(this._list);
        column.add_child(scroll);

        const form = new St.BoxLayout({style_class: 'isle-calorie-form'});
        this._food = new St.Entry({style_class: 'isle-calorie-field isle-calorie-field-food', hint_text: 'Food item', x_expand: true});
        this._kcal = new St.Entry({style_class: 'isle-calorie-field isle-calorie-field-kcal', hint_text: 'kcal', width: 68});
        this._kcal.clutter_text.set_input_purpose(Clutter.InputContentPurpose.DIGITS);
        const add = iconButton('isle-plus-symbolic', 'isle-calorie-add', () => this._add(), {
            size: 11, accessibleName: 'Add food entry',
        });
        form.add_child(this._food);
        form.add_child(this._kcal);
        form.add_child(add);
        column.add_child(form);
        this.add_child(column);

        this._food.clutter_text.connect('activate', () => this._add());
        this._kcal.clutter_text.connect('activate', () => this._add());
        this.watch(['calorieEntries'], () => this._update());
        this._update();
    }

    _todayEntries() {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const next = new Date(start);
        next.setDate(next.getDate() + 1);
        return (this.daemon.state.calorieEntries ?? []).filter(entry =>
            entry.at_ms >= start.getTime() && entry.at_ms < next.getTime());
    }

    _update() {
        this._list.destroy_all_children();
        const entries = this._todayEntries();
        this._total.text = `${entries.reduce((total, item) => total + item.calories, 0)} kcal`;
        if (!entries.length) {
            this._list.add_child(label('No meals logged yet today', 'isle-calorie-empty', {
                x_align: Clutter.ActorAlign.CENTER,
            }));
            return;
        }
        for (const entry of [...entries].reverse()) {
            const row = new St.BoxLayout({style_class: 'isle-calorie-row', x_expand: true});
            const item = label(entry.food, 'isle-calorie-food', {x_expand: true});
            item.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            row.add_child(item);
            row.add_child(label(`${entry.calories} kcal`, 'isle-calorie-kcal'));
            row.add_child(iconButton('isle-close-symbolic', 'isle-calorie-remove', () =>
                this.daemon.call('calories', 'Remove', entry.id), {
                size: 11, accessibleName: `Remove ${entry.food}`,
            }));
            this._list.add_child(row);
        }
    }

    async _add() {
        const food = this._food.text.trim();
        const calories = Number.parseInt(this._kcal.text, 10);
        if (!food || !Number.isInteger(calories) || calories < 0 || calories > 100_000)
            return;
        this._food.text = '';
        this._kcal.text = '';
        await this.daemon.call('calories', 'Add', food, calories);
    }
});
