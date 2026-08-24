/**
 * @name CustomActivities
 * @author Haxurus
 * @version 1.0.0
 * @description Create, save and switch fully customized Discord Rich Presence activities directly from BetterDiscord.
 */

module.exports = class CustomActivities {
    constructor() {
        this.name = "CustomActivities";
        this.defaults = {autoStart:false, protectActivity:true, activeProfileId:null, profiles:[]};
        this.settings = Object.assign({}, this.defaults, BdApi.Data?.load?.(this.name,"settings") || BdApi.loadData?.(this.name,"settings") || {});
        if (!Array.isArray(this.settings.profiles)) this.settings.profiles = [];
        this.currentProfileId = null;
        this.originalHandler = null;
        this.action = null;
        this.startedAt = null;
    }

    start() {
        if (this.settings.autoStart && this.settings.activeProfileId) {
            setTimeout(() => this.activate(this.settings.activeProfileId, true), 1500);
        }
    }

    stop() { this.clear(false); }

    save() {
        if (BdApi.Data?.save) BdApi.Data.save(this.name,"settings",this.settings);
        else BdApi.saveData?.(this.name,"settings",this.settings);
    }

    toast(message,type="info") { BdApi.showToast?.(message,{type}); }

    module(predicate) {
        try { return BdApi.Webpack?.getModule?.(predicate,{searchExports:true}) || BdApi.findModule?.(predicate) || null; }
        catch { return null; }
    }

    profile(id) { return this.settings.profiles.find(p => p.id === id) || null; }

    blank() {
        return {
            id:`${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
            profileName:"New Activity", clientId:"", activityName:"", type:0, streamUrl:"",
            details:"", state:"", enableTimer:true,
            largeImageKey:"", largeImageText:"", smallImageKey:"", smallImageText:"",
            button1Label:"", button1Url:"", button2Label:"", button2Url:""
        };
    }

    validUrl(value) {
        try { const u = new URL(value); return u.protocol === "http:" || u.protocol === "https:"; }
        catch { return false; }
    }

    validate(p) {
        if (!/^\d{10,25}$/.test((p.clientId || "").trim())) throw new Error("Enter a valid Discord Application ID / Client ID.");
        if (Number(p.type) === 1 && p.streamUrl && !this.validUrl(p.streamUrl)) throw new Error("Streaming URL must be a valid http:// or https:// URL.");
        [[p.button1Label,p.button1Url,1],[p.button2Label,p.button2Url,2]].forEach(([label,url,n]) => {
            if ((label && !url) || (!label && url)) throw new Error(`Button ${n} requires both a label and a URL.`);
            if (label && label.length > 32) throw new Error(`Button ${n} label cannot exceed 32 characters.`);
            if (url && !this.validUrl(url)) throw new Error(`Button ${n} URL is invalid.`);
        });
    }

    async socket(clientId) {
        const validator = this.module(m => m && typeof m.validateSocketClient === "function");
        if (!validator) throw new Error("Discord RPC validator module was not found.");
        const socket = {
            application:{id:null,name:null,icon:null},
            authorization:{accessToken:null,authing:false,expires:new Date(0),scopes:[]},
            encoding:"json", transport:"ipc", id:"custom-activities", version:1
        };
        await validator.validateSocketClient.call(validator,socket,null,clientId);
        if (!socket.application?.id) throw new Error("Discord did not return application information for this Client ID.");
        return socket;
    }

    getAction() {
        const m = this.module(x => x?.SET_ACTIVITY && typeof x.SET_ACTIVITY.handler === "function");
        return m?.SET_ACTIVITY || null;
    }

    event(p,socket) {
        const app = socket.application || {};
        const activity = {
            name:(p.activityName || app.name || p.profileName || "Custom Activity").trim(),
            type:Number(p.type) || 0,
            application_id:p.clientId.trim(),
            timestamps:{}, assets:{}, buttons:[]
        };
        if (p.details?.trim()) activity.details = p.details.trim();
        if (p.state?.trim()) activity.state = p.state.trim();
        if (Number(p.type) === 1 && p.streamUrl?.trim()) activity.url = p.streamUrl.trim();
        if (p.enableTimer) activity.timestamps.start = this.startedAt || Date.now();
        if (p.largeImageKey?.trim()) {
            activity.assets.large_image = p.largeImageKey.trim();
            if (p.largeImageText?.trim()) activity.assets.large_text = p.largeImageText.trim();
        }
        if (p.smallImageKey?.trim()) {
            activity.assets.small_image = p.smallImageKey.trim();
            if (p.smallImageText?.trim()) activity.assets.small_text = p.smallImageText.trim();
        }
        if (p.button1Label?.trim() && p.button1Url?.trim()) activity.buttons.push({label:p.button1Label.trim(),url:p.button1Url.trim()});
        if (p.button2Label?.trim() && p.button2Url?.trim()) activity.buttons.push({label:p.button2Label.trim(),url:p.button2Url.trim()});
        return {
            isSocketConnected:() => true,
            socket:{transport:"ipc",id:socket.id || "custom-activities",version:socket.version || 1,encoding:socket.encoding || "json",application:{id:p.clientId.trim(),name:app.name || activity.name,icon:app.icon ?? null,coverImage:app.coverImage ?? null,flags:app.flags ?? 0}},
            cmd:"SET_ACTIVITY",
            args:{pid:require("process").pid,activity}
        };
    }

    async activate(id,silent=false) {
        const p = this.profile(id);
        if (!p) return;
        try {
            this.validate(p);
            if (this.currentProfileId && this.currentProfileId !== id) await this.clear(false);
            const socket = await this.socket(p.clientId.trim());
            const action = this.getAction();
            if (!action) throw new Error("Discord SET_ACTIVITY handler was not found.");
            if (!this.originalHandler || this.action !== action) { this.action = action; this.originalHandler = action.handler; }
            if (typeof this.originalHandler !== "function") throw new Error("Discord SET_ACTIVITY handler is unavailable.");
            this.startedAt = Date.now();
            if (this.settings.protectActivity) action.handler = () => {};
            await this.originalHandler.call(action,this.event(p,socket));
            this.currentProfileId = id;
            this.settings.activeProfileId = id;
            this.save();
            if (!silent) this.toast(`Activity "${p.profileName}" is now active.`,"success");
        } catch (e) {
            console.error(`[${this.name}]`,e);
            this.restoreHandler();
            this.toast(e?.message || "Failed to activate custom activity.","error");
        }
    }

    restoreHandler() {
        if (this.action && this.originalHandler) this.action.handler = this.originalHandler;
    }

    async clear(show=true) {
        try {
            if (this.originalHandler && this.action) {
                await this.originalHandler.call(this.action,{socket:{transport:"ipc"},cmd:"SET_ACTIVITY",args:{pid:require("process").pid}});
            }
        } catch (e) { console.warn(`[${this.name}] Failed to clear activity`,e); }
        this.restoreHandler();
        this.currentProfileId = null;
        this.startedAt = null;
        if (show) this.toast("Custom activity stopped.","success");
    }

    getSettingsPanel() {
        const root = document.createElement("div");
        root.style.cssText = "display:grid;gap:14px;color:var(--text-normal);padding-bottom:24px";

        const heading = document.createElement("div");
        heading.innerHTML = `<h2 style="margin:0;color:var(--header-primary)">Custom Activities</h2><p style="color:var(--text-muted);margin:5px 0 0">Create and switch Discord Rich Presence profiles without an external RPC program.</p>`;
        root.appendChild(heading);

        const global = document.createElement("div");
        global.style.cssText = "display:grid;gap:8px;padding:12px;border-radius:8px;background:var(--background-secondary)";
        global.append(this.check("Auto-start selected profile when the plugin starts",this.settings.autoStart,v=>{this.settings.autoStart=v;this.save();}));
        global.append(this.check("Protect the custom activity from being overwritten while active",this.settings.protectActivity,v=>{this.settings.protectActivity=v;this.save();}));
        root.appendChild(global);

        const toolbar = document.createElement("div"); toolbar.style.cssText = "display:flex;gap:8px;flex-wrap:wrap";
        toolbar.append(this.button("Add Activity",()=>{const p=this.blank();this.settings.profiles.push(p);this.save();root.replaceWith(this.getSettingsPanel());}),this.button("Stop Activity",()=>this.clear(true)));
        root.appendChild(toolbar);

        if (!this.settings.profiles.length) {
            const empty = document.createElement("div"); empty.textContent = "No profiles yet. Click Add Activity to create one.";
            empty.style.cssText = "padding:18px;border-radius:8px;background:var(--background-secondary);color:var(--text-muted)";
            root.appendChild(empty); return root;
        }

        this.settings.profiles.forEach(p => root.appendChild(this.profileCard(p,root)));
        return root;
    }

    profileCard(p,root) {
        const card = document.createElement("div");
        card.style.cssText = "display:grid;gap:12px;padding:14px;border-radius:10px;background:var(--background-secondary)";
        const title = document.createElement("div"); title.style.cssText = "display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap";
        title.innerHTML = `<strong style="color:var(--header-primary)">${this.escape(p.profileName || "Unnamed Activity")}</strong>`;
        const actions = document.createElement("div"); actions.style.cssText = "display:flex;gap:8px";
        actions.append(this.button(this.currentProfileId===p.id?"Active":"Activate",()=>this.activate(p.id)),this.button("Delete",()=>{this.settings.profiles=this.settings.profiles.filter(x=>x.id!==p.id);if(this.settings.activeProfileId===p.id)this.settings.activeProfileId=null;this.save();root.replaceWith(this.getSettingsPanel());},true));
        title.appendChild(actions); card.appendChild(title);

        const grid = document.createElement("div"); grid.style.cssText = "display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px";
        const add = (label,key,desc="") => grid.appendChild(this.field(label,p[key]||"",v=>{p[key]=v;this.save();},desc));
        add("Profile Name","profileName"); add("Discord Application ID","clientId","Create an application in the Discord Developer Portal and paste its Application ID here.");
        add("Activity Name","activityName");
        grid.appendChild(this.select("Activity Type",p.type,v=>{p.type=Number(v);this.save();},[[0,"Playing"],[1,"Streaming"],[2,"Listening"],[3,"Watching"],[5,"Competing"]]));
        add("Streaming URL","streamUrl"); add("Details","details"); add("State","state");
        add("Large Image Key","largeImageKey"); add("Large Image Text","largeImageText"); add("Small Image Key","smallImageKey"); add("Small Image Text","smallImageText");
        add("Button 1 Label","button1Label"); add("Button 1 URL","button1Url"); add("Button 2 Label","button2Label"); add("Button 2 URL","button2Url");
        grid.appendChild(this.check("Show elapsed timer",p.enableTimer,v=>{p.enableTimer=v;this.save();}));
        card.appendChild(grid);
        return card;
    }

    field(label,value,onChange,description="") {
        const wrap=document.createElement("label");wrap.style.cssText="display:flex;flex-direction:column;gap:5px;min-width:0";
        const l=document.createElement("span");l.textContent=label;l.style.cssText="font-size:12px;font-weight:700;color:var(--header-secondary)";
        const i=document.createElement("input");i.type="text";i.value=value;i.style.cssText="box-sizing:border-box;width:100%;min-height:38px;border:1px solid var(--background-modifier-accent);border-radius:6px;padding:8px 10px;background:var(--input-background,var(--background-tertiary));color:var(--text-normal)";i.addEventListener("input",()=>onChange(i.value));
        wrap.append(l,i);if(description){const d=document.createElement("small");d.textContent=description;d.style.color="var(--text-muted)";wrap.appendChild(d);}return wrap;
    }

    select(label,value,onChange,options) {
        const wrap=document.createElement("label");wrap.style.cssText="display:flex;flex-direction:column;gap:5px";
        const l=document.createElement("span");l.textContent=label;l.style.cssText="font-size:12px;font-weight:700;color:var(--header-secondary)";
        const s=document.createElement("select");s.style.cssText="min-height:38px;border:1px solid var(--background-modifier-accent);border-radius:6px;padding:8px;background:var(--input-background,var(--background-tertiary));color:var(--text-normal)";
        options.forEach(([v,t])=>{const o=document.createElement("option");o.value=v;o.textContent=t;o.selected=String(v)===String(value);s.appendChild(o);});s.addEventListener("change",()=>onChange(s.value));wrap.append(l,s);return wrap;
    }

    check(label,checked,onChange) {
        const w=document.createElement("label");w.style.cssText="display:flex;gap:8px;align-items:center;cursor:pointer";const i=document.createElement("input");i.type="checkbox";i.checked=!!checked;i.addEventListener("change",()=>onChange(i.checked));const s=document.createElement("span");s.textContent=label;w.append(i,s);return w;
    }

    button(text,onClick,danger=false) {
        const b=document.createElement("button");b.type="button";b.textContent=text;b.style.cssText=`border:0;border-radius:6px;padding:8px 12px;font-weight:600;cursor:pointer;background:${danger?"var(--status-danger)":"var(--brand-experiment,var(--brand-500))"};color:white`;b.addEventListener("click",onClick);return b;
    }

    escape(value) {
        return String(value ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
    }
};
