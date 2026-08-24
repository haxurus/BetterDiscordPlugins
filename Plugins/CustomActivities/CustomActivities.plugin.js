/**
 * @name CustomActivities
 * @author Haxurus
 * @version 1.2.0
 * @description Create, save and switch fully customized Discord Rich Presence activities directly from BetterDiscord.
 */

module.exports = class CustomActivities {
    constructor() {
        this.name = "CustomActivities";
        this.styleId = "CustomActivitiesStyles";
        this.defaults = {
            autoStart: false,
            protectActivity: true,
            activeProfileId: null,
            profiles: []
        };

        this.settings = Object.assign({}, this.defaults, BdApi.Data?.load?.(this.name, "settings") || {});
        if (!Array.isArray(this.settings.profiles)) this.settings.profiles = [];

        this.currentProfileId = null;
        this.editingProfileId = this.settings.activeProfileId || this.settings.profiles[0]?.id || null;
        this.action = null;
        this.startedAt = null;
        this.allowPresenceDispatch = false;
        this.protectionUnpatch = null;

        this.quickObserver = null;
        this.quickButton = null;
        this.quickTooltip = null;
        this.quickObserverFrame = null;
    }

    start() {
        this.injectStyles();
        this.startQuickButtonObserver();

        if (this.settings.autoStart && this.settings.activeProfileId) {
            setTimeout(() => this.activate(this.settings.activeProfileId, true), 1500);
        }
    }

    stop() {
        this.stopQuickButtonObserver();
        this.removeQuickButton();
        this.clear(false).finally(() => {
            this.removeProtection();
            BdApi.Patcher?.unpatchAll?.(this.name);
            this.removeStyles();
        });
    }

    save() {
        BdApi.Data?.save?.(this.name, "settings", this.settings);
    }

    toast(message, type = "info") {
        BdApi.UI?.showToast?.(message, {type});
    }

    module(predicate) {
        try {
            return BdApi.Webpack?.getModule?.(predicate, {searchExports: true}) || null;
        }
        catch {
            return null;
        }
    }

    profile(id) {
        return this.settings.profiles.find(profile => profile.id === id) || null;
    }

    blank() {
        return {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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

    validUrl(value) {
        try {
            const url = new URL(value);
            return url.protocol === "http:" || url.protocol === "https:";
        }
        catch {
            return false;
        }
    }

    validate(profile) {
        if (!/^\d{10,25}$/.test((profile.clientId || "").trim())) {
            throw new Error("Enter a valid Discord Application ID / Client ID.");
        }

        if (Number(profile.type) === 1 && profile.streamUrl && !this.validUrl(profile.streamUrl)) {
            throw new Error("Streaming URL must be a valid http:// or https:// URL.");
        }

        [
            [profile.button1Label, profile.button1Url, 1],
            [profile.button2Label, profile.button2Url, 2]
        ].forEach(([label, url, number]) => {
            if ((label && !url) || (!label && url)) {
                throw new Error(`Button ${number} requires both a label and a URL.`);
            }
            if (label && label.length > 32) {
                throw new Error(`Button ${number} label cannot exceed 32 characters.`);
            }
            if (url && !this.validUrl(url)) {
                throw new Error(`Button ${number} URL is invalid.`);
            }
        });
    }

    async socket(clientId) {
        const validator = this.module(module => module && typeof module.validateSocketClient === "function");
        if (!validator) throw new Error("Discord RPC validator module was not found.");

        const socket = {
            application: {id: null, name: null, icon: null},
            authorization: {accessToken: null, authing: false, expires: new Date(0), scopes: []},
            encoding: "json",
            transport: "ipc",
            id: "custom-activities",
            version: 1
        };

        await validator.validateSocketClient.call(validator, socket, null, clientId);
        if (!socket.application?.id) {
            throw new Error("Discord did not return application information for this Client ID.");
        }

        return socket;
    }

    getAction() {
        const module = this.module(item => item?.SET_ACTIVITY && typeof item.SET_ACTIVITY.handler === "function");
        return module?.SET_ACTIVITY || null;
    }

    event(profile, socket) {
        const application = socket.application || {};
        const activityName = (profile.activityName || application.name || profile.profileName || "Custom Activity").trim();

        const activity = {
            name: activityName,
            type: Number(profile.type) || 0,
            application_id: profile.clientId.trim(),
            timestamps: {},
            assets: {},
            buttons: []
        };

        if (profile.details?.trim()) activity.details = profile.details.trim();
        if (profile.state?.trim()) activity.state = profile.state.trim();
        if (Number(profile.type) === 1 && profile.streamUrl?.trim()) activity.url = profile.streamUrl.trim();
        if (profile.enableTimer) activity.timestamps.start = this.startedAt || Date.now();

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
                    name: application.name || activityName,
                    icon: application.icon ?? null,
                    coverImage: application.coverImage ?? null,
                    flags: application.flags ?? 0
                }
            },
            cmd: "SET_ACTIVITY",
            args: {
                pid: require("process").pid,
                activity
            }
        };
    }

    async dispatchPresence(payload) {
        if (!this.action || typeof this.action.handler !== "function") {
            throw new Error("Discord SET_ACTIVITY handler is unavailable.");
        }

        this.allowPresenceDispatch = true;
        try {
            return await this.action.handler(payload);
        }
        finally {
            this.allowPresenceDispatch = false;
        }
    }

    installProtection() {
        this.removeProtection();
        if (!this.settings.protectActivity || !this.action) return;

        this.protectionUnpatch = BdApi.Patcher?.instead?.(
            this.name,
            this.action,
            "handler",
            (_thisObject, args, originalFunction) => {
                const payload = args?.[0];
                if (this.allowPresenceDispatch || payload?.cmd !== "SET_ACTIVITY") {
                    return originalFunction(...args);
                }
                return undefined;
            }
        ) || null;
    }

    removeProtection() {
        if (typeof this.protectionUnpatch === "function") {
            try { this.protectionUnpatch(); }
            catch (error) { console.warn(`[${this.name}] Failed to remove presence protection`, error); }
        }
        this.protectionUnpatch = null;
    }

    async activate(id, silent = false) {
        const profile = this.profile(id);
        if (!profile) return false;

        try {
            this.validate(profile);

            if (this.currentProfileId && this.currentProfileId !== id) {
                await this.clear(false);
            }

            const socket = await this.socket(profile.clientId.trim());
            this.action = this.getAction();
            if (!this.action) throw new Error("Discord SET_ACTIVITY handler was not found.");

            this.startedAt = Date.now();
            await this.dispatchPresence(this.event(profile, socket));

            this.currentProfileId = id;
            this.settings.activeProfileId = id;
            this.editingProfileId = id;
            this.save();
            this.installProtection();
            this.syncQuickButton();

            if (!silent) this.toast(`Activity "${profile.profileName}" is now active.`, "success");
            return true;
        }
        catch (error) {
            console.error(`[${this.name}]`, error);
            this.removeProtection();
            this.syncQuickButton();
            this.toast(error?.message || "Failed to activate custom activity.", "error");
            return false;
        }
    }

    async clear(show = true) {
        try {
            if (this.action) {
                await this.dispatchPresence({
                    socket: {transport: "ipc"},
                    cmd: "SET_ACTIVITY",
                    args: {pid: require("process").pid}
                });
            }
        }
        catch (error) {
            console.warn(`[${this.name}] Failed to clear activity`, error);
        }
        finally {
            this.removeProtection();
            this.currentProfileId = null;
            this.startedAt = null;
            this.action = null;
            this.syncQuickButton();
        }

        if (show) this.toast("Custom activity stopped.", "success");
    }

    injectStyles() {
        const css = `
            .ca-root,
            .ca-root * { box-sizing: border-box; }

            .ca-root {
                width: 100%;
                color: var(--text-normal);
                font-family: var(--font-primary, sans-serif);
            }

            .ca-modal-host {
                width: clamp(420px, 62vw, 760px);
                max-width: calc(100vw - 96px);
                max-height: 70vh;
                overflow: auto;
                padding: 2px 5px 2px 0;
            }

            .ca-hero {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 14px;
                margin-bottom: 12px;
                padding: 15px;
                border: 1px solid var(--background-modifier-accent);
                border-radius: 12px;
                background: var(--background-secondary);
            }

            .ca-hero-copy { min-width: 0; }

            .ca-title {
                margin: 0;
                color: var(--header-primary);
                font-size: 18px;
                line-height: 1.2;
                font-weight: 700;
            }

            .ca-subtitle {
                margin: 4px 0 0;
                color: var(--text-muted);
                font-size: 12px;
                line-height: 1.45;
            }

            .ca-status {
                display: inline-flex;
                align-items: center;
                gap: 7px;
                flex: 0 0 auto;
                padding: 6px 9px;
                border-radius: 999px;
                background: var(--background-tertiary);
                color: var(--text-muted);
                font-size: 11px;
                font-weight: 700;
                white-space: nowrap;
            }

            .ca-status-dot {
                width: 7px;
                height: 7px;
                border-radius: 50%;
                background: var(--text-muted);
            }

            .ca-status.is-active { color: var(--text-positive, #23a55a); }
            .ca-status.is-active .ca-status-dot { background: var(--status-positive, #23a55a); }

            .ca-global-grid {
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 9px;
                margin-bottom: 12px;
            }

            .ca-switch-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                min-height: 56px;
                padding: 10px 11px;
                border: 1px solid var(--background-modifier-accent);
                border-radius: 10px;
                background: var(--background-secondary);
                cursor: pointer;
                user-select: none;
            }

            .ca-switch-copy { min-width: 0; }

            .ca-switch-title {
                color: var(--header-primary);
                font-size: 12px;
                font-weight: 700;
            }

            .ca-switch-description {
                margin-top: 2px;
                color: var(--text-muted);
                font-size: 10px;
                line-height: 1.35;
            }

            .ca-switch {
                position: relative;
                flex: 0 0 auto;
                width: 36px;
                height: 20px;
                border-radius: 999px;
                background: var(--background-modifier-selected);
                transition: background 120ms ease;
            }

            .ca-switch::after {
                content: "";
                position: absolute;
                top: 3px;
                left: 3px;
                width: 14px;
                height: 14px;
                border-radius: 50%;
                background: white;
                transition: transform 120ms ease;
            }

            .ca-switch.is-on { background: var(--brand-500, #5865f2); }
            .ca-switch.is-on::after { transform: translateX(16px); }

            .ca-profile-bar {
                display: flex;
                align-items: center;
                gap: 7px;
                overflow-x: auto;
                padding: 1px 0 9px;
                scrollbar-width: thin;
            }

            .ca-profile-tab {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                flex: 0 0 auto;
                min-height: 32px;
                max-width: 190px;
                padding: 6px 9px;
                border: 1px solid var(--background-modifier-accent);
                border-radius: 8px;
                background: var(--background-secondary);
                color: var(--text-muted);
                font: inherit;
                font-size: 11px;
                font-weight: 700;
                cursor: pointer;
            }

            .ca-profile-tab:hover { background: var(--background-modifier-hover); }

            .ca-profile-tab.is-selected {
                border-color: var(--brand-500, #5865f2);
                background: var(--background-modifier-selected);
                color: var(--header-primary);
            }

            .ca-profile-tab-name {
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .ca-profile-tab-dot {
                width: 7px;
                height: 7px;
                flex: 0 0 auto;
                border-radius: 50%;
                background: var(--status-positive, #23a55a);
            }

            .ca-editor {
                overflow: hidden;
                border: 1px solid var(--background-modifier-accent);
                border-radius: 12px;
                background: var(--background-secondary);
            }

            .ca-editor-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                padding: 12px 14px;
                border-bottom: 1px solid var(--background-modifier-accent);
                background: var(--background-secondary-alt, var(--background-secondary));
            }

            .ca-editor-title {
                min-width: 0;
                overflow: hidden;
                color: var(--header-primary);
                font-size: 14px;
                font-weight: 700;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .ca-actions {
                display: flex;
                align-items: center;
                justify-content: flex-end;
                gap: 6px;
                flex-wrap: wrap;
            }

            .ca-button {
                min-height: 31px;
                padding: 6px 10px;
                border: 0;
                border-radius: 7px;
                background: var(--brand-500, #5865f2);
                color: white;
                font: inherit;
                font-size: 11px;
                font-weight: 700;
                cursor: pointer;
            }

            .ca-button:hover:not(:disabled) { filter: brightness(1.08); }
            .ca-button:disabled { cursor: not-allowed; opacity: .45; }
            .ca-button.secondary { background: var(--background-modifier-selected); color: var(--header-primary); }
            .ca-button.positive { background: var(--status-positive, #23a55a); }
            .ca-button.danger { background: var(--status-danger, #da373c); }

            .ca-section {
                padding: 13px 14px 14px;
                border-bottom: 1px solid var(--background-modifier-accent);
            }

            .ca-section:last-child { border-bottom: 0; }

            .ca-section-heading {
                margin: 0 0 9px;
                color: var(--header-secondary);
                font-size: 10px;
                font-weight: 800;
                letter-spacing: .05em;
                text-transform: uppercase;
            }

            .ca-grid {
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 10px 11px;
            }

            .ca-field {
                display: flex;
                flex-direction: column;
                gap: 5px;
                min-width: 0;
            }

            .ca-field.full { grid-column: 1 / -1; }

            .ca-field-label {
                color: var(--header-secondary);
                font-size: 10px;
                line-height: 1.25;
                font-weight: 750;
            }

            .ca-field-description {
                margin-top: 1px;
                color: var(--text-muted);
                font-size: 10px;
                line-height: 1.35;
            }

            .ca-input,
            .ca-select {
                width: 100%;
                min-height: 35px;
                padding: 7px 9px;
                border: 1px solid transparent;
                border-radius: 7px;
                outline: none;
                background: var(--input-background, var(--background-tertiary));
                color: var(--text-normal);
                font: inherit;
                font-size: 12px;
            }

            .ca-input:focus,
            .ca-select:focus { border-color: var(--brand-500, #5865f2); }

            .ca-inline-toggle {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                min-height: 35px;
                padding: 7px 9px;
                border-radius: 7px;
                background: var(--input-background, var(--background-tertiary));
                cursor: pointer;
                user-select: none;
            }

            .ca-inline-toggle.full { grid-column: 1 / -1; }

            .ca-inline-toggle > span {
                color: var(--text-normal);
                font-size: 11px;
                font-weight: 650;
            }

            .ca-empty {
                display: grid;
                place-items: center;
                gap: 8px;
                min-height: 145px;
                padding: 24px;
                border: 1px dashed var(--background-modifier-accent);
                border-radius: 12px;
                background: var(--background-secondary);
                color: var(--text-muted);
                text-align: center;
            }

            .ca-empty strong { color: var(--header-primary); font-size: 13px; }

            .ca-quick-button { position: relative !important; }
            .ca-quick-button svg { width: 20px; height: 20px; }

            .ca-quick-button.is-active::after {
                content: "";
                position: absolute;
                right: 3px;
                bottom: 3px;
                width: 7px;
                height: 7px;
                border: 2px solid var(--background-secondary-alt, var(--background-secondary));
                border-radius: 50%;
                background: var(--status-positive, #23a55a);
            }

            @media (max-width: 680px) {
                .ca-modal-host { width: min(92vw, 520px); max-width: 92vw; }
                .ca-global-grid,
                .ca-grid { grid-template-columns: 1fr; }
                .ca-field.full,
                .ca-inline-toggle.full { grid-column: auto; }
                .ca-hero,
                .ca-editor-header { align-items: flex-start; flex-direction: column; }
                .ca-actions { justify-content: flex-start; }
            }
        `;

        BdApi.DOM?.addStyle?.(this.styleId, css);
    }

    removeStyles() {
        BdApi.DOM?.removeStyle?.(this.styleId);
    }

    startQuickButtonObserver() {
        this.ensureQuickButton();

        const root = document.getElementById("app-mount") || document.body;
        if (!root || typeof MutationObserver === "undefined") return;

        this.quickObserver = new MutationObserver(() => {
            if (this.quickButton?.isConnected || this.quickObserverFrame !== null) return;

            this.quickObserverFrame = requestAnimationFrame(() => {
                this.quickObserverFrame = null;
                this.ensureQuickButton();
            });
        });

        this.quickObserver.observe(root, {childList: true, subtree: true});
    }

    stopQuickButtonObserver() {
        this.quickObserver?.disconnect();
        this.quickObserver = null;

        if (this.quickObserverFrame !== null) {
            cancelAnimationFrame(this.quickObserverFrame);
            this.quickObserverFrame = null;
        }
    }

    findUserPanelControls() {
        const panels = [...document.querySelectorAll('[class*="panels_"]')];
        if (!panels.length) return null;

        const panel = panels
            .filter(element => element.getBoundingClientRect().height > 0)
            .sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0] || panels[0];

        const groups = [...panel.querySelectorAll('div[class*="buttons_"]')]
            .map(element => ({element, buttons: [...element.querySelectorAll("button")]}))
            .filter(item => item.buttons.length >= 2 && item.buttons.length <= 8);

        if (!groups.length) return null;

        const settingsPattern = /settings|impostazioni|paramètres|einstellungen|ajustes|configurações|instellingen|ustawienia|nastavení|ayarlar/i;

        for (const group of groups) {
            const settingsButton = group.buttons.find(button => {
                const label = `${button.getAttribute("aria-label") || ""} ${button.getAttribute("title") || ""}`;
                return settingsPattern.test(label);
            });

            if (settingsButton) return {group: group.element, referenceButton: settingsButton};
        }

        groups.sort((a, b) => b.element.getBoundingClientRect().bottom - a.element.getBoundingClientRect().bottom);
        const fallback = groups[0];
        return {group: fallback.element, referenceButton: fallback.buttons[fallback.buttons.length - 1]};
    }

    ensureQuickButton() {
        if (this.quickButton?.isConnected) {
            this.syncQuickButton();
            return;
        }

        const target = this.findUserPanelControls();
        if (!target?.referenceButton?.parentElement) return;

        const parent = target.referenceButton.parentElement;
        if (parent.querySelector(".ca-quick-button")) return;

        const button = document.createElement("button");
        button.type = "button";
        button.className = `${target.referenceButton.className || ""} ca-quick-button`.trim();
        button.setAttribute("aria-label", "Custom Activities");
        button.setAttribute("title", "Custom Activities");
        button.innerHTML = `
            <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
                <path d="M6.75 5.5A4.75 4.75 0 0 0 2 10.25v3.5A4.75 4.75 0 0 0 6.75 18.5c1.76 0 3.3-.96 4.12-2.38h2.26a4.74 4.74 0 0 0 4.12 2.38A4.75 4.75 0 0 0 22 13.75v-3.5a4.75 4.75 0 0 0-4.75-4.75c-1.5 0-2.84.7-3.7 1.8h-3.1a4.72 4.72 0 0 0-3.7-1.8Zm0 2c.96 0 1.8.51 2.28 1.27l.3.48h5.34l.3-.48a2.73 2.73 0 0 1 2.28-1.27A2.75 2.75 0 0 1 20 10.25v3.5a2.75 2.75 0 0 1-2.75 2.75 2.73 2.73 0 0 1-2.53-1.68l-.26-.7H9.54l-.26.7a2.73 2.73 0 0 1-2.53 1.68A2.75 2.75 0 0 1 4 13.75v-3.5A2.75 2.75 0 0 1 6.75 7.5ZM6 10v1.25H4.75v1.5H6V14h1.5v-1.25h1.25v-1.5H7.5V10H6Zm10.75.75a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"/>
            </svg>
        `;

        button.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            this.openManager();
        });

        parent.insertBefore(button, target.referenceButton);
        this.quickButton = button;
        this.syncQuickButton();

        try {
            this.quickTooltip = BdApi.UI?.createTooltip?.(button, "Custom Activities", {side: "top"}) || null;
        }
        catch (error) {
            console.warn(`[${this.name}] Failed to create quick button tooltip`, error);
        }
    }

    syncQuickButton() {
        if (!this.quickButton) return;

        const activeProfile = this.profile(this.currentProfileId);
        this.quickButton.classList.toggle("is-active", Boolean(activeProfile));
        this.quickButton.setAttribute(
            "aria-label",
            activeProfile ? `Custom Activities - ${activeProfile.profileName} active` : "Custom Activities"
        );
    }

    removeQuickButton() {
        try { this.quickTooltip?.hide?.(); } catch {}
        try { this.quickTooltip?.destroy?.(); } catch {}
        this.quickTooltip = null;
        this.quickButton?.remove();
        this.quickButton = null;
    }

    createModalContent() {
        const React = BdApi.React;
        const plugin = this;

        function ModalHost() {
            const hostRef = React.useRef(null);

            React.useEffect(() => {
                const host = hostRef.current;
                if (!host) return undefined;

                const panel = plugin.getSettingsPanel();
                host.replaceChildren(panel);

                return () => panel.remove();
            }, []);

            return React.createElement("div", {className: "ca-modal-host", ref: hostRef});
        }

        return React.createElement(ModalHost);
    }

    openManager() {
        if (!BdApi.React || !BdApi.UI?.alert) {
            this.toast("Unable to open the Custom Activities manager.", "error");
            return;
        }

        BdApi.UI.alert("Custom Activities", this.createModalContent());
    }

    getSettingsPanel() {
        const root = document.createElement("div");
        root.className = "ca-root";
        this.renderManager(root);
        return root;
    }

    renderManager(root) {
        root.replaceChildren();

        if (!this.editingProfileId || !this.profile(this.editingProfileId)) {
            this.editingProfileId = this.settings.activeProfileId || this.settings.profiles[0]?.id || null;
        }

        root.appendChild(this.buildHero());
        root.appendChild(this.buildGlobalSettings(root));
        root.appendChild(this.buildProfileBar(root));

        const profile = this.profile(this.editingProfileId);
        root.appendChild(profile ? this.buildEditor(profile, root) : this.buildEmptyState(root));
    }

    buildHero() {
        const hero = document.createElement("div");
        hero.className = "ca-hero";

        const copy = document.createElement("div");
        copy.className = "ca-hero-copy";

        const title = document.createElement("h2");
        title.className = "ca-title";
        title.textContent = "Custom Activities";

        const subtitle = document.createElement("p");
        subtitle.className = "ca-subtitle";
        subtitle.textContent = "Create, save and switch Rich Presence profiles directly from Discord.";

        copy.append(title, subtitle);

        const status = document.createElement("div");
        status.className = `ca-status${this.currentProfileId ? " is-active" : ""}`;

        const dot = document.createElement("span");
        dot.className = "ca-status-dot";

        const label = document.createElement("span");
        const activeProfile = this.profile(this.currentProfileId);
        label.textContent = activeProfile ? `Active: ${activeProfile.profileName}` : "No activity active";

        status.append(dot, label);
        hero.append(copy, status);
        return hero;
    }

    buildGlobalSettings(root) {
        const grid = document.createElement("div");
        grid.className = "ca-global-grid";

        grid.append(
            this.switchRow(
                "Auto-start activity",
                "Starts the last activated profile when the plugin loads.",
                this.settings.autoStart,
                value => {
                    this.settings.autoStart = value;
                    this.save();
                }
            ),
            this.switchRow(
                "Protect active presence",
                "Prevents detected applications from replacing the custom Rich Presence while it is active.",
                this.settings.protectActivity,
                value => {
                    this.settings.protectActivity = value;
                    this.save();
                    if (this.currentProfileId) {
                        if (value) this.installProtection();
                        else this.removeProtection();
                    }
                    this.renderManager(root);
                }
            )
        );

        return grid;
    }

    buildProfileBar(root) {
        const bar = document.createElement("div");
        bar.className = "ca-profile-bar";

        this.settings.profiles.forEach(profile => {
            const tab = document.createElement("button");
            tab.type = "button";
            tab.className = `ca-profile-tab${profile.id === this.editingProfileId ? " is-selected" : ""}`;
            tab.dataset.profileId = profile.id;

            if (profile.id === this.currentProfileId) {
                const dot = document.createElement("span");
                dot.className = "ca-profile-tab-dot";
                tab.appendChild(dot);
            }

            const name = document.createElement("span");
            name.className = "ca-profile-tab-name";
            name.textContent = profile.profileName || "Unnamed Activity";
            tab.appendChild(name);

            tab.addEventListener("click", () => {
                this.editingProfileId = profile.id;
                this.renderManager(root);
            });

            bar.appendChild(tab);
        });

        const add = document.createElement("button");
        add.type = "button";
        add.className = "ca-profile-tab";
        add.textContent = "+ New activity";
        add.addEventListener("click", () => {
            const profile = this.blank();
            this.settings.profiles.push(profile);
            this.editingProfileId = profile.id;
            this.save();
            this.renderManager(root);
        });

        bar.appendChild(add);
        return bar;
    }

    buildEmptyState(root) {
        const empty = document.createElement("div");
        empty.className = "ca-empty";

        const title = document.createElement("strong");
        title.textContent = "No custom activities yet";

        const description = document.createElement("div");
        description.textContent = "Create your first profile to start customizing your Discord Rich Presence.";

        const button = this.button("Create activity", () => {
            const profile = this.blank();
            this.settings.profiles.push(profile);
            this.editingProfileId = profile.id;
            this.save();
            this.renderManager(root);
        });

        empty.append(title, description, button);
        return empty;
    }

    buildEditor(profile, root) {
        const editor = document.createElement("div");
        editor.className = "ca-editor";

        const header = document.createElement("div");
        header.className = "ca-editor-header";

        const title = document.createElement("div");
        title.className = "ca-editor-title";
        title.textContent = profile.profileName || "Unnamed Activity";

        const actions = document.createElement("div");
        actions.className = "ca-actions";

        const activateButton = this.button(
            this.currentProfileId === profile.id ? "Restart" : "Activate",
            async () => {
                await this.activate(profile.id);
                this.renderManager(root);
            },
            this.currentProfileId === profile.id ? "positive" : ""
        );

        const stopButton = this.button("Stop", async () => {
            await this.clear(true);
            this.renderManager(root);
        }, "secondary");
        stopButton.disabled = !this.currentProfileId;

        const deleteButton = this.button("Delete", async () => {
            if (this.currentProfileId === profile.id) await this.clear(false);

            this.settings.profiles = this.settings.profiles.filter(item => item.id !== profile.id);
            if (this.settings.activeProfileId === profile.id) this.settings.activeProfileId = null;

            this.editingProfileId = this.settings.profiles[0]?.id || null;
            this.save();
            this.renderManager(root);
        }, "danger");

        actions.append(activateButton, stopButton, deleteButton);
        header.append(title, actions);
        editor.appendChild(header);

        editor.appendChild(this.section("General", [
            this.field("Profile name", profile.profileName, value => {
                profile.profileName = value;
                title.textContent = value || "Unnamed Activity";
                const tabName = root.querySelector(`[data-profile-id="${CSS.escape(profile.id)}"] .ca-profile-tab-name`);
                if (tabName) tabName.textContent = value || "Unnamed Activity";
                this.save();
            }, "Only used inside this plugin."),
            this.field("Discord Application ID", profile.clientId, value => {
                profile.clientId = value;
                this.save();
            }, "Required. Use the Application ID from the Discord Developer Portal."),
            this.field("Activity name", profile.activityName, value => {
                profile.activityName = value;
                this.save();
            }, "Discord may use the application name depending on the current client implementation."),
            this.select("Activity type", profile.type, value => {
                profile.type = Number(value);
                this.save();
                this.renderManager(root);
            }, [
                [0, "Playing"],
                [1, "Streaming"],
                [2, "Listening"],
                [3, "Watching"],
                [5, "Competing"]
            ])
        ]));

        const presenceFields = [
            this.field("Details", profile.details, value => {
                profile.details = value;
                this.save();
            }),
            this.field("State", profile.state, value => {
                profile.state = value;
                this.save();
            })
        ];

        if (Number(profile.type) === 1) {
            presenceFields.push(this.field("Streaming URL", profile.streamUrl, value => {
                profile.streamUrl = value;
                this.save();
            }, "Used only when the activity type is Streaming.", true));
        }

        presenceFields.push(this.inlineToggle("Show elapsed timer", profile.enableTimer, value => {
            profile.enableTimer = value;
            this.save();
        }));

        editor.appendChild(this.section("Presence", presenceFields));

        editor.appendChild(this.section("Assets", [
            this.field("Large image asset key", profile.largeImageKey, value => {
                profile.largeImageKey = value;
                this.save();
            }, "Asset key from your Discord application."),
            this.field("Large image hover text", profile.largeImageText, value => {
                profile.largeImageText = value;
                this.save();
            }),
            this.field("Small image asset key", profile.smallImageKey, value => {
                profile.smallImageKey = value;
                this.save();
            }, "Asset key from your Discord application."),
            this.field("Small image hover text", profile.smallImageText, value => {
                profile.smallImageText = value;
                this.save();
            })
        ]));

        editor.appendChild(this.section("Buttons", [
            this.field("Button 1 label", profile.button1Label, value => {
                profile.button1Label = value;
                this.save();
            }),
            this.field("Button 1 URL", profile.button1Url, value => {
                profile.button1Url = value;
                this.save();
            }),
            this.field("Button 2 label", profile.button2Label, value => {
                profile.button2Label = value;
                this.save();
            }),
            this.field("Button 2 URL", profile.button2Url, value => {
                profile.button2Url = value;
                this.save();
            })
        ]));

        return editor;
    }

    section(titleText, children) {
        const section = document.createElement("section");
        section.className = "ca-section";

        const heading = document.createElement("h3");
        heading.className = "ca-section-heading";
        heading.textContent = titleText;

        const grid = document.createElement("div");
        grid.className = "ca-grid";
        children.forEach(child => grid.appendChild(child));

        section.append(heading, grid);
        return section;
    }

    switchRow(titleText, descriptionText, checked, onChange) {
        const row = document.createElement("div");
        row.className = "ca-switch-row";
        row.setAttribute("role", "switch");
        row.setAttribute("tabindex", "0");
        row.setAttribute("aria-checked", String(Boolean(checked)));

        const copy = document.createElement("div");
        copy.className = "ca-switch-copy";

        const title = document.createElement("div");
        title.className = "ca-switch-title";
        title.textContent = titleText;

        const description = document.createElement("div");
        description.className = "ca-switch-description";
        description.textContent = descriptionText;

        copy.append(title, description);

        const toggle = document.createElement("div");
        toggle.className = `ca-switch${checked ? " is-on" : ""}`;
        row.append(copy, toggle);

        const toggleValue = () => {
            checked = !checked;
            toggle.classList.toggle("is-on", checked);
            row.setAttribute("aria-checked", String(checked));
            onChange(checked);
        };

        row.addEventListener("click", toggleValue);
        row.addEventListener("keydown", event => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                toggleValue();
            }
        });

        return row;
    }

    inlineToggle(titleText, checked, onChange) {
        const row = document.createElement("div");
        row.className = "ca-inline-toggle full";
        row.setAttribute("role", "switch");
        row.setAttribute("tabindex", "0");
        row.setAttribute("aria-checked", String(Boolean(checked)));

        const title = document.createElement("span");
        title.textContent = titleText;

        const toggle = document.createElement("div");
        toggle.className = `ca-switch${checked ? " is-on" : ""}`;
        row.append(title, toggle);

        const toggleValue = () => {
            checked = !checked;
            toggle.classList.toggle("is-on", checked);
            row.setAttribute("aria-checked", String(checked));
            onChange(checked);
        };

        row.addEventListener("click", toggleValue);
        row.addEventListener("keydown", event => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                toggleValue();
            }
        });

        return row;
    }

    field(labelText, value, onChange, descriptionText = "", full = false) {
        const wrap = document.createElement("label");
        wrap.className = `ca-field${full ? " full" : ""}`;

        const label = document.createElement("span");
        label.className = "ca-field-label";
        label.textContent = labelText;

        const input = document.createElement("input");
        input.type = "text";
        input.className = "ca-input";
        input.value = value || "";
        input.addEventListener("input", () => onChange(input.value));

        wrap.append(label, input);

        if (descriptionText) {
            const description = document.createElement("span");
            description.className = "ca-field-description";
            description.textContent = descriptionText;
            wrap.appendChild(description);
        }

        return wrap;
    }

    select(labelText, value, onChange, options) {
        const wrap = document.createElement("label");
        wrap.className = "ca-field";

        const label = document.createElement("span");
        label.className = "ca-field-label";
        label.textContent = labelText;

        const select = document.createElement("select");
        select.className = "ca-select";

        options.forEach(([optionValue, optionText]) => {
            const option = document.createElement("option");
            option.value = optionValue;
            option.textContent = optionText;
            option.selected = String(optionValue) === String(value);
            select.appendChild(option);
        });

        select.addEventListener("change", () => onChange(select.value));
        wrap.append(label, select);
        return wrap;
    }

    button(text, onClick, variant = "") {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `ca-button${variant ? ` ${variant}` : ""}`;
        button.textContent = text;
        button.addEventListener("click", onClick);
        return button;
    }
};
