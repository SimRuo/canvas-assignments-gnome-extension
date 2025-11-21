/* extension.js
 *
 * Canvas Assignments Extension for GNOME Shell
 * Displays upcoming assignments from Canvas LMS in the top panel
 */

import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTry.js';

// Load configuration
const Config = imports.misc.extensionUtils.getCurrentExtension().imports.config;

const CANVAS_URL = Config.CANVAS_URL;
const API_TOKEN = Config.API_TOKEN;
const REFRESH_INTERVAL = 30 * 60; // 30 minutes in seconds
const DAYS_AHEAD = 14;
const SCROLL_SPEED = 50; // pixels per second
const STATIC_THRESHOLD = 400; // max width before scrolling kicks in

const CanvasIndicator = GObject.registerClass(
    class CanvasIndicator extends PanelMenu.Button {
        _init() {
            super._init(0.0, 'Canvas Assignments');

            // Create container for the scrolling text
            this._container = new St.BoxLayout({
                style_class: 'panel-button',
                reactive: true,
                can_focus: true,
                track_hover: true
            });
            this.add_child(this._container);

            // Create scrolling viewport
            this._viewport = new St.Widget({
                clip_to_allocation: true,
                layout_manager: new Clutter.BinLayout()
            });
            this._container.add_child(this._viewport);

            // Create label for assignments
            this._label = new St.Label({
                text: 'Loading Canvas assignments...',
                y_align: Clutter.ActorAlign.CENTER
            });
            this._viewport.add_child(this._label);

            // Scrolling state
            this._scrollOffset = 0;
            this._needsScroll = false;
            this._scrollTimeline = null;

            // Assignment data
            this._assignments = [];
            this._notifiedAssignments = new Set();

            // HTTP session
            this._httpSession = new Soup.Session();

            // Create popup menu
            this._createMenu();

            // Initial fetch
            this._fetchAssignments();

            // Set up refresh timer
            this._refreshTimer = GLib.timeout_add_seconds(
                GLib.PRIORITY_DEFAULT,
                REFRESH_INTERVAL,
                () => {
                    this._fetchAssignments();
                    return GLib.SOURCE_CONTINUE;
                }
            );

            // Set up notification check timer (every minute)
            this._notificationTimer = GLib.timeout_add_seconds(
                GLib.PRIORITY_DEFAULT,
                60,
                () => {
                    this._checkNotifications();
                    return GLib.SOURCE_CONTINUE;
                }
            );

            // Update layout when size changes
            this._container.connect('notify::width', () => {
                this._updateScrolling();
            });
        }

        _createMenu() {
            // Add refresh button
            let refreshItem = new PopupMenu.PopupMenuItem('Refresh Assignments');
            refreshItem.connect('activate', () => {
                this._fetchAssignments();
            });
            this.menu.addMenuItem(refreshItem);

            // Add separator
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            // Add assignments list section
            this._menuSection = new PopupMenu.PopupMenuSection();
            this.menu.addMenuItem(this._menuSection);
        }

        _updateMenu() {
            // Clear existing items
            this._menuSection.removeAll();

            if (this._assignments.length === 0) {
                let item = new PopupMenu.PopupMenuItem('No upcoming assignments', {
                    reactive: false
                });
                this._menuSection.addMenuItem(item);
                return;
            }

            // Add each assignment
            this._assignments.forEach(assignment => {
                let dateStr = this._formatDate(new Date(assignment.due_at));
                let item = new PopupMenu.PopupMenuItem(
                    `${assignment.course_name}: ${assignment.name}\nDue: ${dateStr}`
                );

                item.connect('activate', () => {
                    Gio.AppInfo.launch_default_for_uri(
                        assignment.html_url,
                        null
                    );
                });

                this._menuSection.addMenuItem(item);
            });
        }

        _fetchAssignments() {
            let now = new Date();
            let futureDate = new Date(now.getTime() + DAYS_AHEAD * 24 * 60 * 60 * 1000);

            let url = `${CANVAS_URL}/api/v1/users/self/upcoming_events?` +
                `start_date=${now.toISOString()}&` +
                `end_date=${futureDate.toISOString()}`;

            let message = Soup.Message.new('GET', url);
            message.request_headers.append('Authorization', `Bearer ${API_TOKEN}`);

            this._httpSession.send_and_read_async(
                message,
                GLib.PRIORITY_DEFAULT,
                null,
                (session, result) => {
                    try {
                        let bytes = session.send_and_read_finish(result);
                        let decoder = new TextDecoder('utf-8');
                        let response = decoder.decode(bytes.get_data());

                        let events = JSON.parse(response);

                        // Filter for assignments only
                        this._assignments = events
                            .filter(event => event.type === 'assignment' && event.assignment)
                            .map(event => ({
                                id: event.assignment.id,
                                name: event.assignment.name,
                                due_at: event.assignment.due_at,
                                course_name: event.context_name || 'Unknown Course',
                                html_url: event.html_url
                            }))
                            .sort((a, b) => new Date(a.due_at) - new Date(b.due_at));

                        this._updateDisplay();
                        this._updateMenu();
                    } catch (e) {
                        log(`Canvas Extension Error: ${e.message}`);
                        this._label.set_text('⚠ Error fetching assignments');
                    }
                }
            );
        }

        _updateDisplay() {
            if (this._assignments.length === 0) {
                this._label.set_text('📚 No upcoming assignments');
                this._needsScroll = false;
                this._stopScrolling();
                return;
            }

            // Create display text
            let displayText = this._assignments.map(assignment => {
                let dueDate = new Date(assignment.due_at);
                let dateStr = this._formatShortDate(dueDate);
                return `${assignment.course_name}: ${assignment.name} (${dateStr})`;
            }).join('  •  ');

            this._label.set_text(`📚 ${displayText}`);

            // Check if scrolling is needed
            this._updateScrolling();
        }

        _updateScrolling() {
            let labelWidth = this._label.width;
            let containerWidth = this._container.width;

            if (labelWidth > STATIC_THRESHOLD && labelWidth > containerWidth) {
                this._needsScroll = true;
                this._startScrolling();
            } else {
                this._needsScroll = false;
                this._stopScrolling();
                this._label.set_position(0, 0);
            }
        }

        _startScrolling() {
            if (this._scrollTimeline) {
                return; // Already scrolling
            }

            let labelWidth = this._label.width;
            let containerWidth = this._container.width;

            if (labelWidth <= containerWidth) {
                return;
            }

            // Calculate scroll duration based on text width
            let scrollDistance = labelWidth + 100; // Add padding
            let duration = (scrollDistance / SCROLL_SPEED) * 1000; // Convert to milliseconds

            this._scrollTimeline = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
                if (!this._needsScroll) {
                    this._scrollTimeline = null;
                    return GLib.SOURCE_REMOVE;
                }

                this._scrollOffset -= 1;

                // Reset when fully scrolled
                if (Math.abs(this._scrollOffset) >= labelWidth + 100) {
                    this._scrollOffset = containerWidth;
                }

                this._label.set_position(this._scrollOffset, 0);

                return GLib.SOURCE_CONTINUE;
            });
        }

        _stopScrolling() {
            if (this._scrollTimeline) {
                GLib.source_remove(this._scrollTimeline);
                this._scrollTimeline = null;
            }
            this._scrollOffset = 0;
        }

        _checkNotifications() {
            let now = new Date();

            this._assignments.forEach(assignment => {
                let dueDate = new Date(assignment.due_at);
                let timeDiff = dueDate - now;
                let minutesDiff = Math.floor(timeDiff / (1000 * 60));

                let notifKey60 = `${assignment.id}-60`;
                let notifKey30 = `${assignment.id}-30`;

                // Check for 1 hour notification (55-65 minutes to account for check interval)
                if (minutesDiff >= 55 && minutesDiff <= 65 && !this._notifiedAssignments.has(notifKey60)) {
                    this._sendNotification(
                        `Assignment Due in 1 Hour`,
                        `${assignment.course_name}: ${assignment.name}`,
                        assignment.html_url
                    );
                    this._notifiedAssignments.add(notifKey60);
                }

                // Check for 30 minute notification (25-35 minutes)
                if (minutesDiff >= 25 && minutesDiff <= 35 && !this._notifiedAssignments.has(notifKey30)) {
                    this._sendNotification(
                        `Assignment Due in 30 Minutes`,
                        `${assignment.course_name}: ${assignment.name}`,
                        assignment.html_url
                    );
                    this._notifiedAssignments.add(notifKey30);
                }
            });
        }

        _sendNotification(title, body, url) {
            let source = new MessageTray.Source('Canvas Assignments', 'dialog-information-symbolic');
            Main.messageTray.add(source);

            let notification = new MessageTray.Notification(source, title, body);
            notification.setTransient(false);

            if (url) {
                notification.connect('activated', () => {
                    Gio.AppInfo.launch_default_for_uri(url, null);
                });
            }

            source.showNotification(notification);
        }

        _formatDate(date) {
            let options = {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            };
            return date.toLocaleDateString('en-US', options);
        }

        _formatShortDate(date) {
            let now = new Date();
            let today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            let tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
            let assignDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

            if (assignDate.getTime() === today.getTime()) {
                return `Today ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
            } else if (assignDate.getTime() === tomorrow.getTime()) {
                return `Tomorrow ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
            } else {
                let options = { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
                return date.toLocaleDateString('en-US', options);
            }
        }

        destroy() {
            if (this._refreshTimer) {
                GLib.source_remove(this._refreshTimer);
                this._refreshTimer = null;
            }

            if (this._notificationTimer) {
                GLib.source_remove(this._notificationTimer);
                this._notificationTimer = null;
            }

            this._stopScrolling();

            super.destroy();
        }
    });

export default class CanvasAssignmentsExtension {
    constructor() {
        this._indicator = null;
    }

    enable() {
        this._indicator = new CanvasIndicator();
        Main.panel.addToStatusArea('canvas-assignments', this._indicator);
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}