# Canvas Assignments GNOME Shell Extension

A GNOME Shell extension that displays your upcoming Canvas assignments in the top panel with automatic scrolling and notification reminders.

## Features

- 📚 Shows upcoming assignments from Canvas LMS in the top panel
- 🔄 Auto-scrolling when text is too long, static display when it fits
- 🔔 Notifications at 1 hour and 30 minutes before assignment due dates
- ⏰ Automatically refreshes every 30 minutes
- 📅 Shows assignments due in the next 14 days
- 🖱️ Click to see full list and open assignments in browser

## Installation

### Method 1: Manual Installation (Recommended)

1. Copy the extension folder to your GNOME Shell extensions directory:
   ```bash
   cp -r canvas-assignments-extension@du.se ~/.local/share/gnome-shell/extensions/
   ```

2. Restart GNOME Shell:
   - On X11: Press `Alt + F2`, type `r`, and press Enter
   - On Wayland: Log out and log back in

3. Enable the extension:
   ```bash
   gnome-extensions enable canvas-assignments-extension@du.se
   ```

### Method 2: Using Extension Manager

1. Install GNOME Extensions app if you don't have it:
   ```bash
   sudo apt install gnome-shell-extension-manager
   ```

2. Copy the extension folder as in Method 1

3. Open Extensions app and enable "Canvas Assignments"

## Configuration

The extension is pre-configured with your Canvas credentials. If you need to update them:

1. Open `~/.local/share/gnome-shell/extensions/canvas-assignments-extension@du.se/extension.js`

2. Modify these constants at the top:
   ```javascript
   const CANVAS_URL = 'https://canvas.du.se';
   const API_TOKEN = 'your-api-token-here';
   const REFRESH_INTERVAL = 30 * 60; // seconds
   const DAYS_AHEAD = 14; // days to look ahead
   ```

3. Restart GNOME Shell for changes to take effect

## Usage

- **Top Panel**: Shows scrolling (or static) list of upcoming assignments
- **Click Panel**: Opens dropdown menu with:
  - Refresh button
  - Complete list of assignments with due dates
  - Click any assignment to open it in your browser

- **Notifications**: Automatic reminders:
  - 1 hour before due date
  - 30 minutes before due date

## Troubleshooting

### Extension doesn't show up
```bash
# Check if extension is installed
gnome-extensions list

# Check for errors
journalctl -f /usr/bin/gnome-shell
```

### API Connection Issues
- Verify your API token is still valid at https://canvas.du.se/profile/settings
- Check your internet connection
- Look for error messages in the logs

### Disable the extension
```bash
gnome-extensions disable canvas-assignments-extension@du.se
```

### Remove the extension
```bash
rm -rf ~/.local/share/gnome-shell/extensions/canvas-assignments-extension@du.se
```

## Security Note

Your Canvas API token is stored in plain text in the extension file. Keep your token secure:
- Don't share your extension folder
- Regenerate the token if compromised
- Use a token with minimal required permissions

## Compatibility

- GNOME Shell 42, 43, 44, 45, 46
- Ubuntu 22.04+, Fedora 36+, and other modern distributions
- Tested on Ubuntu with default GNOME Shell

## License

MIT License - Feel free to modify and distribute

## Support

If you encounter issues:
1. Check the logs: `journalctl -f /usr/bin/gnome-shell`
2. Verify your API token is valid
3. Make sure Canvas API is accessible from your network
