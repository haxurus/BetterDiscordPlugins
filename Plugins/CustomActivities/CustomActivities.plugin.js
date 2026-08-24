/**
 * @name CustomActivities
 * @author Haxurus
 * @version 1.3.0
 * @description Create, save and switch fully customized Discord Rich Presence activities directly from BetterDiscord.
 * @source https://github.com/haxurus/BetterDiscordPlugins/tree/master/Plugins/CustomActivities
 */

module.exports = class CustomActivities {
    constructor() {
        this.pluginName = "CustomActivities";
        this.version = "1.3.0";
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

        root.dataset.selectedProfileId = selectedId || "";
        root.replaceChildren();

        const top = document.createElement("div");
        top.className = "ca-topbar";

        const identity = document.createElement("div");
        identity.className = "ca-identity";
        identity.innerHTML = `
            <div class="ca-logo" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.75 5.5A4.75 4.75 0 0 0 2 10.25v3.5A4.75 4.75 0 0 0 6.75 18.5c1.76 0 3.3-.96 4.12-2.38h2.26a4.74 4.74 0 0 0 4.12 2.38A4.75 4.75 0 0 0 22 13.75v-3.5a4.75 4.75 0 0 0-4.75-4.75c-1.5 0-2.84.7-3.7 1.8h-3.1a4.72 4.72 0 0 0-3.7-1.8Zm-.75 4.5h1.5v1.25h1.25v1.5H7.5V14H6v-1.25H4.75v-1.5H6V10Zm10.75.75a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z"/></svg>
            </div>
            <div>
                <div class="ca-title-row"><h2>Custom Activities</h2><span class="ca-version">v${this.version}</span></div>
                <p>Create and switch custom Discord Rich Presence profiles.</p>
            </div>
        `;

        const topActions = document.createElement("div");
        topActions.className = "ca-top-actions";
        topActions.append(
            this.button("Developer Portal", "ghost", () => this.openExternal("https://discord.com/developers/applications")),
            this.button("New Activity", "primary", () => {
                const profile = this.createProfile();
                this.settings.profiles.push(profile);
                root.dataset.selectedProfileId = profile.id;
                this.saveSettings();
                this.renderSettings(root);
            })
        );

        top.append(identity, topActions);
        root.appendChild(top);

        const statusStrip = document.createElement("div");
        statusStrip.className = "ca-status-strip";
        const activeProfile = this.getProfile(this.currentProfileId);
        statusStrip.innerHTML = `
            <div class="ca-status-main">
                <span class="ca-status-dot ${activeProfile ? "online" : ""}"></span>
                <div><strong>${activeProfile ? this.escapeHtml(activeProfile.profileName) : "No custom activity active"}</strong><span>${activeProfile ? "Custom Rich Presence is running" : "Choose a profile and activate it when ready"}</span></div>
            </div>
        `;

        const statusActions = document.createElement("div");
        statusActions.className = "ca-status-actions";
        if (activeProfile) statusActions.append(this.button("Stop", "danger-subtle", () => this.stopActivity(true)));
        statusStrip.appendChild(statusActions);
        root.appendChild(statusStrip);

        const controls = document.createElement("div");
        controls.className = "ca-control-grid";
        controls.append(
            this.switchCard("Auto-start", "Start the last selected activity when the plugin loads.", this.settings.autoStart, value => {
                this.settings.autoStart = value;
                this.saveSettings();
            }),
            this.switchCard("Protect presence", "Keep games and other RPC apps from replacing the custom activity.", this.settings.protectActivity, value => {
                this.settings.protectActivity = value;
                this.saveSettings();
                if (this.currentProfileId) {
                    if (value) this.installProtection();
                    else this.removeProtection();
                }
            })
        );
        root.appendChild(controls);

        const body = document.createElement("div");
        body.className = "ca-body";

        const sidebar = document.createElement("aside");
        sidebar.className = "ca-sidebar";
        const sidebarTitle = document.createElement("div");
        sidebarTitle.className = "ca-sidebar-title";
        sidebarTitle.textContent = "Profiles";
        sidebar.appendChild(sidebarTitle);

        const editor = document.createElement("main");
        editor.className = "ca-editor";

        if (!this.settings.profiles.length) {
            const emptySide = document.createElement("div");
            emptySide.className = "ca-sidebar-empty";
            emptySide.textContent = "No profiles";
            sidebar.appendChild(emptySide);

            const empty = document.createElement("div");
            empty.className = "ca-empty-state";
            empty.innerHTML = `<div class="ca-empty-icon">+</div><h3>Create your first activity</h3><p>Profiles let you save multiple Rich Presence configurations and switch between them instantly.</p>`;
            empty.appendChild(this.button("Create Activity", "primary", () => {
                const profile = this.createProfile();
                this.settings.profiles.push(profile);
                root.dataset.selectedProfileId = profile.id;
                this.saveSettings();
                this.renderSettings(root);
            }));
            editor.appendChild(empty);
        } else {
            for (const profile of this.settings.profiles) {
                const item = document.createElement("button");
                item.type = "button";
                item.className = `ca-profile${profile.id === selectedId ? " selected" : ""}`;
                item.innerHTML = `
                    <span class="ca-profile-icon">${this.escapeHtml((profile.profileName || "A").trim().charAt(0).toUpperCase() || "A")}</span>
                    <span class="ca-profile-copy"><strong>${this.escapeHtml(profile.profileName || "Unnamed Activity")}</strong><small>${this.activityTypeLabel(profile.type)}</small></span>
                    ${profile.id === this.currentProfileId ? '<span class="ca-live-dot" title="Active"></span>' : ''}
                `;
                item.addEventListener("click", () => {
                    root.dataset.selectedProfileId = profile.id;
                    this.renderSettings(root);
                });
                sidebar.appendChild(item);
            }

            const profile = this.getProfile(selectedId) || this.settings.profiles[0];
            if (profile) this.renderProfileEditor(editor, profile, root);
        }

        body.append(sidebar, editor);
        root.appendChild(body);
    }

    renderProfileEditor(editor, profile, root) {
        const header = document.createElement("div");
        header.className = "ca-editor-header";

        const heading = document.createElement("div");
        heading.className = "ca-editor-heading";
        heading.innerHTML = `<div class="ca-editor-eyebrow">EDITING PROFILE</div><h3>${this.escapeHtml(profile.profileName || "Unnamed Activity")}</h3><p>${profile.id === this.currentProfileId ? "This profile is currently active." : "Changes are saved automatically."}</p>`;

        const actions = document.createElement("div");
        actions.className = "ca-editor-actions";
        actions.append(
            this.iconButton("Duplicate", "copy", () => {
                const copy = JSON.parse(JSON.stringify(profile));
                copy.id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
                copy.profileName = `${profile.profileName || "Activity"} Copy`;
                this.settings.profiles.push(copy);
                root.dataset.selectedProfileId = copy.id;
                this.saveSettings();
                this.renderSettings(root);
            }),
            this.iconButton("Delete", "trash", async () => {
                if (profile.id === this.currentProfileId) await this.stopActivity(false);
                this.settings.profiles = this.settings.profiles.filter(item => item.id !== profile.id);
                if (this.settings.activeProfileId === profile.id) this.settings.activeProfileId = this.settings.profiles[0]?.id || null;
                this.saveSettings();
                root.dataset.selectedProfileId = this.settings.profiles[0]?.id || "";
                this.renderSettings(root);
            }, true),
            this.button(profile.id === this.currentProfileId ? "Reapply" : "Activate", "primary", () => this.activateProfile(profile.id))
        );

        header.append(heading, actions);
        editor.appendChild(header);

        const general = this.card("General", "Core activity information.");
        const generalGrid = this.grid();
        generalGrid.append(
            this.input("Profile name", profile.profileName, value => {
                profile.profileName = value;
                this.saveSettings();
            }, "Only visible inside this plugin."),
            this.input("Application ID", profile.clientId, value => {
                profile.clientId = value;
                this.saveSettings();
            }, "Discord Developer Portal Application ID."),
            this.input("Activity name", profile.activityName, value => {
                profile.activityName = value;
                this.saveSettings();
            }, "Discord may prefer the application name."),
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
            })
        );
        general.appendChild(generalGrid);
        editor.appendChild(general);

        const presence = this.card("Presence", "Text displayed on your Discord profile.");
        const presenceGrid = this.grid();
        presenceGrid.append(
            this.input("Details", profile.details, value => {
                profile.details = value;
                this.saveSettings();
            }),
            this.input("State", profile.state, value => {
                profile.state = value;
                this.saveSettings();
            })
        );
        if (Number(profile.type) === 1) {
            presenceGrid.appendChild(this.input("Streaming URL", profile.streamUrl, value => {
                profile.streamUrl = value;
                this.saveSettings();
            }, "Required only for Streaming."));
        }
        presenceGrid.appendChild(this.inlineSwitch("Show elapsed time", profile.enableTimer, value => {
            profile.enableTimer = value;
            this.saveSettings();
        }));
        presence.appendChild(presenceGrid);
        editor.appendChild(presence);

        const assets = this.card("Images", "Rich Presence assets configured in your Discord application.");
        const assetsGrid = this.grid();
        assetsGrid.append(
            this.input("Large image key", profile.largeImageKey, value => {
                profile.largeImageKey = value;
                this.saveSettings();
            }),
            this.input("Large image hover text", profile.largeImageText, value => {
                profile.largeImageText = value;
                this.saveSettings();
            }),
            this.input("Small image key", profile.smallImageKey, value => {
                profile.smallImageKey = value;
                this.saveSettings();
            }),
            this.input("Small image hover text", profile.smallImageText, value => {
                profile.smallImageText = value;
                this.saveSettings();
            })
        );
        assets.appendChild(assetsGrid);
        editor.appendChild(assets);

        const buttons = this.card("Buttons", "Optional links displayed on the activity.");
        const buttonGrid = this.grid();
        buttonGrid.append(
            this.input("Button 1 label", profile.button1Label, value => {
                profile.button1Label = value;
                this.saveSettings();
            }, "Maximum 32 characters."),
            this.input("Button 1 URL", profile.button1Url, value => {
                profile.button1Url = value;
                this.saveSettings();
            }),
            this.input("Button 2 label", profile.button2Label, value => {
                profile.button2Label = value;
                this.saveSettings();
            }, "Maximum 32 characters."),
            this.input("Button 2 URL", profile.button2Url, value => {
                profile.button2Url = value;
                this.saveSettings();
            })
        );
        buttons.appendChild(buttonGrid);
        editor.appendChild(buttons);
    }

    card(titleText, descriptionText) {
        const section = document.createElement("section");
        section.className = "ca-card";
        const header = document.createElement("div");
        header.className = "ca-card-header";
        header.innerHTML = `<h4>${this.escapeHtml(titleText)}</h4><p>${this.escapeHtml(descriptionText || "")}</p>`;
        section.appendChild(header);
        return section;
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

    switchCard(titleText, descriptionText, checked, onChange) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "ca-switch-card";
        row.setAttribute("role", "switch");
        row.setAttribute("aria-checked", String(Boolean(checked)));
        row.innerHTML = `<span class="ca-switch-copy"><strong>${this.escapeHtml(titleText)}</strong><small>${this.escapeHtml(descriptionText)}</small></span><span class="ca-toggle${checked ? " on" : ""}"><span></span></span>`;
        row.addEventListener("click", () => {
            checked = !checked;
            row.setAttribute("aria-checked", String(checked));
            row.querySelector(".ca-toggle")?.classList.toggle("on", checked);
            onChange(checked);
        });
        return row;
    }

    inlineSwitch(titleText, checked, onChange) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "ca-inline-switch";
        row.setAttribute("role", "switch");
        row.setAttribute("aria-checked", String(Boolean(checked)));
        row.innerHTML = `<span>${this.escapeHtml(titleText)}</span><span class="ca-toggle${checked ? " on" : ""}"><span></span></span>`;
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
        button.className = `ca-button ca-${style}`;
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
            trash: '<path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 6h12l-1 12H7L6 9Zm3 2v7h2v-7H9Zm4 0v7h2v-7h-2Z"/>'
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
                <div class="ca-manager-shell">
                    <button class="ca-manager-close" type="button" aria-label="Close" title="Close">×</button>
                    <div class="ca-manager-content"></div>
                </div>
            </div>
        `;

        const content = overlay.querySelector(".ca-manager-content");
        const panel = this.getSettingsPanel();
        content.appendChild(panel);

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
        setTimeout(() => overlay.remove(), 120);
    }

    addStyle() {
        const css = `
            .ca-root, .ca-root * { box-sizing: border-box; }
            .ca-root { color: var(--text-normal); width: 100%; padding: 0 4px 26px; font-family: var(--font-primary, sans-serif); }

            .ca-topbar { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:12px; }
            .ca-identity { display:flex; align-items:center; gap:11px; min-width:0; }
            .ca-logo { width:38px; height:38px; border-radius:12px; display:grid; place-items:center; flex:0 0 auto; background:var(--brand-500, #5865f2); color:white; }
            .ca-logo svg { width:23px; height:23px; }
            .ca-title-row { display:flex; align-items:center; gap:8px; }
            .ca-title-row h2 { margin:0; color:var(--header-primary); font-size:19px; line-height:1.2; }
            .ca-version { padding:2px 6px; border-radius:999px; background:var(--background-modifier-selected); color:var(--text-muted); font-size:10px; font-weight:700; }
            .ca-identity p { margin:3px 0 0; color:var(--text-muted); font-size:12px; }
            .ca-top-actions, .ca-status-actions, .ca-editor-actions { display:flex; align-items:center; gap:7px; flex-wrap:wrap; }

            .ca-status-strip { display:flex; align-items:center; justify-content:space-between; gap:12px; min-height:58px; padding:10px 12px; margin-bottom:10px; border:1px solid var(--background-modifier-accent); border-radius:12px; background:var(--background-secondary); }
            .ca-status-main { display:flex; align-items:center; gap:10px; min-width:0; }
            .ca-status-main > div { display:flex; flex-direction:column; min-width:0; }
            .ca-status-main strong { color:var(--header-primary); font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
            .ca-status-main span:not(.ca-status-dot) { color:var(--text-muted); font-size:10px; margin-top:2px; }
            .ca-status-dot { width:9px; height:9px; border-radius:50%; background:var(--text-muted); flex:0 0 auto; }
            .ca-status-dot.online { background:var(--status-positive, #23a55a); box-shadow:0 0 0 3px color-mix(in srgb, var(--status-positive, #23a55a) 18%, transparent); }

            .ca-control-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; margin-bottom:12px; }
            .ca-switch-card { display:flex; align-items:center; justify-content:space-between; gap:14px; width:100%; min-height:60px; padding:11px 12px; border:1px solid var(--background-modifier-accent); border-radius:12px; background:var(--background-secondary); color:inherit; text-align:left; cursor:pointer; }
            .ca-switch-card:hover { background:var(--background-modifier-hover); }
            .ca-switch-copy { display:flex; flex-direction:column; min-width:0; }
            .ca-switch-copy strong { color:var(--header-primary); font-size:12px; }
            .ca-switch-copy small { color:var(--text-muted); font-size:10px; line-height:1.35; margin-top:2px; }
            .ca-toggle { width:36px; height:20px; padding:3px; border-radius:999px; background:var(--background-modifier-selected); flex:0 0 auto; transition:background .12s ease; }
            .ca-toggle > span { display:block; width:14px; height:14px; border-radius:50%; background:white; transition:transform .12s ease; }
            .ca-toggle.on { background:var(--brand-500, #5865f2); }
            .ca-toggle.on > span { transform:translateX(16px); }

            .ca-body { display:grid; grid-template-columns:190px minmax(0,1fr); gap:12px; align-items:start; }
            .ca-sidebar { display:flex; flex-direction:column; gap:5px; padding:9px; border:1px solid var(--background-modifier-accent); border-radius:12px; background:var(--background-secondary); position:sticky; top:0; }
            .ca-sidebar-title { padding:2px 4px 7px; color:var(--text-muted); font-size:10px; font-weight:800; letter-spacing:.06em; text-transform:uppercase; }
            .ca-sidebar-empty { padding:10px 6px; color:var(--text-muted); font-size:11px; }
            .ca-profile { display:flex; align-items:center; gap:8px; width:100%; min-height:42px; padding:6px 7px; border:0; border-radius:8px; background:transparent; color:inherit; text-align:left; cursor:pointer; }
            .ca-profile:hover { background:var(--background-modifier-hover); }
            .ca-profile.selected { background:var(--background-modifier-selected); }
            .ca-profile-icon { display:grid; place-items:center; width:28px; height:28px; flex:0 0 auto; border-radius:8px; background:var(--background-tertiary); color:var(--header-primary); font-size:11px; font-weight:800; }
            .ca-profile.selected .ca-profile-icon { background:var(--brand-500, #5865f2); color:white; }
            .ca-profile-copy { display:flex; flex-direction:column; min-width:0; flex:1; }
            .ca-profile-copy strong { color:var(--header-primary); font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
            .ca-profile-copy small { color:var(--text-muted); font-size:9px; margin-top:1px; }
            .ca-live-dot { width:7px; height:7px; flex:0 0 auto; border-radius:50%; background:var(--status-positive, #23a55a); }

            .ca-editor { display:flex; flex-direction:column; gap:10px; min-width:0; }
            .ca-editor-header { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:2px 1px 3px; }
            .ca-editor-eyebrow { color:var(--text-muted); font-size:9px; font-weight:800; letter-spacing:.08em; }
            .ca-editor-heading h3 { margin:2px 0 0; color:var(--header-primary); font-size:17px; }
            .ca-editor-heading p { margin:3px 0 0; color:var(--text-muted); font-size:10px; }

            .ca-card { overflow:hidden; border:1px solid var(--background-modifier-accent); border-radius:12px; background:var(--background-secondary); }
            .ca-card-header { padding:11px 12px 9px; border-bottom:1px solid var(--background-modifier-accent); }
            .ca-card-header h4 { margin:0; color:var(--header-primary); font-size:12px; }
            .ca-card-header p { margin:2px 0 0; color:var(--text-muted); font-size:10px; }
            .ca-field-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px 11px; padding:12px; }
            .ca-field { display:flex; flex-direction:column; gap:5px; min-width:0; }
            .ca-label { color:var(--header-secondary); font-size:10px; font-weight:700; }
            .ca-input { width:100%; min-height:35px; padding:7px 9px; border:1px solid transparent; border-radius:7px; outline:none; background:var(--input-background, var(--background-tertiary)); color:var(--text-normal); font:inherit; font-size:12px; }
            .ca-input:focus { border-color:var(--brand-500, #5865f2); }
            .ca-select { cursor:pointer; }
            .ca-description { color:var(--text-muted); font-size:9px; line-height:1.35; }
            .ca-inline-switch { grid-column:1 / -1; display:flex; align-items:center; justify-content:space-between; gap:12px; min-height:35px; padding:7px 9px; border:0; border-radius:7px; background:var(--input-background, var(--background-tertiary)); color:var(--text-normal); font:inherit; font-size:11px; text-align:left; cursor:pointer; }

            .ca-button { min-height:32px; padding:6px 10px; border:0; border-radius:7px; font:inherit; font-size:11px; font-weight:700; cursor:pointer; }
            .ca-primary { background:var(--brand-500, #5865f2); color:white; }
            .ca-primary:hover { filter:brightness(1.08); }
            .ca-ghost { background:var(--background-modifier-selected); color:var(--header-primary); }
            .ca-ghost:hover { background:var(--background-modifier-hover); }
            .ca-danger-subtle { background:color-mix(in srgb, var(--status-danger, #da373c) 16%, transparent); color:var(--text-danger, #f23f42); }
            .ca-icon-button { display:grid; place-items:center; width:32px; height:32px; padding:0; border:0; border-radius:7px; background:var(--background-modifier-selected); color:var(--interactive-normal); cursor:pointer; }
            .ca-icon-button:hover { background:var(--background-modifier-hover); color:var(--interactive-hover); }
            .ca-icon-button.danger:hover { color:var(--text-danger, #f23f42); }
            .ca-icon-button svg { width:17px; height:17px; }

            .ca-empty-state { display:grid; place-items:center; min-height:280px; padding:28px; border:1px dashed var(--background-modifier-accent); border-radius:12px; background:var(--background-secondary); text-align:center; }
            .ca-empty-state .ca-empty-icon { display:grid; place-items:center; width:44px; height:44px; border-radius:14px; background:var(--background-tertiary); color:var(--header-primary); font-size:24px; margin-bottom:10px; }
            .ca-empty-state h3 { margin:0; color:var(--header-primary); font-size:15px; }
            .ca-empty-state p { max-width:420px; margin:5px 0 14px; color:var(--text-muted); font-size:11px; line-height:1.45; }

            .ca-quick-button { position:relative !important; }
            .ca-quick-button svg { width:20px; height:20px; }
            .ca-quick-button.ca-active::after { content:""; position:absolute; right:3px; bottom:3px; width:7px; height:7px; border:2px solid var(--background-secondary-alt, var(--background-secondary)); border-radius:50%; background:var(--status-positive, #23a55a); }

            .ca-manager-overlay { position:fixed; inset:0; z-index:10000; display:grid; place-items:center; padding:24px; background:rgba(0,0,0,.58); opacity:0; transition:opacity .12s ease; }
            .ca-manager-overlay.visible { opacity:1; }
            .ca-manager-dialog { width:min(960px, calc(100vw - 48px)); max-height:calc(100vh - 48px); overflow:hidden; border-radius:16px; box-shadow:0 24px 80px rgba(0,0,0,.45); background:var(--background-primary); }
            .ca-manager-shell { position:relative; max-height:calc(100vh - 48px); overflow:auto; padding:20px; }
            .ca-manager-content { width:100%; }
            .ca-manager-close { position:sticky; top:0; float:right; z-index:2; display:grid; place-items:center; width:32px; height:32px; margin:-4px -4px 6px 8px; border:0; border-radius:9px; background:var(--background-modifier-selected); color:var(--interactive-normal); font-size:22px; line-height:1; cursor:pointer; }
            .ca-manager-close:hover { background:var(--background-modifier-hover); color:var(--interactive-hover); }

            @media (max-width:760px) {
                .ca-control-grid, .ca-field-grid { grid-template-columns:1fr; }
                .ca-inline-switch { grid-column:auto; }
                .ca-body { grid-template-columns:1fr; }
                .ca-sidebar { position:static; }
                .ca-topbar, .ca-editor-header { flex-direction:column; align-items:stretch; }
                .ca-top-actions, .ca-editor-actions { justify-content:flex-start; }
                .ca-manager-dialog { width:calc(100vw - 24px); max-height:calc(100vh - 24px); }
                .ca-manager-shell { max-height:calc(100vh - 24px); padding:14px; }
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
