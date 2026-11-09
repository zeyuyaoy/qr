"use client";
import {useMemo} from "react";
import {Field, NativeSelect, TextField} from "@/components/ui/field";
import {Switch} from "@/components/ui/switch";
import {Textarea} from "@/components/ui/textarea";
import {timeZones} from "@/lib/client/time";
import {SOCIAL_PLATFORMS, TYPES} from "@/lib/qr/payload";
import {CONTENT_TYPES, type ContentType} from "@/lib/schema";

export function TypePicker({value, onChange}: { value: ContentType; onChange: (t: ContentType) => void }) {
    return (
        <label className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
            <span className="font-medium">Content type</span>
            <NativeSelect className="h-11 w-auto max-w-full" value={value}
                          onChange={(e) => onChange(e.target.value as ContentType)}>
                {CONTENT_TYPES.map((t) => <option key={t} value={t}>{TYPES[t].label}</option>)}
            </NativeSelect>
        </label>
    );
}

type F = Record<string, unknown>;
type Props = {
    type: ContentType;
    fields: F;
    errors: Record<string, string>;
    onChange: (f: F) => void;
    onTouch: (k: string) => void;
    timezone: string
};
const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

export function TypeFields({type, fields, errors, onChange, onTouch, timezone}: Props) {
    const set = (k: string, v: unknown) => onChange({...fields, [k]: v});
    const ex = TYPES[type].example as F;
    const tf = (k: string, label: string, o: {
        type?: string;
        inputMode?: React.ComponentProps<"input">["inputMode"];
        hint?: string;
        autoComplete?: string
    } = {}) => (
        <TextField key={k} label={label} type={o.type ?? "text"} inputMode={o.inputMode}
                   autoComplete={o.autoComplete ?? "off"} spellCheck={false} value={str(fields[k])}
                   placeholder={str(ex[k])} hint={o.hint} error={errors[k]} onBlur={() => onTouch(k)}
                   onChange={(e) => set(k, e.target.value)} name={k}/>
    );
    const area = (k: string, label: string, rows = 3) => (
        <Field key={k} label={label} error={errors[k]}>{(a) => <Textarea {...a} rows={rows} name={k}
                                                                         value={str(fields[k])} placeholder={str(ex[k])}
                                                                         onBlur={() => onTouch(k)}
                                                                         onChange={(e) => set(k, e.target.value)}/>}</Field>
    );
    const zones = useMemo(() => timeZones(), []);

    switch (type) {
        case "url":
            return <div className="grid gap-3">{tf("url", "Website address", {type: "url", inputMode: "url"})}</div>;
        case "text":
            return <div className="grid gap-3">{area("text", "Text", 5)}<p
                className="text-xs text-muted-foreground">{str(fields.text).length}/2000 characters</p></div>;
        case "email":
            return <div className="grid gap-3">{tf("to", "Email address", {
                type: "email",
                inputMode: "email",
                autoComplete: "email"
            })}{tf("subject", "Subject (optional)")}{area("body", "Message (optional)")}</div>;
        case "phone":
            return <div className="grid gap-3">{tf("number", "Phone number", {
                type: "tel",
                inputMode: "tel",
                hint: "Include the country code, e.g. +1 415 555 0132"
            })}</div>;
        case "sms":
            return <div className="grid gap-3">{tf("number", "Phone number", {
                type: "tel",
                inputMode: "tel"
            })}{area("message", "Message (optional)")}</div>;
        case "wifi":
            return (
                <div className="grid gap-3">
                    {tf("ssid", "Network name (SSID)")}
                    <Field label="Security">{(a) => <NativeSelect {...a} value={str(fields.security) || "WPA"}
                                                                  onChange={(e) => set("security", e.target.value)}>
                        <option value="WPA">WPA / WPA2 / WPA3</option>
                        <option value="WEP">WEP</option>
                        <option value="nopass">No password</option>
                    </NativeSelect>}</Field>
                    {(str(fields.security) || "WPA") !== "nopass" && tf("password", "Password", {
                        type: "text",
                        autoComplete: "off",
                        hint: "Shown in clear so you can check it. Anyone who scans the code can read it."
                    })}
                    <label className="flex items-center justify-between gap-3 text-sm">Hidden network<Switch
                        checked={fields.hidden === true} onCheckedChange={(v) => set("hidden", v)}
                        aria-label="Hidden network"/></label>
                </div>
            );
        case "vcard":
            return (
                <div className="grid gap-3">
                    <div
                        className="grid gap-3 sm:grid-cols-2">{tf("firstName", "First name", {autoComplete: "given-name"})}{tf("lastName", "Last name", {autoComplete: "family-name"})}</div>
                    <div
                        className="grid gap-3 sm:grid-cols-2">{tf("org", "Organisation")}{tf("title", "Job title")}</div>
                    <div className="grid gap-3 sm:grid-cols-2">{tf("mobile", "Mobile", {
                        type: "tel",
                        inputMode: "tel"
                    })}{tf("phone", "Work phone", {type: "tel", inputMode: "tel"})}</div>
                    <div className="grid gap-3 sm:grid-cols-2">{tf("email", "Email", {
                        type: "email",
                        inputMode: "email"
                    })}{tf("url", "Website", {type: "url", inputMode: "url"})}</div>
                    {tf("street", "Street")}
                    <div
                        className="grid gap-3 sm:grid-cols-2">{tf("city", "City")}{tf("region", "State / region")}</div>
                    <div
                        className="grid gap-3 sm:grid-cols-2">{tf("postal", "Postal code")}{tf("country", "Country")}</div>
                    {area("note", "Note", 2)}
                </div>
            );
        case "event": {
            const allDay = fields.allDay === true;
            const dt = (k: "start" | "end", label: string) => (
                <TextField key={k} label={label} type={allDay ? "date" : "datetime-local"}
                           value={allDay ? str(fields[k]).slice(0, 10) : str(fields[k])} error={errors[k]}
                           onBlur={() => onTouch(k)} onChange={(e) => set(k, e.target.value)}/>
            );
            return (
                <div className="grid gap-3">
                    {tf("title", "Event title")}
                    <label className="flex items-center justify-between gap-3 text-sm">All-day<Switch checked={allDay}
                                                                                                      onCheckedChange={(v) => onChange({
                                                                                                          ...fields,
                                                                                                          allDay: v,
                                                                                                          start: str(fields.start).slice(0, 10),
                                                                                                          end: str(fields.end).slice(0, 10)
                                                                                                      })}
                                                                                                      aria-label="All-day event"/></label>
                    <div className="grid gap-3 sm:grid-cols-2">{dt("start", "Starts")}{dt("end", "Ends")}</div>
                    {!allDay && <Field label="Time zone" hint="The start/end times above are in this zone.">{(a) =>
                        <NativeSelect {...a} value={str(fields.timezone) || timezone}
                                      onChange={(e) => set("timezone", e.target.value)}>{[...new Set([str(fields.timezone) || timezone, ...zones])].map((z) =>
                            <option key={z} value={z}>{z}</option>)}</NativeSelect>}</Field>}
                    {tf("location", "Location (optional)")}
                    {area("description", "Description (optional)")}
                </div>
            );
        }
        case "geo":
            return <div className="grid gap-3">
                <div
                    className="grid gap-3 sm:grid-cols-2">{tf("lat", "Latitude", {inputMode: "decimal"})}{tf("lng", "Longitude", {inputMode: "decimal"})}</div>
                {tf("label", "Label (optional)")}</div>;
        case "whatsapp":
            return <div className="grid gap-3">{tf("phone", "WhatsApp number", {
                type: "tel",
                inputMode: "tel",
                hint: "International format with country code."
            })}{area("message", "Pre-filled message (optional)")}</div>;
        case "social": {
            const platform = str(fields.platform) || "instagram";
            return (
                <div className="grid gap-3">
                    <Field label="Network">{(a) => <NativeSelect {...a} value={platform} onChange={(e) => onChange({
                        ...fields,
                        platform: e.target.value
                    })}>{Object.entries(SOCIAL_PLATFORMS).map(([k, v]) => <option key={k}
                                                                                  value={k}>{v.label}</option>)}</NativeSelect>}</Field>
                    <TextField label={platform === "custom" ? "Profile URL" : "Handle"} value={str(fields.handle)}
                               placeholder={SOCIAL_PLATFORMS[platform]?.hint} error={errors.handle}
                               onBlur={() => onTouch("handle")} onChange={(e) => set("handle", e.target.value)}
                               spellCheck={false} autoComplete="off"/>
                </div>
            );
        }
        case "doi":
            return <div
                className="grid gap-3">{tf("doi", "DOI", {hint: "Paste a DOI like 10.1038/nature12373 or a doi.org link."})}</div>;
    }
}

export function emptyFields(type: ContentType, timezone: string): F {
    switch (type) {
        case "wifi":
            return {ssid: "", password: "", security: "WPA", hidden: false};
        case "event":
            return {title: "", start: "", end: "", allDay: false, timezone, location: "", description: ""};
        case "social":
            return {platform: "instagram", handle: ""};
        default:
            return {};
    }
}
