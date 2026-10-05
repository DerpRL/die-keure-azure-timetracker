# Slack stand-up tracking

Azure timetracker detects stand-up huddles in channels you select. The tracking entry uses **no Azure work item**, the **Standup / Stand-up** activity, and the exact comment **daily standup**. The app opens a suggestion and requires confirmation before changing 7pace. Ensure your 7pace workspace allows comment-only tracking and has an enabled Standup activity.

## Connect Slack

This uses your own Slack app in your workspace, with optional Socket Mode. Periodic channel checks work with the User OAuth Token alone. No public server is needed. Workspace administrators may need to approve installation. Each person must use their own User OAuth Token; do not share tokens or paste them into chat.

1. Open [Slack app management](https://api.slack.com/apps), choose **Create New App → From a manifest**, select your workspace, and use the supplied `slack-app-manifest.json`.
2. The manifest enables Socket Mode, requests user scopes `users:read`, `channels:history`, and `groups:history`, and subscribes to `user_huddle_changed`, `message.channels`, and `message.groups` as user events. If you only watch public channels, remove `groups:history` and `message.groups` before installation.
3. Optionally, under **Basic Information → App-Level Tokens**, generate an app-level token with `connections:write`. It starts with `xapp-`.
4. Install the app to your workspace. Under **OAuth & Permissions**, copy your **User OAuth Token**, which starts with `xoxp-`. A bot token (`xoxb-`) is not sufficient. If you change scopes later, reinstall the Slack app.
5. In Azure timetracker **Settings → Meetings → Slack stand-up huddles**, enter the workspace ID (`T…`) and channel IDs (`C…`/`G…`) or copied Slack channel links. Your workspace ID is visible in the Slack web app URL `app.slack.com/client/T…/C…`.
6. Enter the User OAuth Token and, optionally, the Socket Mode token in their secure fields, enable detection, and choose **Save changes**. Blank token fields preserve existing saved tokens for that workspace. The status should read **Checking for stand-up huddles every minute**. Each channel shows its check result. Use **Check now** for an immediate check of saved settings.

**Suggest only after I join** is on by default. Turn it off if you want a suggestion as soon as a huddle starts in one of those channels, even before joining. Choose dedicated stand-up channels; every huddle in a configured channel is treated as a stand-up, without trying to interpret its conversation.

## Daily use

Keep Azure timetracker running in the menu bar. Join a newly started stand-up huddle in a watched channel and choose **Review & start…**. Check the Standup activity and press **Start**. Your prior timer continues until confirmation. The comment is fixed to `daily standup`; there is no ticket picker for this action.

If you were tracking a ticket before the huddle, the app can offer to return to it when Slack confirms that you left or the huddle ended. This is a suggestion, not an automatic timer switch. If Slack disconnects, the 7pace timer continues and the app does not invent an end time. Manual Pause and Stop remain available. In start-before-join mode, an end is detected from the huddle thread update unless the app observed your participation.

The app checks your huddle presence every 30 seconds and each configured channel’s recent history every minute, whether or not Socket Mode connects. It recovers missed huddle events and preserves known rooms across Socket Mode reconnects. Channel-start suggestions only appear within five minutes of a start; joined rooms can be recovered from the past 12 hours. History is bounded to five pages of up to 100 messages per channel per check. Busy channels or rate limits can delay or prevent recovery; diagnostics identify incomplete checks. Unconfirmed huddles expire rather than being treated as a confirmed end.

For a missed huddle in **#team-team**, copy that channel’s link in Slack and add it to the configured channel list, save, then press **Check now** while the huddle is active. Names alone are not accepted because channels can be renamed or duplicated. Check each channel’s result: unreadable channels usually need the correct ID, membership, or history permission; missing scopes require reinstalling the Slack app. The User OAuth Token must belong to your account in that workspace. A green connection status alone does not prove a particular channel is readable. Live Slack delivery and the history fallback still need validation with your workspace’s installation.

## Privacy and credentials

Slack grants the history scopes at its workspace/conversation permission level, not just for your selected channels. The tracker filters incoming events to the configured workspace and channels and immediately discards ordinary messages. History reads are limited to your configured channels; ordinary message bodies and participant lists returned by Slack are discarded and never persisted. It keeps only huddle/channel identifiers and timestamps for detection; a short-lived occurrence ledger prevents duplicate suggestions. It does not record audio/video, scrape the Slack desktop app, send Slack messages, or upload message content to Azure or 7pace.

Tokens are stored in macOS Keychain and sent only to Slack's HTTPS API. The app receives events over a Slack-hosted secure WebSocket. Slack and 7pace credentials remain separate. Disable the feature in Settings to disconnect it; revoke its tokens or remove the Slack app from your workspace to revoke access.

References: [Slack Socket Mode](https://docs.slack.dev/apis/events-api/using-socket-mode/), [huddle status events](https://docs.slack.dev/reference/events/user_huddle_changed/), [7pace tracking API](https://appfire.atlassian.net/wiki/spaces/7TFA/pages/1253540758/7pace%2BTimetracker%2BClient%2BTracking%2BAPI).
