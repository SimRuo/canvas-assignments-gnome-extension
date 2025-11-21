#!/bin/bash
# install.sh - Installation script for Canvas Assignments Extension

set -e

echo "📚 Canvas Assignments Extension Installer"
echo "=========================================="
echo ""

# Check if config.js exists
if [ ! -f "config.js" ]; then
    echo "⚠️  config.js not found!"
    echo ""
    echo "Creating config.js from template..."
    cp config.example.js config.js
    echo "✅ config.js created"
    echo ""
    echo "⚠️  IMPORTANT: You need to edit config.js with your Canvas credentials!"
    echo ""
    echo "Steps:"
    echo "1. Get your Canvas API token from: https://canvas.du.se/profile/settings"
    echo "2. Edit config.js and replace:"
    echo "   - CANVAS_URL with your Canvas URL"
    echo "   - API_TOKEN with your actual token"
    echo ""
    read -p "Press Enter after you've edited config.js..."
fi

# Verify config.js has been edited
if grep -q "YOUR_API_TOKEN_HERE" config.js; then
    echo "❌ Error: config.js still contains placeholder values!"
    echo "Please edit config.js with your actual Canvas credentials."
    exit 1
fi

echo "✅ Configuration file ready"
echo ""

# Create extensions directory if it doesn't exist
EXTENSIONS_DIR="$HOME/.local/share/gnome-shell/extensions"
TARGET_DIR="$EXTENSIONS_DIR/canvas-assignments-extension@du.se"

echo "📦 Installing extension..."
mkdir -p "$EXTENSIONS_DIR"

# Copy extension
if [ -d "$TARGET_DIR" ]; then
    echo "⚠️  Extension already exists. Backing up to $TARGET_DIR.backup"
    mv "$TARGET_DIR" "$TARGET_DIR.backup"
fi

cp -r "$(pwd)" "$TARGET_DIR"
echo "✅ Extension copied to $TARGET_DIR"
echo ""

# Detect session type
SESSION_TYPE="${XDG_SESSION_TYPE:-x11}"

echo "🔄 Restarting GNOME Shell..."
if [ "$SESSION_TYPE" = "wayland" ]; then
    echo "⚠️  Wayland detected: You need to log out and log back in"
    echo "   to restart GNOME Shell and load the extension."
else
    echo "X11 detected: Attempting to restart GNOME Shell..."
    echo "Press Alt+F2, type 'r', and press Enter"
    echo "(Or the script will attempt to do it automatically)"
    sleep 2
    # Attempt automatic restart on X11
    busctl --user call org.gnome.Shell /org/gnome/Shell org.gnome.Shell Eval s 'global.reexec_self()' 2>/dev/null || true
fi

echo ""
echo "🔧 Enabling extension..."
sleep 2
gnome-extensions enable canvas-assignments-extension@du.se 2>/dev/null || {
    echo "⚠️  Could not enable extension automatically."
    echo "   Please enable it manually:"
    echo "   gnome-extensions enable canvas-assignments-extension@du.se"
}

echo ""
echo "✅ Installation complete!"
echo ""
echo "🎉 The extension should now appear in your top panel!"
echo ""
echo "💡 Tips:"
echo "   - Click the panel item to see all assignments"
echo "   - Notifications will appear 1 hour and 30 minutes before due dates"
echo "   - The extension refreshes every 30 minutes"
echo ""
echo "🐛 Troubleshooting:"
echo "   - Check logs: journalctl -f /usr/bin/gnome-shell"
echo "   - List extensions: gnome-extensions list"
echo "   - Disable: gnome-extensions disable canvas-assignments-extension@du.se"
echo ""
