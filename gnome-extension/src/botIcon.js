// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 zickrian

// A small copy of the assistant (see bot.js) for alerts and the closed island, with a status badge on its
// corner. It holds still between blinks, glances, pointer tracking and brief gestures.

import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {Bot} from './bot.js';
import {onUiScale, px} from './compat.js';

/** How long (ms) a gesture plays; the icon is still again after it. */
const GESTURE_MS = 750;
/** It settles into its pose over this much (s) of its own time, drawn once. */
const SETTLE_S = 0.7;
/** While at work it blinks and glances this often (ms): alive, at a few frames every few seconds. */
const ALIVE_MS = 2600;

/** The bot drawn small, with an optional status badge. */
export const BotIcon = GObject.registerClass(
class BotIcon extends St.DrawingArea {
    /** `size` in CSS pixels. */
    _init(size, look = {}) {
        super._init();
        this._size = size;
        onUiScale(this, scale => this.set_size(size * scale, size * scale));
        this._bot = new Bot(look);
        this._bot.holdEyes();
        this._badge = null;
        this._settle();
        this._timeline = null;
        this.connect('repaint', area => this._paint(area));
        this._alive = 0;
        this._glance = {x: 0.12, y: 0.06};
        this._pointerOn = false;
        this.connect('destroy', () => {
            this._timeline?.stop();
            this.alive = false;
        });
    }

    /** {shape, palette} from Settings (see bot.js). */
    set look({shape, palette}) {
        this._bot.palette = palette;
        this._bot.setShape(shape);
        this._settle();
        this.queue_repaint();
    }

    /** attentive by default; also success, error, asking… (see Bot.setForm). */
    set form(form) {
        this._bot.setForm(form);
        this._settle();
        this.queue_repaint();
    }

    /** The corner badge: {color: [r, g, b], glyph: '!' | 'check' | 'cross'}, or null. */
    set badge(badge) {
        this._badge = badge;
        this.queue_repaint();
    }

    /** While true, it blinks and looks about every few seconds, holding still in between. */
    set alive(alive) {
        if (Boolean(this._alive) === alive)
            return;
        if (this._alive)
            GLib.source_remove(this._alive);
        this._alive = alive && St.Settings.get().enable_animations
            ? GLib.timeout_add(GLib.PRIORITY_DEFAULT, ALIVE_MS, () => {
                if (this.mapped) {
                    if (!this._pointerOn)
                        this._glance = {x: Math.random() * 1.2 - 0.6, y: Math.random() * 0.6 - 0.2};
                    this.play(null, 420);
                }
                return GLib.SOURCE_CONTINUE;
            })
            : 0;
    }

    /** Plays a hop, nod or shake once (or just a blink and a glance), then holds still again. */
    play(gesture, duration = GESTURE_MS) {
        if (!St.Settings.get().enable_animations)
            return;
        this._timeline?.stop();
        const from = this._bot.time;
        if (gesture)
            this._bot.gesture(gesture);
        else
            this._bot.blink();
        this._timeline = new Clutter.Timeline({actor: this, duration});
        this._timeline.connect('new-frame', (timeline, ms) => {
            this._bot.step(from + ms / 1000, this._look());
            this.queue_repaint();
        });
        this._timeline.connect('completed', () => {
            this._timeline = null;
        });
        this._timeline.start();
    }

    /** Where its eyes turn: a random glance, picked while it is alive. */
    _look() {
        return this._glance;
    }

    lookAtPointer(x, y) {
        this._pointerOn = true;
        const [left, top] = this.get_transformed_position();
        const size = px(this._size);
        const glance = {
            x: Math.max(-0.85, Math.min(0.85, (x - left - size / 2) / (size / 2))),
            y: Math.max(-0.85, Math.min(0.85, (y - top - size / 2) / (size / 2))),
        };
        const changed = Math.abs(glance.x - this._glance.x) > 0.01 || Math.abs(glance.y - this._glance.y) > 0.01;
        this._glance = glance;
        if (changed && !this._timeline)
            this._moveEyes();
    }

    lookAway() {
        this._pointerOn = false;
        const changed = Math.abs(this._glance.x) > 0.01 || Math.abs(this._glance.y) > 0.01;
        this._glance = {x: 0, y: 0};
        if (changed && !this._timeline)
            this._moveEyes();
    }

    _moveEyes() {
        this._timeline?.stop();
        const from = this._bot.time;
        if (!St.Settings.get().enable_animations) {
            this._bot.step(from + 0.18, this._look());
            this.queue_repaint();
            return;
        }
        this._timeline = new Clutter.Timeline({actor: this, duration: 180});
        this._timeline.connect('new-frame', (_timeline, ms) => {
            this._bot.step(from + ms / 1000, this._look());
            this.queue_repaint();
        });
        this._timeline.connect('completed', () => (this._timeline = null));
        this._timeline.start();
    }

    // Runs its own clock on, without drawing, until the new shape and expression have taken over.
    _settle() {
        const from = this._bot.time;
        for (let t = 1 / 30; t <= SETTLE_S; t += 1 / 30)
            this._bot.step(from + t, this._look());
    }

    /** Draws the bot, then the badge on top. */
    _paint(area) {
        const cr = area.get_context();
        this._bot.paint(cr, px(this._size));
        if (this._badge)
            this._paintBadge(cr, px(1));
        cr.$dispose();
    }

    // A small disc on the top left corner in the badge's colour, ringed in black so it stands off the body.
    _paintBadge(cr, scale) {
        const r = Math.max(4, this._size * 0.17) * scale;
        const x = r + 0.5 * scale, y = r + 0.5 * scale;
        cr.arc(x, y, r + 1.5 * scale, 0, 2 * Math.PI);
        cr.setSourceRGBA(0, 0, 0, 1);
        cr.fill();
        cr.arc(x, y, r, 0, 2 * Math.PI);
        cr.setSourceRGBA(...this._badge.color, 1);
        cr.fill();
        cr.setSourceRGBA(1, 1, 1, 1);
        cr.setLineWidth(Math.max(1.4 * scale, r * 0.32));
        cr.setLineCap(Cairo.LineCap.ROUND);
        const s = r * 0.42;
        switch (this._badge.glyph) {
        case '!':
            cr.moveTo(x, y - s * 1.1);
            cr.lineTo(x, y + s * 0.25);
            cr.stroke();
            cr.arc(x, y + s * 1.05, cr.getLineWidth() * 0.55, 0, 2 * Math.PI);
            cr.fill();
            break;
        case 'check':
            cr.moveTo(x - s, y + s * 0.05);
            cr.lineTo(x - s * 0.25, y + s * 0.8);
            cr.lineTo(x + s * 1.05, y - s * 0.7);
            cr.stroke();
            break;
        case 'cross':
            cr.moveTo(x - s * 0.8, y - s * 0.8);
            cr.lineTo(x + s * 0.8, y + s * 0.8);
            cr.moveTo(x + s * 0.8, y - s * 0.8);
            cr.lineTo(x - s * 0.8, y + s * 0.8);
            cr.stroke();
            break;
        }
    }
});
