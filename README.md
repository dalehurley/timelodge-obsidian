# TimeLodge Day Summary

Create a Markdown note with a day’s TimeLodge time entry count, recorded time and billable time. Use it in your daily review or project journal.

## Setup

1. Use Obsidian desktop 1.11.4 or later. For a manual install, copy `manifest.json` and `main.js` from the matching GitHub release into `.obsidian/plugins/timelodge-day-summary/` in your vault, then enable TimeLodge Day Summary in Community plugins settings.
2. In [TimeLodge API & webhooks](https://timelodge.com/developers), follow the service-token setup for your workspace. Create a dedicated token with only `time:read` access.
3. In Obsidian, open **Settings → TimeLodge Day Summary** and select or add the token using Secret Storage. This takes an active TimeLodge workspace with API access and its applicable subscription. The plugin has no separate fee. Obsidian Sync and Publish are optional services.

## Create a summary

Open the command palette, run **TimeLodge Day Summary: Create daily summary** and choose the date recorded on the TimeLodge entries. The plugin creates `TimeLodge YYYY-MM-DD.md` at the vault root. If the note already exists, the command opens it and preserves your edits. To generate a fresh copy, first move or rename the existing note.

## Network and data

The plugin connects to `https://timelodge.com/api/v1/time-entries` when you create a new summary. It sends a bearer token, the selected date and pagination parameters. It reads entries the token’s workspace can access, then writes only the date, counts and duration totals to your vault. The plugin sends no vault content, adds no analytics and does not change TimeLodge entries. Ordinary TimeLodge API logging and the [TimeLodge privacy policy](https://timelodge.com/privacy) apply. Your vault’s sharing and sync settings apply to generated notes.

Obsidian Secret Storage manages the token. Plugin settings hold only its name. Choose **Disconnect** to clear this plugin’s selection. Revoke the dedicated token in TimeLodge and remove its entry from Obsidian Secret Storage if you no longer need it. Existing Markdown notes remain in the vault.

## Development

With Node.js 22 or later, run `npm ci` and `npm run check`. The build uses the Obsidian API and creates `main.js`. Tests run the bundled command with a simulated Obsidian API. The time API reader is adapted from [TimeLodge Time Summary](https://github.com/dalehurley/timelodge-time-summary) under the MIT license.

For support, contact support@timelodge.com. Keep API tokens and private workspace data out of support requests.
