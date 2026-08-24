# CustomActivities

CustomActivities is a BetterDiscord plugin for creating, saving, managing, and switching custom Discord Rich Presence profiles directly inside Discord.

## Current Version

**2.2.0 CLEAN**

This release includes the rebuilt activity editor introduced after the previous 1.x interface. The form system uses dedicated, isolated classes and keeps the Activity, Images, and Buttons panels mounted instead of recreating them every time a tab is selected.

## Features

- Create and save multiple Rich Presence profiles
- Quickly switch between saved profiles
- Activity types: Playing, Streaming, Listening, Watching, and Competing
- Custom activity name, details, and state
- Optional elapsed timer
- Large image asset key and hover text
- Small image asset key and hover text
- Up to two external Rich Presence buttons
- Auto-start support for a selected profile
- Optional protection against other Discord RPC applications replacing the active presence
- Quick-access button next to Discord's user controls
- Built-in activity manager window
- Responsive layout using container-aware styling
- High-contrast dark and light palettes
- Clearly outlined text fields and selects
- Duplicate installation detection

## Editor Sections

### Activity

Contains the main Rich Presence configuration:

- Profile name
- Discord Application ID / Client ID
- Activity name
- Activity type
- Details
- State
- Streaming URL when the Streaming type is selected
- Elapsed timer toggle

### Images

Contains Discord application asset configuration:

- Large image asset key
- Large image hover text
- Small image asset key
- Small image hover text

Image keys must match assets configured in the corresponding Discord application.

### Buttons

Contains up to two optional external buttons:

- Button 1 label
- Button 1 URL
- Button 2 label
- Button 2 URL

Button labels are limited to 32 characters. Button URLs must use `http://` or `https://`.

## Installation

1. Download `CustomActivities.plugin.js`.
2. Open your BetterDiscord plugins folder.
3. Remove older or duplicate copies of CustomActivities.
4. Place `CustomActivities.plugin.js` in the plugins folder.
5. Enable **CustomActivities** from **User Settings > BetterDiscord > Plugins**.

Keep only one file containing `@name CustomActivities` in the BetterDiscord plugins directory. The plugin performs a duplicate-installation check on startup and warns when multiple copies are detected.

## Creating a Discord Application

CustomActivities requires a Discord Application ID / Client ID for each Rich Presence profile.

1. Open the Discord Developer Portal.
2. Create or select an application.
3. Copy the application's Application ID / Client ID into the profile.
4. If you want Rich Presence images, upload the required assets to the application and use their asset keys in the Images tab.

The plugin includes a **Developer Portal** button for quick access.

## Quick Access

When the plugin is enabled, it adds a CustomActivities button near Discord's user controls. Selecting it opens the activity manager without requiring you to navigate through BetterDiscord settings.

The quick-access manager and the BetterDiscord settings panel use the same profile data and editor system.

## Auto-start

Enable **Auto-start** and choose a startup profile to have CustomActivities attempt to restore that Rich Presence when Discord loads.

## Protect Presence

When **Protect presence** is enabled, the plugin attempts to prevent other Discord RPC applications from replacing the currently active custom activity.

Disable this option if you want games or other RPC applications to replace CustomActivities normally.

## Troubleshooting

### An old version still appears

Check the BetterDiscord plugins directory and remove duplicate `CustomActivities*.plugin.js` files. BetterDiscord may load a different copy if more than one plugin file declares the same plugin name.

### Activity does not activate

Verify that:

- The Application ID / Client ID is correct.
- The Discord application still exists.
- Button URLs are valid HTTP or HTTPS URLs.
- Both the label and URL are provided for each configured button.

Discord frequently changes internal client modules. A Discord update can temporarily break Rich Presence functionality until the plugin is updated.

## Compatibility

CustomActivities depends on BetterDiscord APIs and Discord's internal RPC-related modules. Compatibility can therefore change after Discord client updates.

## Disclaimer

This plugin is an independent BetterDiscord modification and is not affiliated with or endorsed by Discord Inc. Use BetterDiscord and client modifications according to the rules and policies applicable to your account and environment.
