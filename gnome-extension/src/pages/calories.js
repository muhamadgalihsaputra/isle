// SPDX-License-Identifier: GPL-3.0-or-later

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {VERTICAL} from '../compat.js';
import {Ring, icon, iconButton, label} from '../widgets.js';
import {Page} from './page.js';

const RING_SIZE = 96;
const DEFAULT_GOAL = 2000;

export const CaloriesPage = GObject.registerClass(
class CaloriesPage extends Page {
    _init(daemon, settings, {height}) {
        super._init(daemon, {
            style_class: 'isle-page isle-calories',
            layout_manager: new Clutter.BinLayout(),
            height,
        });
        this.name = 'calories';
        this._settings = settings;

        // Master horizontal layout: Left = Visual Progress Ring, Right = Meal list & quick logger
        const mainRow = new St.BoxLayout({x_expand: true, y_expand: true, style_class: 'isle-calorie-layout'});

        // ── Left: Ring & Daily Summary ──
        const leftCol = new St.BoxLayout({
            ...VERTICAL,
            style_class: 'isle-calorie-left',
            y_align: Clutter.ActorAlign.CENTER,
        });

        const insideRing = new St.BoxLayout({...VERTICAL, y_align: Clutter.ActorAlign.CENTER});
        const flameIcon = new St.Icon({
            gicon: icon('isle-flame'),
            icon_size: 14,
            style_class: 'isle-calorie-flame-icon',
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._ringKcal = label('0', 'isle-calorie-ring-val', {x_align: Clutter.ActorAlign.CENTER});
        const ringUnit = label('kcal', 'isle-calorie-ring-unit', {x_align: Clutter.ActorAlign.CENTER});
        insideRing.add_child(flameIcon);
        insideRing.add_child(this._ringKcal);
        insideRing.add_child(ringUnit);

        this._ring = new Ring({
            size: RING_SIZE,
            lineWidth: 5,
            color: [1.0, 0.27, 0.23],
            trackOpacity: 0.2,
            child: insideRing,
        });
        this._ring.x_align = Clutter.ActorAlign.CENTER;
        leftCol.add_child(this._ring);

        this._percentLabel = label('0% of goal', 'isle-calorie-goal-sub', {
            x_align: Clutter.ActorAlign.CENTER,
        });
        leftCol.add_child(this._percentLabel);
        this._remainingLabel = label(`${DEFAULT_GOAL} kcal left`, 'isle-calorie-remaining', {
            x_align: Clutter.ActorAlign.CENTER,
        });
        leftCol.add_child(this._remainingLabel);
        mainRow.add_child(leftCol);

        // Divider
        mainRow.add_child(new St.Widget({style_class: 'isle-calorie-divider'}));

        // ── Right: List of meals & Add form ──
        const rightCol = new St.BoxLayout({...VERTICAL, x_expand: true, y_expand: true, style_class: 'isle-calorie-right'});

        // Header
        const header = new St.BoxLayout({style_class: 'isle-calorie-header'});
        header.add_child(label('Today’s Intake', 'isle-calorie-title', {x_expand: true}));
        this._mealsBadge = label('0 meals', 'isle-calorie-badge');
        header.add_child(this._mealsBadge);
        rightCol.add_child(header);

        // Meal list
        this._list = new St.BoxLayout({...VERTICAL, style_class: 'isle-calorie-list', x_expand: true});
        this._emptyLabel = label('No meals recorded today yet', 'isle-calorie-empty', {
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            y_expand: true,
        });
        const listStack = new St.Widget({layout_manager: new Clutter.BinLayout(), x_expand: true, y_expand: true});

        const scroll = new St.ScrollView({
            style_class: 'isle-calorie-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.EXTERNAL,
            x_expand: true,
            y_expand: true,
        });
        scroll.set_child(this._list);
        listStack.add_child(scroll);
        listStack.add_child(this._emptyLabel);
        rightCol.add_child(listStack);

        // Form at bottom
        const form = new St.BoxLayout({style_class: 'isle-calorie-form'});
        this._food = new St.Entry({
            style_class: 'isle-calorie-field isle-calorie-field-food',
            hint_text: 'Food item...',
            can_focus: true,
            x_expand: true,
        });
        form.add_child(this._food);
        form.add_child(new St.Widget({style_class: 'isle-calorie-field-sep'}));

        this._kcal = new St.Entry({
            style_class: 'isle-calorie-field isle-calorie-field-kcal',
            hint_text: 'kcal',
            can_focus: true,
            width: 52,
        });
        this._kcal.clutter_text.set_input_purpose(Clutter.InputContentPurpose.DIGITS);
        form.add_child(this._kcal);

        const addBtn = iconButton('isle-plus-symbolic', 'isle-calorie-add-btn', () => this._add(), {
            size: 11,
            accessibleName: 'Add meal',
        });
        form.add_child(addBtn);
        rightCol.add_child(form);

        mainRow.add_child(rightCol);
        this.add_child(mainRow);

        this._food.clutter_text.connect('activate', () => this._add());
        this._kcal.clutter_text.connect('activate', () => this._add());
        this.watch(['calorieEntries'], () => this._update());
        this._goalChanged = settings.connect('changed::calorie-goal', () => this._update());
        this.connect('destroy', () => settings.disconnect(this._goalChanged));
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
        const total = entries.reduce((sum, item) => sum + item.calories, 0);
        const goal = this._settings.get_int('calorie-goal') || DEFAULT_GOAL;
        this._ringKcal.text = `${total}`;
        this._ring.progress = Math.min(1.0, total / goal);
        const percent = Math.round((total / goal) * 100);
        this._percentLabel.text = `${percent}% of ${goal.toLocaleString()} kcal`;
        this._remainingLabel.text = total < goal
            ? `${(goal - total).toLocaleString()} kcal left`
            : total === goal ? 'Goal reached' : `${(total - goal).toLocaleString()} kcal over`;

        this._mealsBadge.text = `${entries.length} ${entries.length === 1 ? 'meal' : 'meals'}`;
        this._emptyLabel.visible = entries.length === 0;

        for (const entry of [...entries].reverse()) {
            const row = new St.BoxLayout({style_class: 'isle-calorie-row', x_expand: true});
            const item = label(entry.food, 'isle-calorie-food', {x_expand: true});
            item.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            row.add_child(item);

            row.add_child(label(`+${entry.calories} kcal`, 'isle-calorie-kcal'));
            row.add_child(iconButton('isle-close-symbolic', 'isle-calorie-remove', () =>
                this.daemon.call('calories', 'Remove', entry.id), {
                size: 10, accessibleName: `Remove ${entry.food}`,
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
