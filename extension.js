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
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const REFRESH_INTERVAL = 30 * 60; // 30 minutes in seconds
const DAYS_AHEAD = 14;
const ROTATION_INTERVAL = 30; // seconds between assignment rotations

const CanvasIndicator = GObject.registerClass(
    class CanvasIndicator extends PanelMenu.Button {
        _init(canvasUrl, apiToken, extensionPath) {
            super._init(0.0, 'Canvas Assignments');

            this._canvasUrl = canvasUrl;
            this._apiToken = apiToken;
            this._extensionPath = extensionPath;

            // Create label for assignments
            this._label = new St.Label({
                text: 'Loading Canvas assignments...',
                y_align: Clutter.ActorAlign.CENTER
            });
            this.add_child(this._label);

            // Assignment data and rotation
            this._assignments = [];
            this._dismissedAssignments = new Set();
            this._notifiedAssignments = new Set();
            this._customNames = {}; // Map of assignment ID to custom name
            this._currentAssignmentIndex = 0;

            // HTTP session
            this._httpSession = new Soup.Session();

            // Load dismissed assignments and custom names
            this._loadDismissedAssignments();
            this._loadCustomNames();

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

            // Set up rotation timer (every 30 seconds)
            this._rotationTimer = GLib.timeout_add_seconds(
                GLib.PRIORITY_DEFAULT,
                ROTATION_INTERVAL,
                () => {
                    this._rotateAssignment();
                    return GLib.SOURCE_CONTINUE;
                }
            );
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

            // Add dismissed assignments section
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            this._dismissedSection = new PopupMenu.PopupMenuSection();
            this.menu.addMenuItem(this._dismissedSection);
        }

        _updateMenu() {
            // Clear existing items
            this._menuSection.removeAll();
            this._dismissedSection.removeAll();

            // Filter out dismissed assignments
            let activeAssignments = this._assignments.filter(a => !this._dismissedAssignments.has(a.id));
            let dismissedAssignments = this._assignments.filter(a => this._dismissedAssignments.has(a.id));

            if (activeAssignments.length === 0) {
                let item = new PopupMenu.PopupMenuItem('No upcoming assignments', {
                    reactive: false
                });
                this._menuSection.addMenuItem(item);
            } else {
                // Add each active assignment with dismiss button
                activeAssignments.forEach(assignment => {
                    let dateStr = this._formatDate(new Date(assignment.due_at));

                    // Create a container for the assignment item
                    let container = new St.BoxLayout({
                        style_class: 'popup-menu-item',
                        reactive: true,
                        track_hover: true,
                        can_focus: true,
                        vertical: false
                    });

                    // Assignment button (clickable to open)
                    let assignmentBox = new St.BoxLayout({ vertical: true, x_expand: true });
                    let displayName = this._getDisplayName(assignment);
                    let nameLabel = new St.Label({
                        text: displayName,
                        style_class: 'popup-menu-item-label'
                    });
                    let dateLabel = new St.Label({
                        text: `Due: ${dateStr}`,
                        style_class: 'popup-menu-item-label',
                        style: 'font-size: 0.9em; color: #888;'
                    });
                    assignmentBox.add_child(nameLabel);
                    assignmentBox.add_child(dateLabel);

                    // Edit button
                    let editButton = new St.Button({
                        child: new St.Icon({
                            icon_name: 'document-edit-symbolic',
                            icon_size: 16
                        }),
                        style_class: 'button',
                        style: 'padding: 4px; margin-left: 8px;'
                    });

                    editButton.connect('clicked', () => {
                        this._showEditDialog(assignment);
                    });

                    // Dismiss button
                    let dismissButton = new St.Button({
                        child: new St.Icon({
                            icon_name: 'window-close-symbolic',
                            icon_size: 16
                        }),
                        style_class: 'button',
                        style: 'padding: 4px; margin-left: 4px;'
                    });

                    dismissButton.connect('clicked', () => {
                        this._dismissAssignment(assignment.id);
                    });

                    container.add_child(assignmentBox);
                    container.add_child(editButton);
                    container.add_child(dismissButton);

                    // Make the container clickable to open URL
                    let item = new PopupMenu.PopupBaseMenuItem();
                    item.actor.add_child(container);
                    item.connect('activate', () => {
                        Gio.AppInfo.launch_default_for_uri(assignment.html_url, null);
                    });

                    this._menuSection.addMenuItem(item);
                });
            }

            // Show dismissed assignments section if any
            if (dismissedAssignments.length > 0) {
                let headerItem = new PopupMenu.PopupMenuItem('Dismissed Assignments', {
                    reactive: false,
                    style_class: 'popup-menu-item'
                });
                headerItem.label.style = 'font-weight: bold; color: #888;';
                this._dismissedSection.addMenuItem(headerItem);

                dismissedAssignments.forEach(assignment => {
                    let dateStr = this._formatDate(new Date(assignment.due_at));

                    let container = new St.BoxLayout({
                        style_class: 'popup-menu-item',
                        reactive: true,
                        track_hover: true,
                        can_focus: true,
                        vertical: false
                    });

                    let assignmentBox = new St.BoxLayout({ vertical: true, x_expand: true });
                    let displayName = this._getDisplayName(assignment);
                    let nameLabel = new St.Label({
                        text: displayName,
                        style_class: 'popup-menu-item-label',
                        style: 'color: #666;'
                    });
                    let dateLabel = new St.Label({
                        text: `Due: ${dateStr}`,
                        style_class: 'popup-menu-item-label',
                        style: 'font-size: 0.9em; color: #666;'
                    });
                    assignmentBox.add_child(nameLabel);
                    assignmentBox.add_child(dateLabel);

                    // Edit button
                    let editButton = new St.Button({
                        child: new St.Icon({
                            icon_name: 'document-edit-symbolic',
                            icon_size: 16
                        }),
                        style_class: 'button',
                        style: 'padding: 4px; margin-left: 8px;'
                    });

                    editButton.connect('clicked', () => {
                        this._showEditDialog(assignment);
                    });

                    // Restore button
                    let restoreButton = new St.Button({
                        child: new St.Icon({
                            icon_name: 'edit-undo-symbolic',
                            icon_size: 16
                        }),
                        style_class: 'button',
                        style: 'padding: 4px; margin-left: 4px;'
                    });

                    restoreButton.connect('clicked', () => {
                        this._restoreAssignment(assignment.id);
                    });

                    container.add_child(assignmentBox);
                    container.add_child(editButton);
                    container.add_child(restoreButton);

                    let item = new PopupMenu.PopupBaseMenuItem();
                    item.actor.add_child(container);

                    this._dismissedSection.addMenuItem(item);
                });
            }
        }

        _fetchAssignments() {
            let now = new Date();
            let futureDate = new Date(now.getTime() + DAYS_AHEAD * 24 * 60 * 60 * 1000);

            // Use planner API to get upcoming assignments
            let url = `${this._canvasUrl}/api/v1/planner/items?` +
                `start_date=${now.toISOString().split('T')[0]}&` +
                `end_date=${futureDate.toISOString().split('T')[0]}`;

            let message = Soup.Message.new('GET', url);
            message.request_headers.append('Authorization', `Bearer ${this._apiToken}`);

            this._httpSession.send_and_read_async(
                message,
                GLib.PRIORITY_DEFAULT,
                null,
                (session, result) => {
                    try {
                        let bytes = session.send_and_read_finish(result);
                        let decoder = new TextDecoder('utf-8');
                        let response = decoder.decode(bytes.get_data());

                        let items = JSON.parse(response);

                        // Filter for assignments only
                        this._assignments = items
                            .filter(item => item.plannable_type === 'assignment' && item.plannable)
                            .map(item => ({
                                id: item.plannable.id,
                                name: item.plannable.title,
                                due_at: item.plannable.due_at,
                                course_name: item.context_name || 'Unknown Course',
                                html_url: `${this._canvasUrl}${item.html_url}`
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
            // Filter out dismissed assignments
            let activeAssignments = this._assignments.filter(a => !this._dismissedAssignments.has(a.id));

            if (activeAssignments.length === 0) {
                this._label.set_text('📚 No upcoming assignments');
                return;
            }

            // Reset index if needed
            if (this._currentAssignmentIndex >= activeAssignments.length) {
                this._currentAssignmentIndex = 0;
            }

            this._showCurrentAssignment();
        }

        _showCurrentAssignment() {
            // Filter out dismissed assignments
            let activeAssignments = this._assignments.filter(a => !this._dismissedAssignments.has(a.id));

            if (activeAssignments.length === 0) {
                this._label.set_text('📚 No upcoming assignments');
                return;
            }

            let assignment = activeAssignments[this._currentAssignmentIndex];
            let dueDate = new Date(assignment.due_at);
            let dateStr = this._formatShortDate(dueDate);
            let displayName = this._getDisplayName(assignment);

            let displayText = `📚 ${displayName} (${dateStr})`;

            // Fade out, change text, fade in
            this._label.ease({
                opacity: 0,
                duration: 500,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    this._label.set_text(displayText);
                    this._label.ease({
                        opacity: 255,
                        duration: 500,
                        mode: Clutter.AnimationMode.EASE_IN_QUAD
                    });
                }
            });
        }

        _rotateAssignment() {
            // Filter out dismissed assignments
            let activeAssignments = this._assignments.filter(a => !this._dismissedAssignments.has(a.id));

            if (activeAssignments.length <= 1) {
                return; // No need to rotate with 0 or 1 assignment
            }

            this._currentAssignmentIndex = (this._currentAssignmentIndex + 1) % activeAssignments.length;
            this._showCurrentAssignment();
        }

        _loadDismissedAssignments() {
            try {
                let dismissedFile = Gio.File.new_for_path(this._extensionPath + '/dismissed.json');
                if (!dismissedFile.query_exists(null)) {
                    return;
                }

                let [success, contents] = dismissedFile.load_contents(null);
                if (success) {
                    let decoder = new TextDecoder('utf-8');
                    let json = decoder.decode(contents);
                    let dismissed = JSON.parse(json);
                    this._dismissedAssignments = new Set(dismissed);
                }
            } catch (e) {
                log(`Canvas Extension: Error loading dismissed assignments: ${e.message}`);
            }
        }

        _saveDismissedAssignments() {
            try {
                let dismissedFile = Gio.File.new_for_path(this._extensionPath + '/dismissed.json');
                let json = JSON.stringify(Array.from(this._dismissedAssignments));
                dismissedFile.replace_contents(
                    json,
                    null,
                    false,
                    Gio.FileCreateFlags.REPLACE_DESTINATION,
                    null
                );
            } catch (e) {
                log(`Canvas Extension: Error saving dismissed assignments: ${e.message}`);
            }
        }

        _dismissAssignment(assignmentId) {
            this._dismissedAssignments.add(assignmentId);
            this._saveDismissedAssignments();
            this._updateDisplay();
            this._updateMenu();
        }

        _restoreAssignment(assignmentId) {
            this._dismissedAssignments.delete(assignmentId);
            this._saveDismissedAssignments();
            this._updateDisplay();
            this._updateMenu();
        }

        _loadCustomNames() {
            try {
                let customNamesFile = Gio.File.new_for_path(this._extensionPath + '/customNames.json');
                if (!customNamesFile.query_exists(null)) {
                    return;
                }

                let [success, contents] = customNamesFile.load_contents(null);
                if (success) {
                    let decoder = new TextDecoder('utf-8');
                    let json = decoder.decode(contents);
                    this._customNames = JSON.parse(json);
                }
            } catch (e) {
                log(`Canvas Extension: Error loading custom names: ${e.message}`);
            }
        }

        _saveCustomNames() {
            try {
                let customNamesFile = Gio.File.new_for_path(this._extensionPath + '/customNames.json');
                let json = JSON.stringify(this._customNames, null, 2);
                customNamesFile.replace_contents(
                    json,
                    null,
                    false,
                    Gio.FileCreateFlags.REPLACE_DESTINATION,
                    null
                );
            } catch (e) {
                log(`Canvas Extension: Error saving custom names: ${e.message}`);
            }
        }

        _getDisplayName(assignment) {
            // Return custom display string if set, otherwise return default format
            if (this._customNames[assignment.id]) {
                return this._customNames[assignment.id];
            }
            return `${assignment.course_name}: ${assignment.name}`;
        }

        _showEditDialog(assignment) {
            let dialog = new ModalDialog.ModalDialog();

            // Add title
            let headline = new St.Label({
                text: 'Edit Assignment Display',
                style: 'font-weight: bold; font-size: 1.2em; margin-bottom: 10px;'
            });
            dialog.contentLayout.add_child(headline);

            // Show original format
            let originalLabel = new St.Label({
                text: `Original: ${assignment.course_name}: ${assignment.name}`,
                style: 'margin-bottom: 10px; color: #888; font-size: 0.9em;'
            });
            dialog.contentLayout.add_child(originalLabel);

            // Text entry for custom display string
            let currentDisplay = this._customNames[assignment.id] || `${assignment.course_name}: ${assignment.name}`;
            let entry = new St.Entry({
                style_class: 'run-dialog-entry',
                hint_text: 'Enter custom display text...',
                text: currentDisplay,
                can_focus: true,
                x_expand: true
            });
            dialog.contentLayout.add_child(entry);

            // Add buttons
            dialog.addButton({
                label: 'Cancel',
                action: () => {
                    dialog.close();
                },
                key: Clutter.KEY_Escape
            });

            dialog.addButton({
                label: 'Reset to Original',
                action: () => {
                    delete this._customNames[assignment.id];
                    this._saveCustomNames();
                    this._updateDisplay();
                    this._updateMenu();
                    dialog.close();
                }
            });

            dialog.addButton({
                label: 'Save',
                action: () => {
                    let newDisplay = entry.get_text().trim();
                    let originalDisplay = `${assignment.course_name}: ${assignment.name}`;
                    if (newDisplay && newDisplay !== originalDisplay) {
                        this._customNames[assignment.id] = newDisplay;
                    } else if (newDisplay === originalDisplay) {
                        // If set back to original, remove custom display
                        delete this._customNames[assignment.id];
                    }
                    this._saveCustomNames();
                    this._updateDisplay();
                    this._updateMenu();
                    dialog.close();
                },
                key: Clutter.KEY_Return
            });

            dialog.open();

            // Focus the entry field
            global.stage.set_key_focus(entry);
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

            if (this._rotationTimer) {
                GLib.source_remove(this._rotationTimer);
                this._rotationTimer = null;
            }

            super.destroy();
        }
    });

export default class CanvasAssignmentsExtension extends Extension {
    enable() {
        // Load config from the extension directory
        const configPath = this.path + '/config.js';
        const configFile = Gio.File.new_for_path(configPath);
        const [success, contents] = configFile.load_contents(null);

        if (!success) {
            log('Canvas Extension Error: Could not load config.js');
            return;
        }

        const decoder = new TextDecoder('utf-8');
        const configText = decoder.decode(contents);

        // Execute config script to get variables
        const configFunc = new Function(configText + '; return {CANVAS_URL, API_TOKEN};');
        const config = configFunc();

        this._indicator = new CanvasIndicator(config.CANVAS_URL, config.API_TOKEN, this.path);
        Main.panel.addToStatusArea('canvas-assignments', this._indicator);
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}