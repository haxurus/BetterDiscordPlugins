# MessageLoggerV2 1.10.4 — Unofficial Compatibility Fork

An unofficial compatibility fork of **MessageLoggerV2**, originally created by [Lighty](https://github.com/1Lighty).

This fork updates version `1.10.3` to `1.10.4` and restores compatibility with newer Discord and BetterDiscord builds after changes to Discord's internal stores, message cache and React components.

> [!IMPORTANT]
> This project is not affiliated with, endorsed by or officially supported by Lighty, BetterDiscord or Discord.

## What this plugin does

MessageLoggerV2 locally records:

- deleted messages;
- edited-message history;
- purged messages;
- ghost pings;
- optionally cached message attachments and images.

The original plugin description, credits and copyright notices remain unchanged inside the plugin file.

## Changes in 1.10.4

### Discord store compatibility

- Added safer resolution for `UserStore`.
- Added fallback resolution for `MessageStore`.
- Added fallback resolution for `ChannelStore`.
- Added fallback resolution for `SelectedChannelStore`.
- Added fallback resolution for `UserGuildSettingsStore`.
- Added fallback resolution for `GuildChannelStore`.
- Added startup validation when required Discord stores cannot be found.

The plugin now attempts to resolve stores through, in order:

1. `Webpack.Stores`;
2. `Webpack.getStore()`;
3. legacy Webpack module searches.

### Message cache compatibility

Discord no longer consistently exposes the private `_channelMessages` object used by the original plugin.

This fork:

- keeps using `_channelMessages` when it is available;
- no longer aborts plugin startup when it is missing;
- provides a compatibility layer backed by public `MessageStore` methods;
- updates cache invalidation to work without directly changing the private `ready` property;
- refreshes and re-renders messages through dispatcher events and React updates.

### React and interface compatibility

- Updated message-list detection for current Discord CSS class formats.
- Added a timeout while waiting for message components, preventing indefinite startup hangs.
- Updated chat component lookup to support both current and legacy class formats.
- Reworked forced message rendering to locate an available React component instance safely.

### Stability fixes

- Added safe fallback functions for muted-server and muted-channel checks.
- Prevented crashes when the guild channel store is unavailable.
- Removed an invalid `returnNull` reference from the data-loading error handler.
- Added defensive optional chaining and null checks around renamed or missing Discord modules.

## Installation

1. Download `MessageLoggerV2.plugin.js` from this repository.
2. Open the BetterDiscord plugins folder:
   - BetterDiscord settings → **Plugins** → **Open Plugins Folder**.
3. Replace the existing `MessageLoggerV2.plugin.js` file.
4. Reload Discord with `Ctrl + R`.
5. Enable **MessageLoggerV2** from the BetterDiscord plugin settings.

## Preserving this fork

The plugin still contains the original upstream update addresses. A future official MessageLoggerV2 release may therefore replace this patched version.

To keep using this fork until the compatibility changes are incorporated upstream:

1. open the MessageLoggerV2 settings;
2. expand **Advanced**;
3. disable **Automatic updates**.

Re-enable automatic updates after confirming that the official version contains equivalent fixes.

## Existing data

This patch does not intentionally change the MessageLoggerV2 data format. Existing settings and saved logs should continue to load.

Before replacing the plugin, consider backing up these files from the BetterDiscord plugins folder:

```text
MessageLoggerV2.config.json
MessageLoggerV2Data.config.json
MessageLoggerV2DataBackup.config.json
MLV2_IMAGE_CACHE/
```

File names may vary depending on the BetterDiscord version and enabled plugin options.

## Troubleshooting

### The plugin does not start

1. Update BetterDiscord.
2. Remove the deprecated `XenoLib` and `ZeresPluginLibrary` plugins if they are still installed.
3. Reload Discord with `Ctrl + R`.
4. Open Discord Developer Tools with `Ctrl + Shift + I` and check the Console for errors containing `MessageLoggerV2`.

When reporting a problem, include:

- the MessageLoggerV2 version;
- the BetterDiscord version;
- the error message and stack trace;
- what action caused the error;
- whether it also happens with other plugins disabled.

### Deleted messages are not being logged

By default, the plugin may use whitelist-only logging. Right-click the relevant server or channel and add it to the MessageLogger whitelist, or disable **Only log whitelist** under **Ignores and overrides**.

### Logs disappeared after restarting Discord

Check that **Disable saving data** is turned off. Enabling **Auto backup data** is also recommended.

## Known limitations

- Discord frequently changes private internal modules without notice.
- Future Discord updates may break this patch again.
- Some image-preview functionality in the original `1.10.3` release remains incomplete.
- Compatibility cannot be guaranteed with every BetterDiscord plugin or custom theme.
- The patch has been syntax-checked, but behavior may differ between Discord release channels and operating systems.

## Privacy

MessageLoggerV2 stores message content locally on the computer where it is installed. Cached messages or attachments may contain personal or sensitive information.

You are responsible for:

- protecting the generated log and cache files;
- respecting the privacy of other users;
- complying with applicable laws and platform rules;
- avoiding publication of private conversations without permission.

## Credits

- Original plugin: **MessageLoggerV2**
- Original author: **Lighty**
- Original repository: [1Lighty/BetterDiscordPlugins](https://github.com/1Lighty/BetterDiscordPlugins)
- Compatibility fork: unofficial community maintenance

## Copyright and redistribution

The original source file states that the code is copyrighted by Lighty, all rights are reserved, and redistribution or modification requires explicit permission.

This repository should therefore remain a clearly identified GitHub fork of the original project. Do not remove the original author information, copyright notice, source links or project history. Do not apply a new open-source licence to the original code unless the copyright holder grants permission.

For broader redistribution outside GitHub's fork functionality, obtain explicit permission from the original author.

## Disclaimer

This software is provided without warranty. Use it at your own risk. Client modifications and message logging may be restricted by platform terms, local policies or applicable law.
