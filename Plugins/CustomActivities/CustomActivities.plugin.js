/**
 * @name CustomActivities
 * @author Haxurus
 * @version 2.2.0
 * @description Create, save and switch fully customized Discord Rich Presence activities directly from BetterDiscord.
 * @source https://github.com/haxurus/BetterDiscordPlugins/tree/master/Plugins/CustomActivities
 */

module.exports = class CustomActivities {
    constructor() {
        this.pluginName = "CustomActivities";
        this.version = "2.2.0";
        this.defaults = {autoStart: false, protectActivity: true, activeProfileId: null, profiles: []};
        this.settings = this.load();
        this.currentProfileId = null;
        this.runtimeStart = null;
        this.setActivityAction = null;
        this.originalSetActivityHandler = null;
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
        setTimeout(() => this.detectDuplicates(), 600);
        if (this.settings.autoStart && this.settings.activeProfileId && this.getProfile(this.settings.activeProfileId)) {
            setTimeout(() => this.activateProfile(this.settings.activeProfileId, true), 1500);
        }
    }

    stop() {
        this.stopQuickButtonObserver();
        this.removeQuickButton();
        this.closeManager();
        this.stopActivity(false);
        this.removeStyle();
        this.settingsRoots.clear();
    }

    load() {
        const saved = BdApi.Data?.load?.(this.pluginName, "settings") ?? BdApi.loadData?.(this.pluginName, "settings") ?? {};
        const settings = Object.assign({}, this.defaults, saved || {});
        settings.profiles = Array.isArray(settings.profiles) ? settings.profiles : [];
        return settings;
    }

    save() {
        if (BdApi.Data?.save) BdApi.Data.save(this.pluginName, "settings", this.settings);
        else BdApi.saveData?.(this.pluginName, "settings", this.settings);
    }

    toast(message, type = "info") {
        if (BdApi.UI?.showToast) BdApi.UI.showToast(message, {type});
        else BdApi.showToast?.(message, {type});
    }

    detectDuplicates() {
        try {
            const fs = require("fs");
            const path = require("path");
            const folder = BdApi.Plugins?.folder;
            if (!folder || !fs.existsSync(folder)) return;
            const matches = fs.readdirSync(folder).filter(name => name.endsWith(".plugin.js")).filter(name => {
                try { return /@name\s+CustomActivities\b/.test(fs.readFileSync(path.join(folder, name), "utf8").slice(0, 5000)); }
                catch (_) { return false; }
            });
            if (matches.length > 1) this.toast(`Multiple CustomActivities files are installed: ${matches.join(", ")}`, "error");
        } catch (_) {}
    }

    getProfile(id) { return this.settings.profiles.find(profile => profile.id === id) || null; }

    newProfile() {
        return {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            profileName: "New Activity", clientId: "", activityName: "", type: 0, streamUrl: "",
            details: "", state: "", enableTimer: true,
            largeImageKey: "", largeImageText: "", smallImageKey: "", smallImageText: "",
            button1Label: "", button1Url: "", button2Label: "", button2Url: ""
        };
    }

    findModule(predicate) {
        try { return BdApi.Webpack?.getModule?.(predicate, {searchExports: true}) || BdApi.findModule?.(predicate) || null; }
        catch (_) { return null; }
    }

    getValidator() { return this.findModule(module => module && typeof module.validateSocketClient === "function"); }
    getAction() { return this.findModule(module => module?.SET_ACTIVITY && typeof module.SET_ACTIVITY.handler === "function")?.SET_ACTIVITY || null; }

    isValidUrl(value) {
        try { const url = new URL(value); return url.protocol === "http:" || url.protocol === "https:"; }
        catch (_) { return false; }
    }

    validateProfile(profile) {
        if (!/^\d{10,25}$/.test(String(profile.clientId || "").trim())) throw new Error("Enter a valid Discord Application ID / Client ID.");
        if (Number(profile.type) === 1 && profile.streamUrl && !this.isValidUrl(profile.streamUrl)) throw new Error("The streaming URL is invalid.");
        for (const [label, url, number] of [[profile.button1Label, profile.button1Url, 1], [profile.button2Label, profile.button2Url, 2]]) {
            if ((label && !url) || (!label && url)) throw new Error(`Button ${number} requires both a label and a URL.`);
            if (label?.length > 32) throw new Error(`Button ${number} label cannot exceed 32 characters.`);
            if (url && !this.isValidUrl(url)) throw new Error(`Button ${number} URL is invalid.`);
        }
    }

    async validateApplication(clientId) {
        const validator = this.getValidator();
        if (!validator) throw new Error("Discord RPC validator module was not found.");
        const socket = {
            application: {id: null, name: null, icon: null},
            authorization: {accessToken: null, authing: false, expires: new Date(0), scopes: []},
            encoding: "json", transport: "ipc", id: "custom-activities", version: 1
        };
        await validator.validateSocketClient.call(validator, socket, null, clientId);
        if (!socket.application?.id) throw new Error("Discord did not return application information for this Client ID.");
        return socket;
    }

    buildEvent(profile, socket) {
        const app = socket.application || {};
        const activity = {
            name: profile.activityName?.trim() || app.name || profile.profileName || "Custom Activity",
            type: Number(profile.type) || 0,
            application_id: profile.clientId.trim(), timestamps: {}, assets: {}, buttons: []
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
        if (profile.button1Label?.trim() && profile.button1Url?.trim()) activity.buttons.push({label: profile.button1Label.trim(), url: profile.button1Url.trim()});
        if (profile.button2Label?.trim() && profile.button2Url?.trim()) activity.buttons.push({label: profile.button2Label.trim(), url: profile.button2Url.trim()});
        return {
            isSocketConnected: () => true,
            socket: {transport: "ipc", id: socket.id || "custom-activities", version: 1, encoding: "json", application: {id: profile.clientId.trim(), name: app.name || activity.name, icon: app.icon ?? null, flags: app.flags ?? 0}},
            cmd: "SET_ACTIVITY", args: {pid: require("process").pid, activity}
        };
    }

    async activateProfile(id, silent = false) {
        const profile = this.getProfile(id);
        if (!profile) return;
        try {
            this.validateProfile(profile);
            if (this.currentProfileId && this.currentProfileId !== id) await this.stopActivity(false);
            const socket = await this.validateApplication(profile.clientId.trim());
            const action = this.getAction();
            if (!action) throw new Error("Discord SET_ACTIVITY handler was not found.");
            if (!this.originalSetActivityHandler || this.setActivityAction !== action) {
                this.setActivityAction = action;
                this.originalSetActivityHandler = action.handler;
            }
            this.runtimeStart = Date.now();
            if (this.settings.protectActivity) action.handler = () => {};
            await this.originalSetActivityHandler.call(action, this.buildEvent(profile, socket));
            this.currentProfileId = id;
            this.settings.activeProfileId = id;
            this.save();
            this.syncQuickButton();
            this.refresh();
            if (!silent) this.toast(`Activity "${profile.profileName}" is now active.`, "success");
        } catch (error) {
            this.restoreHandler();
            this.toast(error?.message || "Failed to activate the custom activity.", "error");
        }
    }

    async stopActivity(showToast = true) {
        try {
            const action = this.setActivityAction || this.getAction();
            const original = this.originalSetActivityHandler || action?.handler;
            if (action && typeof original === "function") {
                await original.call(action, {isSocketConnected: () => true, socket: {transport: "ipc", id: "custom-activities", version: 1, encoding: "json"}, cmd: "SET_ACTIVITY", args: {pid: require("process").pid}});
            }
        } catch (_) {}
        this.restoreHandler();
        this.currentProfileId = null;
        this.runtimeStart = null;
        this.syncQuickButton();
        this.refresh();
        if (showToast) this.toast("Custom activity stopped.", "info");
    }

    restoreHandler() {
        if (this.setActivityAction && this.originalSetActivityHandler) this.setActivityAction.handler = this.originalSetActivityHandler;
        this.setActivityAction = null;
        this.originalSetActivityHandler = null;
    }

    openExternal(url) {
        if (BdApi.Native?.openExternal) BdApi.Native.openExternal(url);
        else window.open(url, "_blank", "noopener,noreferrer");
    }

    getSettingsPanel(context = "settings") {
        const root = document.createElement("div");
        root.className = `hca-root hca-${context}`;
        root.dataset.tab = "activity";
        this.settingsRoots.add(root);
        this.render(root);
        return root;
    }

    refresh() {
        for (const root of [...this.settingsRoots]) {
            if (!root?.isConnected) { this.settingsRoots.delete(root); continue; }
            this.render(root);
        }
    }

    el(tag, className, text) {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = text;
        return element;
    }

    button(label, style, callback) {
        const button = this.el("button", `hca-button ${style}`, label);
        button.type = "button";
        button.addEventListener("click", callback);
        return button;
    }

    render(root) {
        let selectedId = root.dataset.selectedProfileId;
        if (!this.getProfile(selectedId)) selectedId = this.settings.activeProfileId && this.getProfile(this.settings.activeProfileId) ? this.settings.activeProfileId : this.settings.profiles[0]?.id || "";
        root.dataset.selectedProfileId = selectedId;
        root.replaceChildren();

        const shell = this.el("div", "hca-shell");
        const header = this.el("header", "hca-header");
        const brand = this.el("div", "hca-brand");
        brand.innerHTML = `<span class="hca-logo">●</span><div><div class="hca-title">Custom Activities <small>v${this.version} CLEAN</small></div><p>Create and switch Discord Rich Presence profiles.</p></div>`;
        const headerActions = this.el("div", "hca-actions");
        headerActions.append(this.button("Developer Portal", "secondary", () => this.openExternal("https://discord.com/developers/applications")), this.button("New Profile", "primary", () => {
            const profile = this.newProfile(); this.settings.profiles.push(profile); root.dataset.selectedProfileId = profile.id; root.dataset.tab = "activity"; this.save(); this.render(root);
        }));
        header.append(brand, headerActions);
        shell.appendChild(header);

        const active = this.getProfile(this.currentProfileId);
        const status = this.el("div", "hca-status");
        status.innerHTML = `<span class="hca-dot ${active ? "on" : ""}"></span><div><strong>${this.escape(active?.profileName || "No custom activity active")}</strong><p>${active ? "Rich Presence is currently running." : "Select a profile and activate it when ready."}</p></div>`;
        if (active) status.appendChild(this.button("Stop", "danger", () => this.stopActivity(true)));
        shell.appendChild(status);

        const switches = this.el("div", "hca-switches");
        switches.append(this.switchCard("Auto-start", "Start the selected profile when Discord loads.", this.settings.autoStart, value => { this.settings.autoStart = value; this.save(); }), this.switchCard("Protect presence", "Prevent other Discord RPC apps from replacing this activity.", this.settings.protectActivity, value => {
            this.settings.protectActivity = value; this.save();
            if (this.currentProfileId) { const id = this.currentProfileId; this.stopActivity(false).then(() => this.activateProfile(id, true)); }
        }));
        shell.appendChild(switches);

        const layout = this.el("div", "hca-layout");
        const sidebar = this.el("aside", "hca-sidebar");
        sidebar.appendChild(this.el("div", "hca-side-title", `PROFILES  ${this.settings.profiles.length}`));
        const list = this.el("div", "hca-list");
        sidebar.appendChild(list);
        const editor = this.el("main", "hca-editor");

        if (!this.settings.profiles.length) {
            editor.innerHTML = `<div class="hca-empty"><h3>Create your first activity</h3><p>Create a profile to configure and save a custom Discord Rich Presence activity.</p></div>`;
        } else {
            for (const profile of this.settings.profiles) {
                const item = this.el("button", `hca-profile ${profile.id === selectedId ? "selected" : ""}`);
                item.type = "button";
                item.innerHTML = `<span class="hca-avatar">${this.escape((profile.profileName || "A").charAt(0).toUpperCase())}</span><span><strong>${this.escape(profile.profileName || "Unnamed Activity")}</strong><small>${this.typeLabel(profile.type)}${profile.id === this.settings.activeProfileId ? " · Startup" : ""}</small></span>`;
                item.addEventListener("click", () => { root.dataset.selectedProfileId = profile.id; this.render(root); });
                list.appendChild(item);
            }
            const profile = this.getProfile(selectedId) || this.settings.profiles[0];
            this.renderEditor(editor, profile, root);
        }
        layout.append(sidebar, editor);
        shell.appendChild(layout);
        root.appendChild(shell);
    }

    renderEditor(editor, profile, root) {
        const top = this.el("div", "hca-editor-top");
        const title = this.el("div");
        title.innerHTML = `<small>ACTIVITY PROFILE</small><h2>${this.escape(profile.profileName || "Unnamed Activity")}</h2><p>Changes are saved automatically.</p>`;
        const actions = this.el("div", "hca-actions");
        actions.append(this.button("Duplicate", "secondary", () => {
            const copy = {...profile, id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, profileName: `${profile.profileName || "Activity"} Copy`};
            this.settings.profiles.push(copy); root.dataset.selectedProfileId = copy.id; this.save(); this.render(root);
        }), this.button("Delete", "danger", async () => {
            if (profile.id === this.currentProfileId) await this.stopActivity(false);
            this.settings.profiles = this.settings.profiles.filter(item => item.id !== profile.id);
            if (this.settings.activeProfileId === profile.id) this.settings.activeProfileId = this.settings.profiles[0]?.id || null;
            root.dataset.selectedProfileId = this.settings.profiles[0]?.id || ""; this.save(); this.render(root);
        }));
        top.append(title, actions);
        editor.appendChild(top);

        const preview = this.el("div", "hca-preview");
        preview.innerHTML = `<span class="hca-preview-icon">${this.escape((profile.activityName || profile.profileName || "A").charAt(0).toUpperCase())}</span><div><small>${this.typeLabel(profile.type).toUpperCase()}</small><strong>${this.escape(profile.activityName || profile.profileName || "Custom Activity")}</strong><p>${this.escape(profile.details || "No details configured")}</p><p>${this.escape(profile.state || "No state configured")}${profile.enableTimer ? " · Timer enabled" : ""}</p></div>`;
        editor.appendChild(preview);

        const tabs = this.el("nav", "hca-tabs");
        const panes = this.el("div", "hca-panes");
        const paneMap = new Map();
        const tabMap = new Map();
        const activeTab = ["activity", "images", "buttons"].includes(root.dataset.tab) ? root.dataset.tab : "activity";

        const activity = this.pane("activity", "Activity Details", "Configure the application and text displayed by Discord.");
        activity.grid.append(
            this.field("Profile name", profile.profileName, value => { profile.profileName = value; this.save(); }),
            this.field("Discord Application ID / Client ID", profile.clientId, value => { profile.clientId = value; this.save(); }),
            this.field("Activity name", profile.activityName, value => { profile.activityName = value; this.save(); }),
            this.selectField("Activity type", profile.type, [[0,"Playing"],[1,"Streaming"],[2,"Listening"],[3,"Watching"],[5,"Competing"]], value => { profile.type = Number(value); this.save(); this.render(root); }),
            this.field("Details", profile.details, value => { profile.details = value; this.save(); }),
            this.field("State", profile.state, value => { profile.state = value; this.save(); })
        );
        if (Number(profile.type) === 1) activity.grid.appendChild(this.field("Streaming URL", profile.streamUrl, value => { profile.streamUrl = value; this.save(); }));
        activity.grid.appendChild(this.switchCard("Show elapsed time", "Display an elapsed timer while active.", profile.enableTimer, value => { profile.enableTimer = value; this.save(); }, "inline"));

        const images = this.pane("images", "Rich Presence Images", "Use asset keys uploaded to your Discord application.");
        images.grid.append(
            this.field("Large image asset key", profile.largeImageKey, value => { profile.largeImageKey = value; this.save(); }),
            this.field("Large image hover text", profile.largeImageText, value => { profile.largeImageText = value; this.save(); }),
            this.field("Small image asset key", profile.smallImageKey, value => { profile.smallImageKey = value; this.save(); }),
            this.field("Small image hover text", profile.smallImageText, value => { profile.smallImageText = value; this.save(); })
        );

        const buttons = this.pane("buttons", "Activity Buttons", "Add up to two optional external links.");
        buttons.grid.append(
            this.field("Button 1 label", profile.button1Label, value => { profile.button1Label = value; this.save(); }),
            this.field("Button 1 URL", profile.button1Url, value => { profile.button1Url = value; this.save(); }),
            this.field("Button 2 label", profile.button2Label, value => { profile.button2Label = value; this.save(); }),
            this.field("Button 2 URL", profile.button2Url, value => { profile.button2Url = value; this.save(); })
        );

        for (const pane of [activity, images, buttons]) { paneMap.set(pane.id, pane.panel); panes.appendChild(pane.panel); }
        const show = id => {
            root.dataset.tab = id;
            for (const [paneId, pane] of paneMap) pane.hidden = paneId !== id;
            for (const [tabId, tab] of tabMap) tab.classList.toggle("active", tabId === id);
        };
        for (const [id, label] of [["activity","Activity"],["images","Images"],["buttons","Buttons"]]) {
            const tab = this.button(label, "tab", () => show(id));
            tabMap.set(id, tab); tabs.appendChild(tab);
        }
        editor.append(tabs, panes); show(activeTab);

        const footer = this.el("div", "hca-footer");
        footer.innerHTML = `<div><strong>${profile.id === this.settings.activeProfileId ? "Startup profile selected" : "Startup profile"}</strong><p>${profile.id === this.settings.activeProfileId ? "This profile will be used by auto-start." : "Select this profile for auto-start."}</p></div>`;
        const footerActions = this.el("div", "hca-actions");
        if (profile.id !== this.settings.activeProfileId) footerActions.appendChild(this.button("Set as Startup", "secondary", () => { this.settings.activeProfileId = profile.id; this.save(); this.render(root); }));
        footerActions.appendChild(this.button(profile.id === this.currentProfileId ? "Reapply Activity" : "Activate Activity", "primary", () => this.activateProfile(profile.id)));
        footer.appendChild(footerActions);
        editor.appendChild(footer);
    }

    pane(id, title, description) {
        const panel = this.el("section", "hca-pane");
        panel.dataset.pane = id;
        panel.innerHTML = `<header><h3>${this.escape(title)}</h3><p>${this.escape(description)}</p></header>`;
        const grid = this.el("div", "hca-fields");
        panel.appendChild(grid);
        return {id, panel, grid};
    }

    field(label, value, callback) {
        const field = this.el("div", "hca-field");
        field.appendChild(this.el("label", "", label));
        const input = this.el("input");
        input.type = "text"; input.value = value ?? ""; input.placeholder = `Enter ${label.toLowerCase()}`;
        input.addEventListener("input", () => callback(input.value));
        field.appendChild(input);
        return field;
    }

    selectField(label, value, options, callback) {
        const field = this.el("div", "hca-field");
        field.appendChild(this.el("label", "", label));
        const select = this.el("select");
        for (const [optionValue, optionLabel] of options) {
            const option = this.el("option", "", optionLabel); option.value = String(optionValue); option.selected = String(optionValue) === String(value); select.appendChild(option);
        }
        select.addEventListener("change", () => callback(select.value));
        field.appendChild(select);
        return field;
    }

    switchCard(title, description, checked, callback, extra = "") {
        const row = this.el("button", `hca-switch ${extra}`);
        row.type = "button"; row.setAttribute("role", "switch"); row.setAttribute("aria-checked", String(Boolean(checked)));
        row.innerHTML = `<span><strong>${this.escape(title)}</strong><small>${this.escape(description)}</small></span><i class="${checked ? "on" : ""}"><b></b></i>`;
        row.addEventListener("click", () => { checked = !checked; row.setAttribute("aria-checked", String(checked)); row.querySelector("i")?.classList.toggle("on", checked); callback(checked); });
        return row;
    }

    typeLabel(type) { return ({0:"Playing",1:"Streaming",2:"Listening",3:"Watching",5:"Competing"})[Number(type)] || "Playing"; }
    escape(value) { return String(value ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;"); }

    startQuickButtonObserver() {
        this.ensureQuickButton();
        const mount = document.getElementById("app-mount") || document.body;
        if (!mount || typeof MutationObserver === "undefined") return;
        this.quickObserver = new MutationObserver(() => {
            if (this.quickButton?.isConnected || this.quickObserverFrame !== null) return;
            this.quickObserverFrame = requestAnimationFrame(() => { this.quickObserverFrame = null; this.ensureQuickButton(); });
        });
        this.quickObserver.observe(mount, {childList: true, subtree: true});
    }

    stopQuickButtonObserver() {
        this.quickObserver?.disconnect(); this.quickObserver = null;
        if (this.quickObserverFrame !== null) { cancelAnimationFrame(this.quickObserverFrame); this.quickObserverFrame = null; }
    }

    findSettingsButton() {
        const panels = [...document.querySelectorAll('[class*="panels_"]')].filter(element => element.getBoundingClientRect().height > 0);
        const panel = panels.sort((a,b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0];
        if (!panel) return null;
        const labels = /settings|impostazioni|paramètres|einstellungen|ajustes|configurações|instellingen|ustawienia|nastavení|ayarlar|設定|설정/i;
        return [...panel.querySelectorAll("button")].find(button => labels.test(`${button.getAttribute("aria-label") || ""} ${button.getAttribute("title") || ""}`)) || panel.querySelector('div[class*="buttons_"] button:last-child');
    }

    ensureQuickButton() {
        if (this.quickButton?.isConnected) return this.syncQuickButton();
        const settings = this.findSettingsButton();
        if (!settings?.parentElement || settings.parentElement.querySelector(".hca-quick")) return;
        const button = this.el("button", `${settings.className || ""} hca-quick`);
        button.type = "button"; button.title = "Custom Activities"; button.setAttribute("aria-label", "Custom Activities");
        button.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.7 5.5A4.8 4.8 0 0 0 2 10.3v3.5a4.8 4.8 0 0 0 8.9 2.4h2.2a4.8 4.8 0 0 0 8.9-2.4v-3.5a4.8 4.8 0 0 0-8.5-3h-3.1a4.7 4.7 0 0 0-3.7-1.8Z"/></svg>';
        button.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); this.openManager(); });
        settings.parentElement.insertBefore(button, settings); this.quickButton = button; this.syncQuickButton();
    }

    syncQuickButton() { if (this.quickButton) this.quickButton.classList.toggle("active", Boolean(this.currentProfileId)); }
    removeQuickButton() { this.quickButton?.remove(); this.quickButton = null; }

    openManager() {
        if (this.managerOverlay?.isConnected) return;
        const overlay = this.el("div", "hca-overlay");
        overlay.innerHTML = '<div class="hca-dialog"><button class="hca-close" type="button">×</button><div class="hca-content"></div></div>';
        overlay.querySelector(".hca-content").appendChild(this.getSettingsPanel("manager"));
        overlay.querySelector(".hca-close").addEventListener("click", () => this.closeManager());
        overlay.addEventListener("mousedown", event => { if (event.target === overlay) this.closeManager(); });
        this.managerKeyHandler = event => { if (event.key === "Escape") this.closeManager(); };
        document.addEventListener("keydown", this.managerKeyHandler); document.body.appendChild(overlay); this.managerOverlay = overlay;
    }

    closeManager() {
        if (!this.managerOverlay) return;
        if (this.managerKeyHandler) document.removeEventListener("keydown", this.managerKeyHandler);
        this.managerKeyHandler = null; this.managerOverlay.remove(); this.managerOverlay = null;
    }

    addStyle() {
        const css = `
.hca-root,.hca-root *{box-sizing:border-box}.hca-root{--bg:#111214;--surface:#1e1f22;--surface2:#2b2d31;--input:#151619;--text:#f2f3f5;--muted:#b5bac1;--border:#5c6068;--strong:#7c818b;container-type:inline-size;width:100%;color:var(--text);font:15px/1.45 var(--font-primary,Arial,sans-serif)}.theme-light .hca-root{--bg:#fff;--surface:#f2f3f5;--surface2:#e3e5e8;--input:#fff;--text:#1e1f22;--muted:#4e5058;--border:#b5bac1;--strong:#6d6f78}.hca-shell{display:flex;flex-direction:column;gap:14px;min-width:0}.hca-manager .hca-shell{height:100%;padding:22px;background:var(--bg)}.hca-header,.hca-editor-top,.hca-footer{display:flex;align-items:center;justify-content:space-between;gap:16px}.hca-brand{display:flex;align-items:center;gap:12px}.hca-logo{display:grid;place-items:center;width:42px;height:42px;border-radius:12px;background:#5865f2;color:white}.hca-title{font-size:25px;font-weight:700}.hca-title small{font-size:12px;color:var(--muted)}.hca-root p{margin:3px 0 0;color:var(--muted)}.hca-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.hca-status,.hca-switch,.hca-sidebar,.hca-preview,.hca-pane,.hca-footer{border:1px solid var(--border);border-radius:11px;background:var(--surface)}.hca-status{display:flex;align-items:center;gap:10px;padding:11px 13px}.hca-status>div{flex:1}.hca-dot{width:10px;height:10px;border-radius:50%;background:var(--muted)}.hca-dot.on{background:#23a55a}.hca-switches{display:grid;grid-template-columns:1fr 1fr;gap:10px}.hca-switch{display:flex;align-items:center;justify-content:space-between;padding:12px 13px;color:var(--text);text-align:left;cursor:pointer}.hca-switch span{display:flex;flex-direction:column}.hca-switch small{margin-top:3px;color:var(--muted);font-size:13px}.hca-switch>i{width:38px;height:22px;padding:3px;border-radius:20px;background:var(--surface2)}.hca-switch>i b{display:block;width:16px;height:16px;border-radius:50%;background:#fff;transition:.12s}.hca-switch>i.on{background:#5865f2}.hca-switch>i.on b{transform:translateX(16px)}.hca-layout{display:grid;grid-template-columns:230px minmax(0,1fr);gap:14px;min-height:0}.hca-sidebar{padding:10px}.hca-side-title{padding:4px;color:var(--muted);font-size:12px;font-weight:800}.hca-list{display:flex;flex-direction:column;gap:5px}.hca-profile{display:flex;align-items:center;gap:9px;width:100%;padding:8px;border:0;border-radius:9px;background:transparent;color:var(--text);text-align:left;cursor:pointer}.hca-profile:hover{background:rgba(255,255,255,.06)}.hca-profile.selected{background:rgba(88,101,242,.2);box-shadow:inset 3px 0 #5865f2}.hca-avatar{display:grid;place-items:center;width:34px;height:34px;border-radius:9px;background:#5865f2;color:white;font-weight:800}.hca-profile>span:last-child{display:flex;flex-direction:column}.hca-profile small{color:var(--muted)}.hca-editor{display:flex;flex-direction:column;gap:12px;min-width:0;overflow:auto}.hca-editor-top h2{margin:2px 0;font-size:23px}.hca-editor-top small{color:var(--muted);font-weight:800}.hca-preview{display:flex;align-items:center;gap:12px;padding:12px}.hca-preview-icon{display:grid;place-items:center;width:62px;height:62px;border-radius:12px;background:#5865f2;color:white;font-size:24px;font-weight:800}.hca-preview>div{display:flex;flex-direction:column}.hca-preview strong{font-size:15px}.hca-preview small{color:var(--muted)}.hca-tabs{display:flex;gap:6px;width:max-content;padding:5px;border:1px solid var(--border);border-radius:11px;background:var(--surface)}.hca-button{min-height:42px;padding:9px 15px;border:1px solid transparent;border-radius:8px;font:inherit;font-weight:700;cursor:pointer}.hca-button.primary{background:#5865f2;color:#fff}.hca-button.secondary{border-color:var(--border);background:var(--surface2);color:var(--text)}.hca-button.danger{background:#3a1d20;color:#ffb4b8}.hca-button.tab{min-width:105px;background:transparent;color:var(--muted)}.hca-button.tab.active{background:#5865f2;color:#fff}.hca-panes{width:100%}.hca-pane[hidden]{display:none!important}.hca-pane>header{padding:16px 18px;border-bottom:1px solid var(--border);background:var(--surface2)}.hca-pane h3{margin:0;font-size:20px}.hca-fields{display:grid;grid-template-columns:1fr 1fr;gap:18px;padding:20px}.hca-field{display:flex;flex-direction:column;gap:8px}.hca-field label{font-weight:700}.hca-field input,.hca-field select{width:100%;height:50px;padding:12px 14px;border:2px solid var(--strong);border-radius:9px;outline:none;background:var(--input);color:var(--text);font:16px var(--font-primary,Arial,sans-serif)}.hca-field input:focus,.hca-field select:focus{border-color:#5865f2;box-shadow:0 0 0 3px rgba(88,101,242,.3)}.hca-switch.inline{grid-column:1/-1}.hca-footer{position:sticky;bottom:0;padding:12px 14px}.hca-footer>div:first-child{flex:1}.hca-empty{display:grid;place-items:center;min-height:300px;text-align:center}.hca-overlay{position:fixed;inset:0;z-index:10000;display:grid;place-items:center;padding:16px;background:rgba(0,0,0,.65);backdrop-filter:blur(5px)}.hca-dialog{position:relative;width:min(1180px,calc(100vw - 32px));height:min(820px,calc(100vh - 32px));overflow:hidden;border:1px solid var(--border);border-radius:16px;background:#111214}.hca-content{height:100%;overflow:auto}.hca-close{position:absolute;top:12px;right:12px;z-index:5;width:36px;height:36px;border:1px solid #5c6068;border-radius:8px;background:#2b2d31;color:#fff;font-size:22px;cursor:pointer}.hca-quick{position:relative!important}.hca-quick svg{width:20px;height:20px}.hca-quick.active:after{content:"";position:absolute;right:3px;bottom:3px;width:7px;height:7px;border-radius:50%;background:#23a55a}@container(max-width:820px){.hca-header,.hca-editor-top,.hca-footer{align-items:stretch;flex-direction:column}.hca-switches,.hca-fields{grid-template-columns:1fr}.hca-switch.inline{grid-column:auto}.hca-layout{grid-template-columns:1fr}.hca-list{flex-direction:row;overflow:auto}.hca-profile{min-width:190px}.hca-tabs{width:100%}.hca-button.tab{flex:1;min-width:0}}@media(max-width:700px){.hca-dialog{width:calc(100vw - 12px);height:calc(100vh - 12px);border-radius:10px}.hca-manager .hca-shell{padding:14px}.hca-title{font-size:20px}}
        `;
        if (BdApi.DOM?.addStyle) BdApi.DOM.addStyle(this.pluginName, css);
        else BdApi.injectCSS?.(this.pluginName, css);
    }

    removeStyle() {
        if (BdApi.DOM?.removeStyle) BdApi.DOM.removeStyle(this.pluginName);
        else BdApi.clearCSS?.(this.pluginName);
    }
};
