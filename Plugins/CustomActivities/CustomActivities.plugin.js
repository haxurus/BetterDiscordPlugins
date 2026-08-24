/**
 * @name CustomActivities
 * @author Haxurus
 * @version 1.4.1
 * @description Create, save and switch fully customized Discord Rich Presence activities directly from BetterDiscord.
 * @source https://github.com/haxurus/BetterDiscordPlugins/tree/master/Plugins/CustomActivities
 */

module.exports = class CustomActivities {
    constructor() {
        this.pluginName = "CustomActivities";
        this.version = "1.4.1";
        this.defaultSettings = {
            autoStart: false,
            protectActivity: true,
            activeProfileId: null,
            profiles: []
        };

        this.settings = this.loadSettings();
        this.currentProfileId = null;
        this.runtimeStart = null;
        this.setActivityAction = null;
        this.allowSetActivity = false;
        this.protectionUnpatch = null;

        this.settingsRoots = new Set();
        this.quickButton = null;
        this.quickObserver = null;
        this.quickObserverFrame = null;
        this.managerOverlay = null;
        this.managerKeyHandler = null;
    }

    start() {
        this.addStyle();
        this.startQuickButtonObserver();

        if (this.settings.autoStart && this.settings.activeProfileId && this.getProfile(this.settings.activeProfileId)) {
            setTimeout(() => this.activateProfile(this.settings.activeProfileId, true), 1500);
        }
    }

    stop() {
        this.stopQuickButtonObserver();
        this.removeQuickButton();
        this.closeManager();
        this.stopActivity(false).finally(() => {
            this.removeProtection();
            BdApi.Patcher?.unpatchAll?.(this.pluginName);
            this.removeStyle();
            this.settingsRoots.clear();
        });
    }

    loadSettings() {
        const saved = BdApi.Data?.load?.(this.pluginName, "settings") ?? BdApi.loadData?.(this.pluginName, "settings") ?? {};
        const settings = Object.assign({}, this.defaultSettings, saved || {});
        settings.profiles = Array.isArray(settings.profiles) ? settings.profiles : [];
        return settings;
    }

    saveSettings() {
        if (BdApi.Data?.save) BdApi.Data.save(this.pluginName, "settings", this.settings);
        else BdApi.saveData?.(this.pluginName, "settings", this.settings);
    }

    toast(message, type = "info") {
        if (BdApi.UI?.showToast) BdApi.UI.showToast(message, {type});
        else BdApi.showToast?.(message, {type});
    }

    getProfile(id) {
        return this.settings.profiles.find(profile => profile.id === id) || null;
    }

    createProfile() {
        return {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            profileName: "New Activity",
            clientId: "",
            activityName: "",
            type: 0,
            streamUrl: "",
            details: "",
            state: "",
            enableTimer: true,
            largeImageKey: "",
            largeImageText: "",
            smallImageKey: "",
            smallImageText: "",
            button1Label: "",
            button1Url: "",
            button2Label: "",
            button2Url: ""
        };
    }

    findModule(predicate) {
        try {
            if (BdApi.Webpack?.getModule) return BdApi.Webpack.getModule(predicate, {searchExports: true});
        } catch (error) {
            console.warn(`[${this.pluginName}] Webpack lookup failed`, error);
        }

        try {
            if (BdApi.findModule) return BdApi.findModule(predicate);
        } catch (error) {
            console.warn(`[${this.pluginName}] Legacy Webpack lookup failed`, error);
        }

        return null;
    }

    getRpcValidatorModule() {
        return this.findModule(module => module && typeof module.validateSocketClient === "function");
    }

    getSetActivityAction() {
        const module = this.findModule(candidate => candidate?.SET_ACTIVITY && typeof candidate.SET_ACTIVITY.handler === "function");
        return module?.SET_ACTIVITY || null;
    }

    async validateApplication(clientId) {
        const validatorModule = this.getRpcValidatorModule();
        if (!validatorModule) {
            throw new Error("Discord RPC validator module was not found. Discord may have changed its internal modules.");
        }

        const socket = {
            application: {id: null, name: null, icon: null},
            authorization: {accessToken: null, authing: false, expires: new Date(0), scopes: []},
            encoding: "json",
            transport: "ipc",
            id: "custom-activities",
            version: 1
        };

        await validatorModule.validateSocketClient.call(validatorModule, socket, null, clientId);
        if (!socket.application?.id) throw new Error("Discord did not return application information for this Client ID.");
        return socket;
    }

    isValidHttpUrl(value) {
        if (!value) return false;
        try {
            const url = new URL(value);
            return url.protocol === "http:" || url.protocol === "https:";
        } catch (_) {
            return false;
        }
    }

    validateProfile(profile) {
        if (!profile.clientId || !/^\d{10,25}$/.test(profile.clientId.trim())) {
            throw new Error("Enter a valid Discord Application ID / Client ID.");
        }

        if (Number(profile.type) === 1 && profile.streamUrl && !this.isValidHttpUrl(profile.streamUrl)) {
            throw new Error("The streaming URL must be a valid http:// or https:// URL.");
        }

        for (const [label, url, number] of [
            [profile.button1Label, profile.button1Url, 1],
            [profile.button2Label, profile.button2Url, 2]
        ]) {
            if ((label && !url) || (!label && url)) throw new Error(`Button ${number} requires both a label and a URL.`);
            if (label && label.length > 32) throw new Error(`Button ${number} label cannot exceed 32 characters.`);
            if (url && !this.isValidHttpUrl(url)) throw new Error(`Button ${number} URL is invalid.`);
        }
    }

    buildActivityEvent(profile, socket) {
        const app = socket.application || {};
        const activity = {
            name: profile.activityName?.trim() || app.name || profile.profileName || "Custom Activity",
            type: Number(profile.type) || 0,
            application_id: profile.clientId.trim(),
            timestamps: {},
            assets: {},
            buttons: []
        };

        if (profile.details?.trim()) activity.details = profile.details.trim();
        if (profile.state?.trim()) activity.state = profile.state.trim();
        if (Number(profile.type) === 1 && profile.streamUrl?.trim()) activity.url = profile.streamUrl.trim();
        if (profile.enableTimer) activity.timestamps.start = this.runtimeStart || Date.now();

        if (profile.largeImageKey?.trim()) {
            activity.assets.large_image = profile.largeImageKey.trim();
            if (profile.largeImageText?.trim()) activity.assets.large_text = profile.largeImageText.trim();
        }

        if (profile.smallImageKey?.trim()) {
            activity.assets.small_image = profile.smallImageKey.trim();
            if (profile.smallImageText?.trim()) activity.assets.small_text = profile.smallImageText.trim();
        }

        if (profile.button1Label?.trim() && profile.button1Url?.trim()) {
            activity.buttons.push({label: profile.button1Label.trim(), url: profile.button1Url.trim()});
        }

        if (profile.button2Label?.trim() && profile.button2Url?.trim()) {
            activity.buttons.push({label: profile.button2Label.trim(), url: profile.button2Url.trim()});
        }

        return {
            isSocketConnected: () => true,
            socket: {
                transport: "ipc",
                id: socket.id || "custom-activities",
                version: socket.version || 1,
                encoding: socket.encoding || "json",
                application: {
                    id: profile.clientId.trim(),
                    name: app.name || activity.name,
                    icon: app.icon ?? null,
                    coverImage: app.coverImage ?? app.cover_image ?? null,
                    flags: app.flags ?? 0
                }
            },
            cmd: "SET_ACTIVITY",
            args: {
                pid: require("process").pid,
                activity
            }
        };
    }

    async dispatchSetActivity(payload) {
        if (!this.setActivityAction || typeof this.setActivityAction.handler !== "function") {
            throw new Error("Discord SET_ACTIVITY handler is unavailable.");
        }

        this.allowSetActivity = true;
        try {
            return await this.setActivityAction.handler(payload);
        } finally {
            this.allowSetActivity = false;
        }
    }

    installProtection() {
        this.removeProtection();
        if (!this.settings.protectActivity || !this.setActivityAction || !BdApi.Patcher?.instead) return;

        this.protectionUnpatch = BdApi.Patcher.instead(
            this.pluginName,
            this.setActivityAction,
            "handler",
            (_thisObject, args, originalFunction) => {
                const payload = args?.[0];
                if (this.allowSetActivity || payload?.cmd !== "SET_ACTIVITY") return originalFunction(...args);
                return undefined;
            }
        );
    }

    removeProtection() {
        if (typeof this.protectionUnpatch === "function") {
            try { this.protectionUnpatch(); }
            catch (error) { console.warn(`[${this.pluginName}] Failed to remove activity protection`, error); }
        }
        this.protectionUnpatch = null;
    }

    async activateProfile(profileId, silent = false) {
        const profile = this.getProfile(profileId);
        if (!profile) return false;

        try {
            this.validateProfile(profile);

            if (this.currentProfileId && this.currentProfileId !== profileId) {
                await this.stopActivity(false);
            }

            const socket = await this.validateApplication(profile.clientId.trim());
            this.setActivityAction = this.getSetActivityAction();
            if (!this.setActivityAction) throw new Error("Discord SET_ACTIVITY handler was not found. Discord may have changed its internal modules.");

            this.runtimeStart = Date.now();
            await this.dispatchSetActivity(this.buildActivityEvent(profile, socket));

            this.currentProfileId = profile.id;
            this.settings.activeProfileId = profile.id;
            this.saveSettings();
            this.installProtection();
            this.syncQuickButton();
            this.refreshSettingsPanels();

            if (!silent) this.toast(`Activity "${profile.profileName}" is now active.`, "success");
            return true;
        } catch (error) {
            console.error(`[${this.pluginName}] Failed to activate profile`, error);
            this.removeProtection();
            this.syncQuickButton();
            this.toast(error?.message || "Failed to activate the custom activity.", "error");
            return false;
        }
    }

    async stopActivity(showToast = true) {
        try {
            if (this.setActivityAction) {
                await this.dispatchSetActivity({
                    isSocketConnected: () => true,
                    socket: {transport: "ipc", id: "custom-activities", version: 1, encoding: "json"},
                    cmd: "SET_ACTIVITY",
                    args: {pid: require("process").pid}
                });
            }
        } catch (error) {
            console.warn(`[${this.pluginName}] Failed to clear activity`, error);
        } finally {
            this.removeProtection();
            this.currentProfileId = null;
            this.runtimeStart = null;
            this.setActivityAction = null;
            this.syncQuickButton();
            this.refreshSettingsPanels();
        }

        if (showToast) this.toast("Custom activity stopped.", "info");
    }

    openExternal(url) {
        try {
            if (BdApi.Native?.openExternal) return BdApi.Native.openExternal(url);
            window.open(url, "_blank", "noopener,noreferrer");
        } catch (_) {
            window.open(url, "_blank", "noopener,noreferrer");
        }
    }

    getSettingsPanel() {
        const root = document.createElement("div");
        root.className = "ca-root";
        this.settingsRoots.add(root);
        this.renderSettings(root);
        return root;
    }

    refreshSettingsPanels() {
        for (const root of [...this.settingsRoots]) {
            if (!root?.isConnected) {
                this.settingsRoots.delete(root);
                continue;
            }
            this.renderSettings(root);
        }
    }

    renderSettings(root) {
        let selectedId = root.dataset.selectedProfileId;
        if (!this.getProfile(selectedId)) {
            selectedId = this.settings.activeProfileId && this.getProfile(this.settings.activeProfileId)
                ? this.settings.activeProfileId
                : this.settings.profiles[0]?.id || "";
        }

        if (!root.dataset.tab) root.dataset.tab = "general";
        root.dataset.selectedProfileId = selectedId || "";
        root.replaceChildren();

        const shell = document.createElement("div");
        shell.className = "ca-studio";

        const sidebar = this.renderSidebar(root, selectedId);
        const workspace = document.createElement("main");
        workspace.className = "ca-workspace";

        if (!this.settings.profiles.length) {
            this.renderEmptyState(workspace, root);
        } else {
            const profile = this.getProfile(selectedId) || this.settings.profiles[0];
            if (profile) this.renderProfileEditor(workspace, profile, root);
        }

        shell.append(sidebar, workspace);
        root.appendChild(shell);
    }

    renderSidebar(root, selectedId) {
        const sidebar = document.createElement("aside");
        sidebar.className = "ca-sidebar";

        const brand = document.createElement("div");
        brand.className = "ca-brand";
        brand.innerHTML = `
            <div class="ca-brand-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.75 5.5A4.75 4.75 0 0 0 2 10.25v3.5A4.75 4.75 0 0 0 6.75 18.5c1.76 0 3.3-.96 4.12-2.38h2.26a4.74 4.74 0 0 0 4.12 2.38A4.75 4.75 0 0 0 22 13.75v-3.5a4.75 4.75 0 0 0-4.75-4.75c-1.5 0-2.84.7-3.7 1.8h-3.1a4.72 4.72 0 0 0-3.7-1.8ZM6 10h1.5v1.25h1.25v1.5H7.5V14H6v-1.25H4.75v-1.5H6V10Zm10.75.75a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z"/></svg>
            </div>
            <div class="ca-brand-copy">
                <strong>Custom Activities</strong>
                <span>Activity Studio · v${this.version}</span>
            </div>
        `;
        sidebar.appendChild(brand);

        const activeProfile = this.getProfile(this.currentProfileId);
        const status = document.createElement("div");
        status.className = `ca-status-card${activeProfile ? " active" : ""}`;
        status.innerHTML = `
            <span class="ca-status-indicator"></span>
            <div>
                <strong>${activeProfile ? this.escapeHtml(activeProfile.profileName || "Active activity") : "Nothing active"}</strong>
                <span>${activeProfile ? "Rich Presence is running" : "Select a profile to begin"}</span>
            </div>
        `;
        if (activeProfile) status.appendChild(this.iconButton("Stop activity", "stop", () => this.stopActivity(true), true));
        sidebar.appendChild(status);

        sidebar.appendChild(this.button("+  New activity", "primary wide", () => {
            const profile = this.createProfile();
            this.settings.profiles.push(profile);
            root.dataset.selectedProfileId = profile.id;
            root.dataset.tab = "general";
            this.saveSettings();
            this.renderSettings(root);
        }));

        const profilesHeader = document.createElement("div");
        profilesHeader.className = "ca-side-heading";
        profilesHeader.innerHTML = `<span>Profiles</span><small>${this.settings.profiles.length}</small>`;
        sidebar.appendChild(profilesHeader);

        const profiles = document.createElement("div");
        profiles.className = "ca-profile-list";

        if (!this.settings.profiles.length) {
            const empty = document.createElement("div");
            empty.className = "ca-profile-list-empty";
            empty.textContent = "No saved activities yet.";
            profiles.appendChild(empty);
        } else {
            for (const profile of this.settings.profiles) {
                const item = document.createElement("button");
                item.type = "button";
                item.className = `ca-profile${profile.id === selectedId ? " selected" : ""}${profile.id === this.currentProfileId ? " active" : ""}`;
                const letter = (profile.profileName || profile.activityName || "A").trim().charAt(0).toUpperCase() || "A";
                item.innerHTML = `
                    <span class="ca-profile-avatar">${this.escapeHtml(letter)}</span>
                    <span class="ca-profile-copy">
                        <strong>${this.escapeHtml(profile.profileName || "Unnamed Activity")}</strong>
                        <small>${this.activityTypeLabel(profile.type)}${profile.id === this.settings.activeProfileId ? " · Startup" : ""}</small>
                    </span>
                    ${profile.id === this.currentProfileId ? '<span class="ca-live-dot" title="Active"></span>' : ''}
                `;
                item.addEventListener("click", () => {
                    root.dataset.selectedProfileId = profile.id;
                    this.renderSettings(root);
                });
                profiles.appendChild(item);
            }
        }
        sidebar.appendChild(profiles);

        const settings = document.createElement("div");
        settings.className = "ca-side-settings";
        settings.append(
            this.compactSwitch("Auto-start", this.settings.autoStart, value => {
                this.settings.autoStart = value;
                this.saveSettings();
            }),
            this.compactSwitch("Protect presence", this.settings.protectActivity, value => {
                this.settings.protectActivity = value;
                this.saveSettings();
                if (this.currentProfileId) {
                    if (value) this.installProtection();
                    else this.removeProtection();
                }
            })
        );
        sidebar.appendChild(settings);

        const portal = this.button("Developer Portal", "ghost wide", () => this.openExternal("https://discord.com/developers/applications"));
        sidebar.appendChild(portal);

        return sidebar;
    }

    renderEmptyState(workspace, root) {
        const empty = document.createElement("div");
        empty.className = "ca-empty-state";
        empty.innerHTML = `
            <div class="ca-empty-orbit"><span></span></div>
            <h2>Create your first activity</h2>
            <p>Save multiple Rich Presence profiles, preview them here and switch between them without running a separate RPC application.</p>
        `;
        empty.appendChild(this.button("Create activity", "primary", () => {
            const profile = this.createProfile();
            this.settings.profiles.push(profile);
            root.dataset.selectedProfileId = profile.id;
            root.dataset.tab = "general";
            this.saveSettings();
            this.renderSettings(root);
        }));
        workspace.appendChild(empty);
    }

    renderProfileEditor(workspace, profile, root) {
        const top = document.createElement("header");
        top.className = "ca-workspace-header";

        const heading = document.createElement("div");
        heading.className = "ca-workspace-title";
        heading.innerHTML = `
            <div class="ca-eyebrow">ACTIVITY PROFILE</div>
            <div class="ca-workspace-title-row">
                <h2>${this.escapeHtml(profile.profileName || "Unnamed Activity")}</h2>
                ${profile.id === this.currentProfileId ? '<span class="ca-active-pill"><span></span>Active</span>' : ''}
            </div>
            <p>Changes are saved automatically.</p>
        `;

        const actions = document.createElement("div");
        actions.className = "ca-header-actions";
        actions.append(
            this.iconButton("Duplicate profile", "copy", () => {
                const copy = JSON.parse(JSON.stringify(profile));
                copy.id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
                copy.profileName = `${profile.profileName || "Activity"} Copy`;
                this.settings.profiles.push(copy);
                root.dataset.selectedProfileId = copy.id;
                this.saveSettings();
                this.renderSettings(root);
            }),
            this.iconButton("Delete profile", "trash", async () => {
                if (profile.id === this.currentProfileId) await this.stopActivity(false);
                this.settings.profiles = this.settings.profiles.filter(item => item.id !== profile.id);
                if (this.settings.activeProfileId === profile.id) this.settings.activeProfileId = this.settings.profiles[0]?.id || null;
                this.saveSettings();
                root.dataset.selectedProfileId = this.settings.profiles[0]?.id || "";
                root.dataset.tab = "general";
                this.renderSettings(root);
            }, true)
        );

        top.append(heading, actions);
        workspace.appendChild(top);

        const overview = document.createElement("div");
        overview.className = "ca-overview";

        const previewWrap = document.createElement("section");
        previewWrap.className = "ca-preview-panel";
        previewWrap.innerHTML = `<div class="ca-panel-heading"><div><strong>Live preview</strong><span>Approximate Discord appearance</span></div></div>`;
        const preview = document.createElement("div");
        preview.className = "ca-preview-host";
        preview.dataset.previewFor = profile.id;
        previewWrap.appendChild(preview);

        const summary = document.createElement("section");
        summary.className = "ca-summary-panel";
        summary.innerHTML = `
            <div class="ca-panel-heading"><div><strong>Profile overview</strong><span>Quick configuration summary</span></div></div>
            <div class="ca-summary-grid">
                <div><span>Type</span><strong>${this.activityTypeLabel(profile.type)}</strong></div>
                <div><span>Application ID</span><strong>${profile.clientId ? this.escapeHtml(this.maskId(profile.clientId)) : "Not set"}</strong></div>
                <div><span>Timer</span><strong>${profile.enableTimer ? "Enabled" : "Disabled"}</strong></div>
                <div><span>Buttons</span><strong>${[profile.button1Label, profile.button2Label].filter(Boolean).length}/2 configured</strong></div>
            </div>
        `;

        overview.append(previewWrap, summary);
        workspace.appendChild(overview);
        this.updatePreview(root, profile);

        const tabs = document.createElement("nav");
        tabs.className = "ca-tabs";
        const currentTab = root.dataset.tab || "general";
        for (const [id, label] of [["general", "General"], ["images", "Images"], ["buttons", "Buttons"]]) {
            const tab = document.createElement("button");
            tab.type = "button";
            tab.className = `ca-tab${currentTab === id ? " active" : ""}`;
            tab.textContent = label;
            tab.addEventListener("click", () => {
                root.dataset.tab = id;
                this.renderSettings(root);
            });
            tabs.appendChild(tab);
        }
        workspace.appendChild(tabs);

        const form = document.createElement("section");
        form.className = "ca-form-panel";
        this.renderTabContent(form, profile, root, currentTab);
        workspace.appendChild(form);

        const footer = document.createElement("div");
        footer.className = "ca-actionbar";

        const startup = document.createElement("div");
        startup.className = "ca-startup-state";
        if (this.settings.activeProfileId === profile.id) {
            startup.innerHTML = `<span class="ca-checkmark">✓</span><div><strong>Startup profile</strong><span>This activity is selected for auto-start.</span></div>`;
        } else {
            startup.innerHTML = `<div><strong>Startup profile</strong><span>Use this activity when auto-start is enabled.</span></div>`;
        }

        const footerActions = document.createElement("div");
        footerActions.className = "ca-actionbar-buttons";
        if (this.settings.activeProfileId !== profile.id) {
            footerActions.appendChild(this.button("Set as startup", "ghost", () => {
                this.settings.activeProfileId = profile.id;
                this.saveSettings();
                this.toast(`"${profile.profileName}" selected as the startup profile.`, "success");
                this.renderSettings(root);
            }));
        }
        if (profile.id === this.currentProfileId) {
            footerActions.append(
                this.button("Stop", "danger", () => this.stopActivity(true)),
                this.button("Reapply activity", "primary", () => this.activateProfile(profile.id))
            );
        } else {
            footerActions.appendChild(this.button("Activate activity", "primary", () => this.activateProfile(profile.id)));
        }

        footer.append(startup, footerActions);
        workspace.appendChild(footer);
    }

    renderTabContent(container, profile, root, tab) {
        if (tab === "images") {
            container.innerHTML = `
                <div class="ca-form-heading">
                    <div><h3>Rich Presence images</h3><p>Use asset keys uploaded to your Discord application.</p></div>
                    <span class="ca-section-badge">ASSETS</span>
                </div>
            `;
            const grid = this.grid();
            grid.append(
                this.input("Large image key", profile.largeImageKey, value => this.setProfileValue(profile, "largeImageKey", value, root), "Primary Rich Presence image asset key."),
                this.input("Large image hover text", profile.largeImageText, value => this.setProfileValue(profile, "largeImageText", value, root)),
                this.input("Small image key", profile.smallImageKey, value => this.setProfileValue(profile, "smallImageKey", value, root), "Optional secondary image asset key."),
                this.input("Small image hover text", profile.smallImageText, value => this.setProfileValue(profile, "smallImageText", value, root))
            );
            container.appendChild(grid);
            return;
        }

        if (tab === "buttons") {
            container.innerHTML = `
                <div class="ca-form-heading">
                    <div><h3>Activity buttons</h3><p>Add up to two external links to the Rich Presence.</p></div>
                    <span class="ca-section-badge">OPTIONAL</span>
                </div>
            `;
            const grid = this.grid();
            grid.append(
                this.input("Button 1 label", profile.button1Label, value => this.setProfileValue(profile, "button1Label", value, root), "Maximum 32 characters."),
                this.input("Button 1 URL", profile.button1Url, value => this.setProfileValue(profile, "button1Url", value, root)),
                this.input("Button 2 label", profile.button2Label, value => this.setProfileValue(profile, "button2Label", value, root), "Maximum 32 characters."),
                this.input("Button 2 URL", profile.button2Url, value => this.setProfileValue(profile, "button2Url", value, root))
            );
            container.appendChild(grid);
            return;
        }

        container.innerHTML = `
            <div class="ca-form-heading">
                <div><h3>General activity</h3><p>Configure the application, activity type and text displayed by Discord.</p></div>
                <span class="ca-section-badge">REQUIRED</span>
            </div>
        `;
        const grid = this.grid();
        grid.append(
            this.input("Profile name", profile.profileName, value => this.setProfileValue(profile, "profileName", value, root, true), "Only visible inside this plugin."),
            this.input("Application ID / Client ID", profile.clientId, value => this.setProfileValue(profile, "clientId", value, root), "Copy it from the Discord Developer Portal."),
            this.input("Activity name", profile.activityName, value => this.setProfileValue(profile, "activityName", value, root), "Discord may prefer the application name."),
            this.select("Activity type", profile.type, [
                [0, "Playing"],
                [1, "Streaming"],
                [2, "Listening"],
                [3, "Watching"],
                [5, "Competing"]
            ], value => {
                profile.type = Number(value);
                this.saveSettings();
                this.renderSettings(root);
            }),
            this.input("Details", profile.details, value => this.setProfileValue(profile, "details", value, root), "Main Rich Presence detail line."),
            this.input("State", profile.state, value => this.setProfileValue(profile, "state", value, root), "Secondary Rich Presence state line.")
        );

        if (Number(profile.type) === 1) {
            grid.appendChild(this.input("Streaming URL", profile.streamUrl, value => this.setProfileValue(profile, "streamUrl", value, root), "Used only for the Streaming type."));
        }

        grid.appendChild(this.inlineSwitch("Show elapsed time", "Display the activity timer while this profile is active.", profile.enableTimer, value => {
            profile.enableTimer = value;
            this.saveSettings();
            this.updatePreview(root, profile);
        }));
        container.appendChild(grid);
    }

    setProfileValue(profile, key, value, root) {
        profile[key] = value;
        this.saveSettings();
        this.updatePreview(root, profile);
    }

    updatePreview(root, profile) {
        const host = root.querySelector(`.ca-preview-host[data-preview-for="${CSS.escape(profile.id)}"]`);
        if (!host) return;

        const applicationName = profile.activityName?.trim() || profile.profileName?.trim() || "Custom Activity";
        const type = this.activityTypeLabel(profile.type);
        const details = profile.details?.trim() || "No details set";
        const state = profile.state?.trim() || "No state set";
        const letter = applicationName.charAt(0).toUpperCase() || "A";
        const buttons = [profile.button1Label, profile.button2Label].filter(Boolean).slice(0, 2);

        host.innerHTML = `
            <div class="ca-discord-preview">
                <div class="ca-preview-label">${this.escapeHtml(type.toUpperCase())} ${this.escapeHtml(applicationName.toUpperCase())}</div>
                <div class="ca-preview-content">
                    <div class="ca-preview-image">
                        <span>${this.escapeHtml(letter)}</span>
                        ${profile.smallImageKey ? '<i></i>' : ''}
                    </div>
                    <div class="ca-preview-copy">
                        <strong>${this.escapeHtml(applicationName)}</strong>
                        <span>${this.escapeHtml(details)}</span>
                        <span>${this.escapeHtml(state)}</span>
                        ${profile.enableTimer ? '<small>00:00 elapsed</small>' : ''}
                    </div>
                </div>
                ${buttons.length ? `<div class="ca-preview-buttons">${buttons.map(label => `<span>${this.escapeHtml(label)}</span>`).join("")}</div>` : ''}
            </div>
        `;
    }

    maskId(value) {
        const id = String(value || "").trim();
        if (id.length <= 8) return id;
        return `${id.slice(0, 4)}…${id.slice(-4)}`;
    }

    grid() {
        const grid = document.createElement("div");
        grid.className = "ca-field-grid";
        return grid;
    }

    input(label, value, onChange, description = "") {
        const field = document.createElement("label");
        field.className = "ca-field";

        const title = document.createElement("span");
        title.className = "ca-label";
        title.textContent = label;

        const input = document.createElement("input");
        input.className = "ca-input";
        input.type = "text";
        input.value = value ?? "";
        input.addEventListener("input", () => onChange(input.value));

        field.append(title, input);
        if (description) {
            const desc = document.createElement("span");
            desc.className = "ca-description";
            desc.textContent = description;
            field.appendChild(desc);
        }
        return field;
    }

    select(label, value, options, onChange) {
        const field = document.createElement("label");
        field.className = "ca-field";

        const title = document.createElement("span");
        title.className = "ca-label";
        title.textContent = label;

        const select = document.createElement("select");
        select.className = "ca-input ca-select";
        for (const [optionValue, optionLabel] of options) {
            const option = document.createElement("option");
            option.value = String(optionValue);
            option.textContent = optionLabel;
            option.selected = String(optionValue) === String(value);
            select.appendChild(option);
        }
        select.addEventListener("change", () => onChange(select.value));

        field.append(title, select);
        return field;
    }

    compactSwitch(titleText, checked, onChange) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "ca-compact-switch";
        row.setAttribute("role", "switch");
        row.setAttribute("aria-checked", String(Boolean(checked)));
        row.innerHTML = `<span>${this.escapeHtml(titleText)}</span><span class="ca-toggle${checked ? " on" : ""}"><i></i></span>`;
        row.addEventListener("click", () => {
            checked = !checked;
            row.setAttribute("aria-checked", String(checked));
            row.querySelector(".ca-toggle")?.classList.toggle("on", checked);
            onChange(checked);
        });
        return row;
    }

    inlineSwitch(titleText, descriptionText, checked, onChange) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "ca-inline-switch";
        row.setAttribute("role", "switch");
        row.setAttribute("aria-checked", String(Boolean(checked)));
        row.innerHTML = `
            <span class="ca-inline-switch-copy"><strong>${this.escapeHtml(titleText)}</strong><small>${this.escapeHtml(descriptionText)}</small></span>
            <span class="ca-toggle${checked ? " on" : ""}"><i></i></span>
        `;
        row.addEventListener("click", () => {
            checked = !checked;
            row.setAttribute("aria-checked", String(checked));
            row.querySelector(".ca-toggle")?.classList.toggle("on", checked);
            onChange(checked);
        });
        return row;
    }

    button(label, style, onClick) {
        const button = document.createElement("button");
        button.type = "button";
        const styles = String(style || "").split(/\s+/).filter(Boolean).map(item => `ca-${item}`).join(" ");
        button.className = `ca-button ${styles}`;
        button.textContent = label;
        button.addEventListener("click", onClick);
        return button;
    }

    iconButton(label, icon, onClick, danger = false) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `ca-icon-button${danger ? " danger" : ""}`;
        button.setAttribute("aria-label", label);
        button.setAttribute("title", label);
        const paths = {
            copy: '<path d="M8 3h9a2 2 0 0 1 2 2v9h-2V5H8V3Zm-3 4h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Zm0 2v10h9V9H5Z"/>',
            trash: '<path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 6h12l-1 12H7L6 9Zm3 2v7h2v-7H9Zm4 0v7h2v-7h-2Z"/>',
            stop: '<path d="M7 7h10v10H7V7Z"/>'
        };
        button.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${paths[icon] || ""}</svg>`;
        button.addEventListener("click", onClick);
        return button;
    }

    activityTypeLabel(type) {
        return ({0: "Playing", 1: "Streaming", 2: "Listening", 3: "Watching", 5: "Competing"})[Number(type)] || "Playing";
    }

    escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    startQuickButtonObserver() {
        this.ensureQuickButton();
        const mount = document.getElementById("app-mount") || document.body;
        if (!mount || typeof MutationObserver === "undefined") return;

        this.quickObserver = new MutationObserver(() => {
            if (this.quickButton?.isConnected || this.quickObserverFrame !== null) return;
            this.quickObserverFrame = requestAnimationFrame(() => {
                this.quickObserverFrame = null;
                this.ensureQuickButton();
            });
        });
        this.quickObserver.observe(mount, {childList: true, subtree: true});
    }

    stopQuickButtonObserver() {
        this.quickObserver?.disconnect();
        this.quickObserver = null;
        if (this.quickObserverFrame !== null) {
            cancelAnimationFrame(this.quickObserverFrame);
            this.quickObserverFrame = null;
        }
    }

    findSettingsButton() {
        const panels = [...document.querySelectorAll('[class*="panels_"]')].filter(element => element.getBoundingClientRect().height > 0);
        const panel = panels.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0];
        if (!panel) return null;

        const labels = /settings|impostazioni|paramètres|einstellungen|ajustes|configurações|instellingen|ustawienia|nastavení|ayarlar|設定|설정/i;
        const buttons = [...panel.querySelectorAll("button")];
        const byLabel = buttons.find(button => labels.test(`${button.getAttribute("aria-label") || ""} ${button.getAttribute("title") || ""}`));
        if (byLabel) return byLabel;

        const groups = [...panel.querySelectorAll('div[class*="buttons_"]')]
            .map(element => ({element, buttons: [...element.querySelectorAll(":scope > button")]}))
            .filter(item => item.buttons.length >= 2 && item.buttons.length <= 8)
            .sort((a, b) => b.element.getBoundingClientRect().bottom - a.element.getBoundingClientRect().bottom);

        return groups[0]?.buttons.at(-1) || null;
    }

    ensureQuickButton() {
        if (this.quickButton?.isConnected) {
            this.syncQuickButton();
            return;
        }

        const settingsButton = this.findSettingsButton();
        if (!settingsButton?.parentElement) return;
        if (settingsButton.parentElement.querySelector(".ca-quick-button")) return;

        const button = document.createElement("button");
        button.type = "button";
        button.className = `${settingsButton.className || ""} ca-quick-button`.trim();
        button.setAttribute("aria-label", "Custom Activities");
        button.setAttribute("title", "Custom Activities");
        button.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6.75 5.5A4.75 4.75 0 0 0 2 10.25v3.5A4.75 4.75 0 0 0 6.75 18.5c1.76 0 3.3-.96 4.12-2.38h2.26a4.74 4.74 0 0 0 4.12 2.38A4.75 4.75 0 0 0 22 13.75v-3.5a4.75 4.75 0 0 0-4.75-4.75c-1.5 0-2.84.7-3.7 1.8h-3.1a4.72 4.72 0 0 0-3.7-1.8ZM6 10h1.5v1.25h1.25v1.5H7.5V14H6v-1.25H4.75v-1.5H6V10Zm10.75.75a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z"/></svg>';
        button.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            this.openManager();
        });

        settingsButton.parentElement.insertBefore(button, settingsButton);
        this.quickButton = button;
        this.syncQuickButton();
    }

    syncQuickButton() {
        if (!this.quickButton) return;
        const activeProfile = this.getProfile(this.currentProfileId);
        this.quickButton.classList.toggle("ca-active", Boolean(activeProfile));
        this.quickButton.setAttribute("aria-label", activeProfile ? `Custom Activities - ${activeProfile.profileName} active` : "Custom Activities");
    }

    removeQuickButton() {
        this.quickButton?.remove();
        this.quickButton = null;
    }

    openManager() {
        if (this.managerOverlay?.isConnected) return;

        const overlay = document.createElement("div");
        overlay.className = "ca-manager-overlay";
        overlay.innerHTML = `
            <div class="ca-manager-dialog" role="dialog" aria-modal="true" aria-label="Custom Activities">
                <button class="ca-manager-close" type="button" aria-label="Close" title="Close">×</button>
                <div class="ca-manager-content"></div>
            </div>
        `;

        const content = overlay.querySelector(".ca-manager-content");
        content.appendChild(this.getSettingsPanel());

        overlay.querySelector(".ca-manager-close").addEventListener("click", () => this.closeManager());
        overlay.addEventListener("mousedown", event => {
            if (event.target === overlay) this.closeManager();
        });

        this.managerKeyHandler = event => {
            if (event.key === "Escape") this.closeManager();
        };
        document.addEventListener("keydown", this.managerKeyHandler);

        document.body.appendChild(overlay);
        this.managerOverlay = overlay;
        requestAnimationFrame(() => overlay.classList.add("visible"));
    }

    closeManager() {
        if (!this.managerOverlay) return;
        const overlay = this.managerOverlay;
        this.managerOverlay = null;
        if (this.managerKeyHandler) document.removeEventListener("keydown", this.managerKeyHandler);
        this.managerKeyHandler = null;
        overlay.classList.remove("visible");
        setTimeout(() => overlay.remove(), 140);
    }

    addStyle() {
        const css = `
            .ca-root,
            .ca-root * { box-sizing: border-box; }

            .ca-root {
                --ca-radius: 14px;
                --ca-border: color-mix(in srgb, var(--background-modifier-accent) 82%, transparent);
                --ca-surface: color-mix(in srgb, var(--background-secondary) 96%, transparent);
                --ca-raised: color-mix(in srgb, var(--background-tertiary) 90%, var(--background-secondary));
                --ca-text-xs: clamp(10px, .72vw, 11px);
                --ca-text-sm: clamp(11px, .82vw, 12px);
                --ca-text-md: clamp(12px, .92vw, 14px);
                --ca-text-lg: clamp(14px, 1.08vw, 16px);
                --ca-title: clamp(22px, 1.7vw, 28px);
                width: 100%;
                min-width: 0;
                color: var(--text-normal);
                font-family: var(--font-primary, sans-serif);
                font-size: var(--ca-text-md);
            }

            .ca-studio {
                display: grid;
                grid-template-columns: clamp(230px, 22vw, 280px) minmax(0, 1fr);
                width: 100%;
                min-width: 0;
                min-height: 660px;
                overflow: hidden;
                border: 1px solid var(--ca-border);
                border-radius: 18px;
                background: var(--background-primary);
                box-shadow: 0 12px 34px rgba(0,0,0,.16);
            }

            .ca-sidebar {
                display: flex;
                flex-direction: column;
                min-width: 0;
                min-height: 0;
                padding: 18px;
                border-right: 1px solid var(--ca-border);
                background: color-mix(in srgb, var(--background-secondary) 97%, transparent);
            }

            .ca-brand {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 2px 2px 17px;
            }

            .ca-brand-icon {
                display: grid;
                place-items: center;
                width: 42px;
                height: 42px;
                flex: 0 0 auto;
                border-radius: 12px;
                background: var(--brand-500, #5865f2);
                color: white;
                box-shadow: 0 7px 20px color-mix(in srgb, var(--brand-500, #5865f2) 30%, transparent);
            }

            .ca-brand-icon svg { width: 24px; height: 24px; }
            .ca-brand-copy { display: flex; flex-direction: column; min-width: 0; }
            .ca-brand-copy strong { color: var(--header-primary); font-size: var(--ca-text-lg); line-height: 1.2; }
            .ca-brand-copy span { margin-top: 3px; color: var(--text-muted); font-size: var(--ca-text-xs); }

            .ca-status-card {
                display: grid;
                grid-template-columns: auto minmax(0,1fr) auto;
                align-items: center;
                gap: 10px;
                min-height: 58px;
                margin-bottom: 12px;
                padding: 10px 11px;
                border: 1px solid var(--ca-border);
                border-radius: 12px;
                background: var(--background-primary);
            }

            .ca-status-indicator {
                width: 9px;
                height: 9px;
                border-radius: 50%;
                background: var(--text-muted);
            }

            .ca-status-card.active .ca-status-indicator {
                background: var(--status-positive, #23a55a);
                box-shadow: 0 0 0 4px color-mix(in srgb, var(--status-positive, #23a55a) 17%, transparent);
            }

            .ca-status-card > div { display: flex; flex-direction: column; min-width: 0; }
            .ca-status-card strong { overflow: hidden; color: var(--header-primary); font-size: var(--ca-text-sm); text-overflow: ellipsis; white-space: nowrap; }
            .ca-status-card span:not(.ca-status-indicator) { margin-top: 3px; color: var(--text-muted); font-size: var(--ca-text-xs); }

            .ca-side-heading {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 18px 5px 9px;
                color: var(--text-muted);
                font-size: var(--ca-text-xs);
                font-weight: 800;
                letter-spacing: .07em;
                text-transform: uppercase;
            }

            .ca-side-heading small {
                display: grid;
                place-items: center;
                min-width: 22px;
                height: 22px;
                padding: 0 6px;
                border-radius: 999px;
                background: var(--background-modifier-selected);
                color: var(--text-muted);
                font-size: var(--ca-text-xs);
            }

            .ca-profile-list {
                display: flex;
                flex: 1;
                flex-direction: column;
                gap: 5px;
                min-height: 90px;
                overflow: auto;
                margin: 0 -5px;
                padding: 0 5px;
            }

            .ca-profile-list-empty {
                padding: 10px 6px;
                color: var(--text-muted);
                font-size: var(--ca-text-sm);
                line-height: 1.45;
            }

            .ca-profile {
                display: flex;
                align-items: center;
                gap: 10px;
                width: 100%;
                min-height: 50px;
                padding: 8px;
                border: 0;
                border-radius: 10px;
                background: transparent;
                color: inherit;
                text-align: left;
                cursor: pointer;
                transition: background .12s ease, transform .12s ease;
            }

            .ca-profile:hover { background: var(--background-modifier-hover); }
            .ca-profile.selected { background: var(--background-modifier-selected); }
            .ca-profile:active { transform: scale(.99); }

            .ca-profile-avatar {
                display: grid;
                place-items: center;
                width: 34px;
                height: 34px;
                flex: 0 0 auto;
                border-radius: 10px;
                background: var(--background-primary);
                color: var(--header-primary);
                font-size: var(--ca-text-md);
                font-weight: 800;
            }

            .ca-profile.selected .ca-profile-avatar {
                background: var(--brand-500, #5865f2);
                color: white;
            }

            .ca-profile-copy { display: flex; flex: 1; flex-direction: column; min-width: 0; }
            .ca-profile-copy strong { overflow: hidden; color: var(--header-primary); font-size: var(--ca-text-sm); text-overflow: ellipsis; white-space: nowrap; }
            .ca-profile-copy small { overflow: hidden; margin-top: 3px; color: var(--text-muted); font-size: var(--ca-text-xs); text-overflow: ellipsis; white-space: nowrap; }
            .ca-live-dot { width: 8px; height: 8px; flex: 0 0 auto; border-radius: 50%; background: var(--status-positive, #23a55a); }

            .ca-side-settings {
                display: flex;
                flex-direction: column;
                gap: 3px;
                margin: 15px 0 11px;
                padding: 9px 7px;
                border-top: 1px solid var(--ca-border);
                border-bottom: 1px solid var(--ca-border);
            }

            .ca-compact-switch {
                display: flex;
                align-items: center;
                justify-content: space-between;
                width: 100%;
                min-height: 38px;
                padding: 5px 2px;
                border: 0;
                background: transparent;
                color: var(--text-normal);
                font: inherit;
                font-size: var(--ca-text-sm);
                text-align: left;
                cursor: pointer;
            }

            .ca-toggle {
                width: 36px;
                height: 21px;
                padding: 3px;
                flex: 0 0 auto;
                border-radius: 999px;
                background: var(--background-modifier-selected);
                transition: background .12s ease;
            }

            .ca-toggle i {
                display: block;
                width: 15px;
                height: 15px;
                border-radius: 50%;
                background: white;
                transition: transform .12s ease;
            }

            .ca-toggle.on { background: var(--brand-500, #5865f2); }
            .ca-toggle.on i { transform: translateX(15px); }

            .ca-workspace {
                display: flex;
                flex-direction: column;
                gap: 15px;
                min-width: 0;
                min-height: 0;
                overflow: auto;
                padding: clamp(20px, 2.2vw, 30px);
                background: var(--background-primary);
            }

            .ca-workspace-header {
                display: flex;
                align-items: flex-start;
                justify-content: space-between;
                gap: 16px;
            }

            .ca-eyebrow { color: var(--text-muted); font-size: var(--ca-text-xs); font-weight: 800; letter-spacing: .09em; }
            .ca-workspace-title-row { display: flex; align-items: center; gap: 10px; margin-top: 3px; }
            .ca-workspace-title h2 { margin: 0; color: var(--header-primary); font-size: var(--ca-title); line-height: 1.18; }
            .ca-workspace-title p { margin: 5px 0 0; color: var(--text-muted); font-size: var(--ca-text-sm); }
            .ca-header-actions, .ca-actionbar-buttons { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

            .ca-active-pill {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                padding: 4px 8px;
                border-radius: 999px;
                background: color-mix(in srgb, var(--status-positive, #23a55a) 14%, transparent);
                color: var(--status-positive, #23a55a);
                font-size: var(--ca-text-xs);
                font-weight: 800;
                text-transform: uppercase;
            }

            .ca-active-pill span { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }

            .ca-overview {
                display: grid;
                grid-template-columns: minmax(0, 1.35fr) minmax(280px, .65fr);
                gap: 12px;
            }

            .ca-preview-panel,
            .ca-summary-panel,
            .ca-form-panel,
            .ca-actionbar {
                border: 1px solid var(--ca-border);
                border-radius: var(--ca-radius);
                background: var(--ca-surface);
            }

            .ca-preview-panel, .ca-summary-panel { overflow: hidden; }

            .ca-panel-heading {
                display: flex;
                align-items: center;
                justify-content: space-between;
                min-height: 54px;
                padding: 11px 14px;
                border-bottom: 1px solid var(--ca-border);
            }

            .ca-panel-heading > div { display: flex; flex-direction: column; }
            .ca-panel-heading strong { color: var(--header-primary); font-size: var(--ca-text-md); }
            .ca-panel-heading span { margin-top: 3px; color: var(--text-muted); font-size: var(--ca-text-xs); }

            .ca-preview-host { padding: 14px; }
            .ca-discord-preview { padding: 14px; border-radius: 11px; background: var(--background-primary); }
            .ca-preview-label { margin-bottom: 10px; color: var(--header-secondary); font-size: var(--ca-text-xs); font-weight: 800; letter-spacing: .04em; }
            .ca-preview-content { display: flex; gap: 12px; min-width: 0; }

            .ca-preview-image {
                position: relative;
                display: grid;
                place-items: center;
                width: clamp(68px, 6.3vw, 82px);
                height: clamp(68px, 6.3vw, 82px);
                flex: 0 0 auto;
                overflow: visible;
                border-radius: 12px;
                background: linear-gradient(145deg, var(--brand-500, #5865f2), color-mix(in srgb, var(--brand-500, #5865f2) 62%, black));
                color: white;
                font-size: clamp(24px, 2vw, 30px);
                font-weight: 800;
            }

            .ca-preview-image i {
                position: absolute;
                right: -5px;
                bottom: -5px;
                width: 24px;
                height: 24px;
                border: 4px solid var(--background-primary);
                border-radius: 50%;
                background: var(--status-positive, #23a55a);
            }

            .ca-preview-copy { display: flex; flex-direction: column; min-width: 0; padding-top: 2px; }
            .ca-preview-copy strong, .ca-preview-copy span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .ca-preview-copy strong { color: var(--header-primary); font-size: var(--ca-text-md); }
            .ca-preview-copy span { margin-top: 4px; color: var(--text-normal); font-size: var(--ca-text-sm); }
            .ca-preview-copy small { margin-top: 4px; color: var(--text-muted); font-size: var(--ca-text-xs); }

            .ca-preview-buttons { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 7px; margin-top: 12px; }
            .ca-preview-buttons span { overflow: hidden; padding: 7px 10px; border-radius: 6px; background: var(--background-modifier-selected); color: var(--text-normal); font-size: var(--ca-text-xs); font-weight: 700; text-align: center; text-overflow: ellipsis; white-space: nowrap; }

            .ca-summary-grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 1px; background: var(--ca-border); }
            .ca-summary-grid > div { display: flex; flex-direction: column; min-width: 0; min-height: 62px; padding: 12px; background: var(--ca-surface); }
            .ca-summary-grid span { color: var(--text-muted); font-size: var(--ca-text-xs); }
            .ca-summary-grid strong { overflow: hidden; margin-top: 5px; color: var(--header-primary); font-size: var(--ca-text-sm); text-overflow: ellipsis; white-space: nowrap; }

            .ca-tabs {
                display: flex;
                align-items: center;
                gap: 3px;
                width: fit-content;
                padding: 4px;
                border-radius: 10px;
                background: var(--background-secondary);
            }

            .ca-tab {
                min-width: 92px;
                min-height: 36px;
                padding: 7px 13px;
                border: 0;
                border-radius: 8px;
                background: transparent;
                color: var(--text-muted);
                font: inherit;
                font-size: var(--ca-text-sm);
                font-weight: 700;
                cursor: pointer;
            }

            .ca-tab:hover { color: var(--text-normal); }
            .ca-tab.active { background: var(--background-modifier-selected); color: var(--header-primary); box-shadow: 0 1px 4px rgba(0,0,0,.14); }

            .ca-form-panel { overflow: hidden; }
            .ca-form-heading { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 15px 16px 13px; border-bottom: 1px solid var(--ca-border); }
            .ca-form-heading h3 { margin: 0; color: var(--header-primary); font-size: var(--ca-text-lg); }
            .ca-form-heading p { margin: 4px 0 0; color: var(--text-muted); font-size: var(--ca-text-sm); }

            .ca-section-badge {
                padding: 4px 7px;
                border-radius: 6px;
                background: var(--background-modifier-selected);
                color: var(--text-muted);
                font-size: var(--ca-text-xs);
                font-weight: 800;
                letter-spacing: .06em;
            }

            .ca-field-grid {
                display: grid;
                grid-template-columns: repeat(2, minmax(0,1fr));
                gap: 15px;
                padding: 16px;
            }

            .ca-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
            .ca-label { color: var(--header-secondary); font-size: var(--ca-text-sm); font-weight: 700; }

            .ca-input {
                width: 100%;
                min-height: 42px;
                padding: 9px 11px;
                border: 1px solid transparent;
                border-radius: 8px;
                outline: none;
                background: var(--background-primary);
                color: var(--text-normal);
                font: inherit;
                font-size: var(--ca-text-md);
                transition: border-color .12s ease, box-shadow .12s ease;
            }

            .ca-input:hover { border-color: var(--ca-border); }
            .ca-input:focus { border-color: var(--brand-500, #5865f2); box-shadow: 0 0 0 2px color-mix(in srgb, var(--brand-500, #5865f2) 15%, transparent); }
            .ca-select { cursor: pointer; }
            .ca-description { color: var(--text-muted); font-size: var(--ca-text-xs); line-height: 1.4; }

            .ca-inline-switch {
                grid-column: 1 / -1;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 16px;
                min-height: 58px;
                padding: 10px 12px;
                border: 1px solid var(--ca-border);
                border-radius: 10px;
                background: var(--background-primary);
                color: var(--text-normal);
                font: inherit;
                text-align: left;
                cursor: pointer;
            }

            .ca-inline-switch-copy { display: flex; flex-direction: column; min-width: 0; }
            .ca-inline-switch-copy strong { color: var(--header-primary); font-size: var(--ca-text-sm); }
            .ca-inline-switch-copy small { margin-top: 3px; color: var(--text-muted); font-size: var(--ca-text-xs); }

            .ca-actionbar {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 14px;
                margin-top: auto;
                padding: 12px 14px;
                position: sticky;
                bottom: 0;
                z-index: 3;
                box-shadow: 0 -8px 22px color-mix(in srgb, var(--background-primary) 78%, transparent);
            }

            .ca-startup-state { display: flex; align-items: center; gap: 10px; min-width: 0; }
            .ca-startup-state > div { display: flex; flex-direction: column; min-width: 0; }
            .ca-startup-state strong { color: var(--header-primary); font-size: var(--ca-text-sm); }
            .ca-startup-state span:not(.ca-checkmark) { margin-top: 3px; color: var(--text-muted); font-size: var(--ca-text-xs); }
            .ca-checkmark { display: grid; place-items: center; width: 28px; height: 28px; flex: 0 0 auto; border-radius: 50%; background: color-mix(in srgb, var(--status-positive, #23a55a) 15%, transparent); color: var(--status-positive, #23a55a); font-size: var(--ca-text-md); font-weight: 900; }

            .ca-button {
                min-height: 38px;
                padding: 8px 13px;
                border: 0;
                border-radius: 8px;
                font: inherit;
                font-size: var(--ca-text-sm);
                font-weight: 700;
                cursor: pointer;
                transition: filter .12s ease, background .12s ease, transform .12s ease;
            }

            .ca-button:active { transform: translateY(1px); }
            .ca-wide { width: 100%; }
            .ca-primary { background: var(--brand-500, #5865f2); color: white; }
            .ca-primary:hover { filter: brightness(1.08); }
            .ca-ghost { background: var(--background-modifier-selected); color: var(--header-primary); }
            .ca-ghost:hover { background: var(--background-modifier-hover); }
            .ca-danger { background: color-mix(in srgb, var(--status-danger, #da373c) 16%, transparent); color: var(--text-danger, #f23f42); }
            .ca-danger:hover { background: color-mix(in srgb, var(--status-danger, #da373c) 23%, transparent); }

            .ca-icon-button {
                display: grid;
                place-items: center;
                width: 38px;
                height: 38px;
                flex: 0 0 auto;
                padding: 0;
                border: 0;
                border-radius: 8px;
                background: var(--background-modifier-selected);
                color: var(--interactive-normal);
                cursor: pointer;
            }

            .ca-icon-button:hover { background: var(--background-modifier-hover); color: var(--interactive-hover); }
            .ca-icon-button.danger:hover { color: var(--text-danger, #f23f42); }
            .ca-icon-button svg { width: 19px; height: 19px; }
            .ca-status-card .ca-icon-button { width: 30px; height: 30px; }
            .ca-status-card .ca-icon-button svg { width: 15px; height: 15px; }

            .ca-empty-state {
                display: grid;
                place-items: center;
                align-content: center;
                flex: 1;
                min-height: 520px;
                padding: 44px;
                text-align: center;
            }

            .ca-empty-orbit {
                position: relative;
                display: grid;
                place-items: center;
                width: 82px;
                height: 82px;
                margin-bottom: 19px;
                border: 1px solid var(--ca-border);
                border-radius: 50%;
            }

            .ca-empty-orbit::before,
            .ca-empty-orbit::after { content: ""; position: absolute; border: 1px solid var(--ca-border); border-radius: 50%; }
            .ca-empty-orbit::before { inset: 12px; }
            .ca-empty-orbit::after { inset: 25px; background: var(--brand-500, #5865f2); border-color: transparent; }
            .ca-empty-orbit span { width: 10px; height: 10px; border-radius: 50%; background: var(--status-positive, #23a55a); transform: translate(35px, -15px); }
            .ca-empty-state h2 { margin: 0; color: var(--header-primary); font-size: var(--ca-title); }
            .ca-empty-state p { max-width: 520px; margin: 9px 0 18px; color: var(--text-muted); font-size: var(--ca-text-md); line-height: 1.5; }

            .ca-quick-button { position: relative !important; }
            .ca-quick-button svg { width: 20px; height: 20px; }
            .ca-quick-button.ca-active::after { content: ""; position: absolute; right: 3px; bottom: 3px; width: 7px; height: 7px; border: 2px solid var(--background-secondary-alt, var(--background-secondary)); border-radius: 50%; background: var(--status-positive, #23a55a); }

            .ca-manager-overlay {
                position: fixed;
                inset: 0;
                z-index: 10000;
                display: grid;
                place-items: center;
                padding: 16px;
                background: rgba(0,0,0,.62);
                backdrop-filter: blur(5px);
                opacity: 0;
                transition: opacity .14s ease;
            }

            .ca-manager-overlay.visible { opacity: 1; }

            .ca-manager-dialog {
                position: relative;
                width: min(1320px, calc(100vw - 32px));
                height: min(900px, calc(100vh - 32px));
                min-height: min(620px, calc(100vh - 32px));
                overflow: hidden;
                border: 1px solid var(--ca-border, var(--background-modifier-accent));
                border-radius: 20px;
                background: var(--background-primary);
                box-shadow: 0 30px 96px rgba(0,0,0,.52);
            }

            .ca-manager-content { width: 100%; height: 100%; min-height: 0; }
            .ca-manager-content .ca-root { height: 100%; }
            .ca-manager-content .ca-studio { height: 100%; min-height: 0; border: 0; border-radius: 20px; box-shadow: none; }

            .ca-manager-close {
                position: absolute;
                top: 12px;
                right: 12px;
                z-index: 30;
                display: grid;
                place-items: center;
                width: 36px;
                height: 36px;
                border: 0;
                border-radius: 9px;
                background: var(--background-modifier-selected);
                color: var(--interactive-normal);
                font-size: 23px;
                line-height: 1;
                cursor: pointer;
            }

            .ca-manager-close:hover { background: var(--background-modifier-hover); color: var(--interactive-hover); }

            @media (max-width: 1080px) {
                .ca-studio { grid-template-columns: 220px minmax(0,1fr); }
                .ca-overview { grid-template-columns: 1fr; }
                .ca-summary-grid { grid-template-columns: repeat(4,minmax(0,1fr)); }
            }

            @media (max-width: 840px) {
                .ca-studio { display: flex; flex-direction: column; overflow: auto; }
                .ca-sidebar { flex: 0 0 auto; border-right: 0; border-bottom: 1px solid var(--ca-border); }
                .ca-profile-list { flex-direction: row; flex: 0 0 auto; min-height: 0; max-height: none; overflow-x: auto; overflow-y: hidden; padding-bottom: 3px; }
                .ca-profile { min-width: 190px; width: auto; }
                .ca-side-settings { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); margin: 12px 0 10px; }
                .ca-workspace { overflow: visible; padding: 18px; }
                .ca-workspace-header { padding-right: 42px; }
                .ca-summary-grid { grid-template-columns: repeat(2,minmax(0,1fr)); }
            }

            @media (max-width: 620px) {
                .ca-manager-overlay { padding: 8px; }
                .ca-manager-dialog { width: calc(100vw - 16px); height: calc(100vh - 16px); min-height: 0; border-radius: 14px; }
                .ca-manager-content .ca-studio { border-radius: 14px; }
                .ca-sidebar { padding: 14px; }
                .ca-brand-copy span { display: none; }
                .ca-workspace { padding: 14px; }
                .ca-workspace-header, .ca-actionbar { align-items: stretch; flex-direction: column; }
                .ca-field-grid { grid-template-columns: 1fr; padding: 14px; }
                .ca-inline-switch { grid-column: auto; }
                .ca-tabs { width: 100%; }
                .ca-tab { flex: 1; min-width: 0; }
                .ca-preview-buttons { grid-template-columns: 1fr; }
            }

            @media (max-height: 760px) and (min-width: 841px) {
                .ca-sidebar { padding-top: 14px; padding-bottom: 14px; }
                .ca-brand { padding-bottom: 12px; }
                .ca-side-heading { padding-top: 12px; }
                .ca-profile-list { min-height: 70px; }
                .ca-workspace { gap: 11px; padding-top: 16px; padding-bottom: 16px; }
                .ca-preview-image { width: 64px; height: 64px; }
                .ca-panel-heading { min-height: 48px; }
                .ca-field-grid { gap: 11px 14px; padding-top: 12px; padding-bottom: 12px; }
                .ca-actionbar { padding-top: 9px; padding-bottom: 9px; }
            }
        `;

        if (BdApi.DOM?.addStyle) BdApi.DOM.addStyle(this.pluginName, css);
        else BdApi.injectCSS?.(this.pluginName, css);
    }

    removeStyle() {
        if (BdApi.DOM?.removeStyle) BdApi.DOM.removeStyle(this.pluginName);
        else BdApi.clearCSS?.(this.pluginName);
    }
};