# Canvas Assignments Extension

I got tired of missing Canvas deadlines, so I made this little extension. It shows your upcoming assignments in the GNOME top panel and sends notifications before they're due.

## Setup

Get your Canvas API token first:

- Go to Canvas → Settings → Approved Integrations → New Access Token
- Copy it somewhere safe

Then:

```bash
git clone https://github.com/YOUR-USERNAME/canvas-assignments-extension.git
cd canvas-assignments-extension
chmod +x install.sh
./install.sh
```

The install script will create `config.js` from the template and guide you through adding your Canvas credentials.

That's it. The extension should appear in your top panel.

## What it does

- Shows assignments due in the next 14 days
- Refreshes every 30 minutes
- Sends notifications at 1 hour and 30 minutes before deadlines
- Click to see details or open in browser
- Right-click assignments to remove irrelevant ones from the list

## Troubleshooting

Not working? Check the logs:

```bash
journalctl -f /usr/bin/gnome-shell
```

You might need to restart your GNOME shell too. Alt + f2, input r.

## Note

Your API token stays in config.js on your computer. It's gitignored so you won't accidentally push it to GitHub.
