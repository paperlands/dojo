// Page link + fork ladder (id:la-not). Only location.search reader in the tree.

import { createLink, SERVER } from "./kernel/link.js"
import { name, read, V } from "./keep/entry.js"
import { checkKeepProof } from "./keep/auth.js"
import { newerKeep, ofWork } from "./keep/work.js"
import { REACH } from "./keep/page.js"
import { accept } from "./keep/shared.js"
import { resolve } from "./weave/resolve.js"
import { copyChoices, validChoices } from "./turtling/laws/hand_choices.js"

export const WORDS = Object.freeze({
    clan: SERVER,
    fork: "hooks/shell/inner.js",
    action: "hooks/shell/river.js",
    weave: "hooks/shell/weave.js",
    perf: "hooks/shell/inner.js",
    reveal: "hooks/shell/inner.js",
})

export const link = createLink(
    typeof location === "undefined" ? "" : location.search,
    (qs) => history.replaceState(
        history.state,
        "",
        `${location.pathname}${qs ? `?${qs}` : ""}${location.hash}`,
    ),
    { words: WORDS },
)

const HEX64 = /^[0-9a-f]{64}$/

/** Mint reading intent beside the fork owner, not in the address engine. */
export function shareForkRef(bytes, { headId = null, origin = null, proof = null, originProof = null } = {}) {
    if (typeof bytes !== "string" || !bytes) return null
    const id = name(bytes)
    try {
        const value = read(bytes)
        const work = value.target ?? id
        const birth = origin ?? (value.target == null ? bytes : null)
        // Evidence is supplied by the copy owner; no self-origin shortcut without it.
        const evidenced = proof != null && (birth === bytes || originProof != null)
        if (id === headId && evidenced && originOf(birth, work) && memberOf(bytes, birth, work)) {
            return `work:${work}`
        }
    } catch {
        // Opaque retained bytes still have an exact address.
    }
    return `keep:${id}`
}

/** Exact keep, evidenced work, deprecated bare reference, or corpus word. */
export async function forkRef(ref, doors = {}) {
    const { door, term, corpus, pull, pullWork, pullLegacy = pull, say = note } = doors
    if (typeof ref !== "string" || !ref) return null
    if (!term) { say("no terminal standing"); return null }
    try {
        if (ref.startsWith("keep:") || ref.startsWith("work:")) {
            const cut = ref.indexOf(":")
            const mode = ref.slice(0, cut)
            const id = ref.slice(cut + 1)
            if (!HEX64.test(id)) { say("invalid kept reference"); return null }
            if (!door) { say("no door standing"); return null }
            const mine = await mineOf(door)
            const face = mode === "keep"
                ? await keepFace(id, { door, pull, say, mine })
                : await workFace(id, { door, pull, pullWork, say, mine })
            if (!face) return null
            say(mode === "keep" ? "opening exact kept moment" : "opening newest known kept state")
            const picture = await openPicture(face, { door, ref: id, say })
            if (!picture) return null
            return landHand(term, say, id, picture)
        }
        if (ref.includes(":")) { say("unknown kept reference reading"); return null }
        if (HEX64.test(ref)) {
            if (!door) { say("no door standing"); return null }
            say("using legacy link reader; the address does not state its reading")
            const face = await holdLegacyFace(ref, { door, pull: pullLegacy, say })
            if (!face) return null
            const work = face.bytes ? await classifiedWork(door, face.bytes, ref) : null
            const alias = face.bytes ? (read(face.bytes).target ?? ref) : ref
            const picture = await openPicture({ ...face, work, alias }, { door, ref, say })
            if (!picture) return null
            return landHand(term, say, ref, picture)
        }
        return await forkCorpus(ref, { term, corpus, say })
    } catch (err) {
        say("the door refused", err)
        return null
    }
}

function note(...args) {
    console.debug("[link fork]", ...args)
}

export async function pullKeep(ref) {
    return fetchKept(ref, "keep")
}

export async function pullWork(ref) {
    return fetchKept(ref, "work")
}

export async function pullLegacy(ref) {
    return fetchKept(ref)
}

// Lazy read-only river page for a work. The server owns the cursor and bound.
export async function pullHistory(ref, { of = "target", n = REACH, fetchImpl = fetch } = {}) {
    if (!HEX64.test(ref)) return null
    try {
        const res = await fetchImpl(`/keeps/${ref}/history?of=${encodeURIComponent(of)}&n=${encodeURIComponent(n)}`, {
            headers: { accept: "application/json" },
        })
        if (!res.ok) return null
        return res.json()
    } catch {
        return null
    }
}

async function fetchKept(ref, reading = null) {
    if (!HEX64.test(ref)) return null
    const suffix = reading ? `?read=${reading}` : ""
    const res = await fetch(`/keeps/${ref}${suffix}`, { headers: { accept: "application/json" } })
    if (!res.ok || (reading && res.headers?.get?.("x-dojo-keep-read") !== reading)) return null
    return res.json()
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

// Same-origin current availability only: content type + non-empty PNG signature.
// This is not an author image commitment.
export async function pullImage(id, { fetchImpl = fetch } = {}) {
    if (!HEX64.test(id)) return null
    let res
    try {
        res = await fetchImpl(`/keeps/${id}/image`, { headers: { accept: "image/png" } })
    } catch {
        return null
    }
    if (!res?.ok) return null
    const type = res.headers?.get?.("content-type") ?? ""
    if (!/^image\/png(?:\s*;|$)/i.test(type)) return null
    let bytes
    try {
        bytes = new Uint8Array(await res.arrayBuffer())
    } catch {
        return null
    }
    if (bytes.length < PNG_SIG.length || !PNG_SIG.every((b, i) => bytes[i] === b)) return null
    return { bytes, type }
}

async function liveExact(id, { pull, image, check, needImage = true }) {
    let got
    try {
        got = await pull(id)
    } catch {
        return null
    }
    if (!got || got.id !== id || typeof got.message !== "string" || name(got.message) !== id) return null
    const decoded = readConstruction(got.message)
    if (decoded.refusal) return null
    if (typeof got.source !== "string" || name(got.source) !== decoded.value.source_id) return null
    if (!got.proof) return null
    try {
        await check(got.message, got.proof)
    } catch {
        return null
    }
    if (needImage) {
        let preview
        try {
            preview = await image(id)
        } catch {
            return null
        }
        if (!preview) return null
    }
    return { id, message: got.message, source: got.source, proof: got.proof, target: decoded.value.target ?? null }
}

function sameProof(a, b) {
    return a === b || (a?.v === b?.v && a?.genesis === b?.genesis && a?.signature === b?.signature)
}
// A head record with fields must bind to the exact selected reading; an
// id-only record is the test seam, not a contradictory full record.
function headMatches(head, exact) {
    if (head?.id !== exact.id) return false
    if (head.message !== undefined && head.message !== exact.message) return false
    if (head.source !== undefined && head.source !== exact.source) return false
    if (head.proof !== undefined && !sameProof(head.proof, exact.proof)) return false
    return true
}

// The copy owner's one live gate. Same-origin HTTP only, no peer fanout.
export async function liveForkRef({
    id,
    work = null,
    pull = pullKeep,
    head = pullWork,
    image = pullImage,
    check = checkKeepProof,
} = {}) {
    if (!HEX64.test(id)) return null
    const exact = await liveExact(id, { pull, image, check })
    if (!exact) return null

    const intent = typeof work === "string" && HEX64.test(work)
        ? (typeof exact.target === "string" && HEX64.test(exact.target) ? exact.target : work)
        : null
    let selectedHead = null
    let origin = null
    let headOk = false
    if (intent) {
        try {
            selectedHead = await head(intent)
        } catch {
            selectedHead = null
        }
        headOk = selectedHead?.id === id && headMatches(selectedHead, exact)
        if (headOk) {
            origin = intent === id ? exact : await liveExact(intent, { pull, image, check, needImage: false })
        }
    }

    const headId = headOk ? id : null
    return shareForkRef(exact.message, {
        headId,
        origin: origin?.message ?? null,
        proof: exact.proof,
        originProof: origin?.proof ?? null,
    })
}

function originOf(bytes, work) {
    if (typeof bytes !== "string" || name(bytes) !== work) return false
    try {
        const value = read(bytes)
        return value.target == null && typeof value.root === "string" && HEX64.test(value.root)
    } catch {
        return false
    }
}

function memberOf(bytes, origin, work) {
    if (!originOf(origin, work)) return false
    try {
        const value = read(bytes)
        return name(bytes) === work || (value.target === work && value.root === read(origin).root)
    } catch {
        return false
    }
}
// Evidence is a retained proof; a root failure must not block exact reads.
async function retained(door, bytes) {
    try {
        return (await door.proof(bytes)) ?? null
    } catch {
        return null
    }
}

async function mineOf(door) {
    try {
        return await door.root()
    } catch {
        return null
    }
}
// One classification door: exact bytes are borrowable, automatic work needs evidence.
async function classifiedWork(door, bytes, ref) {
    const value = read(bytes)
    if (!await retained(door, bytes)) return null
    if (value.target == null) return originOf(bytes, ref) ? ref : null
    if (!HEX64.test(value.target)) return null
    const birth = await door.get(value.target)
    if (typeof birth !== "string" || !await retained(door, birth)) return null
    return memberOf(bytes, birth, value.target) ? value.target : null
}

async function exactFace(ref, { door, pull, say, mine }) {
    const held = await door.get(ref)
    if (typeof held === "string") {
        if (name(held) === ref) return { bytes: held, source: null, mine }
        say("stored bytes do not match their name")
    }
    const got = await askRoom(ref, { pull, say }, false)
    if (!got) return null
    await keepPulled(door, got, say)
    return { bytes: got.bytes, source: got.source, mine }
}

async function keepFace(ref, context) {
    const face = await exactFace(ref, context)
    if (!face) return null
    const value = read(face.bytes)
    const proof = await retained(context.door, face.bytes)
    if (value.target == null) {
        return { ...face, work: proof && originOf(face.bytes, ref) ? ref : null }
    }
    const birth = HEX64.test(value.target)
        ? await exactFace(value.target, { ...context, say: () => {} })
        : null
    const evidenced = proof && birth && await retained(context.door, birth.bytes)
    const work = evidenced && memberOf(face.bytes, birth.bytes, value.target) ? value.target : null
    return { ...face, work }
}

async function workFace(work, { door, pull, pullWork: head, say, mine }) {
    const birth = await exactFace(work, { door, pull, say, mine })
    if (!birth || !originOf(birth.bytes, work) || !await retained(door, birth.bytes)) {
        say("no evidenced origin for this work; open an exact kept moment instead")
        return null
    }
    const origin = birth.bytes
    const originRoot = read(origin).root
    let bytes = origin
    for (const held of await door.list(originRoot, REACH)) {
        if (memberOf(held, origin, work) && await retained(door, held)) {
            bytes = newerKeep(bytes, held)
        }
    }
    const got = await askRoom(work, { pull: head, say: () => {} }, true)
    if (got && !memberOf(got.bytes, origin, work)) {
        say("the room answered a nonmember of this work")
    } else if (got && got.proof != null && newerKeep(bytes, got.bytes) === got.bytes) {
        // Missing/invalid incoming proof cannot advance; a verified pull can.
        if (await keepPulled(door, got, say)) {
            return { bytes: got.bytes, source: got.source, mine, work }
        }
    } else if (got && got.proof == null && newerKeep(bytes, got.bytes) === got.bytes) {
        say("unproven room answer ignored")
    }
    return { bytes, source: bytes === origin ? birth.source : null, mine, work }
}

async function holdLegacyFace(ref, { door, pull, say }) {
    const mine = await mineOf(door)
    const asKeep = await door.get(ref)
    if (asKeep && name(asKeep) === ref) return { bytes: asKeep, source: null, mine }
    // Bounded local alias lookup: availability without authentication.
    const local = mine == null ? null : ofWork(await door.list(mine, REACH), ref)[0] ?? null
    if (local) {
        const got = await askRoom(ref, { pull, say: () => {} }, true)
        if (!got || newerKeep(local, got.bytes) !== got.bytes) return { bytes: local, source: null, mine }
        if (await keepPulled(door, got, say)) return { bytes: got.bytes, source: got.source, mine }
        return { bytes: local, source: null, mine }
    }
    const got = await askRoom(ref, { pull, say }, true)
    if (!got) return { bytes: null, source: null, mine }
    await keepPulled(door, got, say)
    return { bytes: got.bytes, source: got.source, mine }
}

const REFUSAL = Object.freeze({
    unreadable: "unreadable keep bytes; raw bytes preserved",
    newer: "this keep needs a newer reader; raw bytes preserved",
    unsupported: "unsupported keep envelope; raw bytes preserved",
    kind: "this keep kind is not a construction; raw bytes preserved",
    choices: "the kept choices are unreadable; this construction is not opened",
})

// One current-construction reader: version, kind and choices live here, not in
// a carrier and not in a second gate. Source identity is checked by the caller.
function readConstruction(bytes) {
    let value
    try {
        value = read(bytes)
    } catch {
        return { refusal: "unreadable" }
    }
    if (value?.v !== V) return { refusal: value?.v > V ? "newer" : "unsupported" }
    if (value.kind !== "snap") return { refusal: "kind" }
    const hasChoices = Object.hasOwn(value, "choices")
    if (hasChoices && value.choices != null && !validChoices(value.choices)) {
        return { refusal: "choices" }
    }
    return { value, choices: hasChoices ? copyChoices(value.choices) : undefined }
}

async function openPicture(face, { door, ref, say }) {
    const { bytes, mine } = face
    if (!bytes) {
        return { work: ref, bytes: null, source: null, mine, title: null, root: null, ts: null }
    }
    const decoded = readConstruction(bytes)
    if (decoded.refusal) {
        say(REFUSAL[decoded.refusal])
        return null
    }
    const value = decoded.value
    const work = face.work
    let source = face.source
    if (source == null) {
        try {
            source = value.source_id ? await door.source(value.source_id) : null
        } catch {
            source = null
        }
    }
    source = verifiedSource(source, value, say)
    if (source == null) say(`no source held for ${name(bytes)}`)
    const choices = decoded.choices
    return {
        work, bytes, source, mine,
        addr: face.alias ?? work,
        title: typeof value.title === "string" ? value.title : null,
        root: value.root,
        ts: value.ts,
        choices,
    }
}

function verifiedSource(source, value, say) {
    if (typeof source !== "string") return null
    if (name(source) === value.source_id) return source
    say("source bytes do not match the kept source reference")
    return null
}

function landHand(term, say, ref, picture) {
    if (picture.bytes && (picture.root !== picture.mine || picture.work == null)) {
        const { work, bytes, source, title, root, ts, choices } = picture
        const landed = term.forkBuffer({
            source,
            name: title ?? "kept",
            root: typeof root === "string" && root ? root : undefined,
            addr: picture.addr ?? work ?? name(bytes),
            time: ts?.t ?? Date.now(),
            land: true,
            base_id: name(bytes),
            ...(choices !== undefined ? { choices } : {}),
        }) ?? null
        if (!landed) say(`nothing kept as ${ref}`)
        return landed
    }
    const { work, bytes, source, title, choices } = picture
    const landed = term.forkKeep({
        work_id: work, source, name: title, land: true,
        base_id: bytes ? name(bytes) : null,
        ...(choices !== undefined ? { choices } : {}),
    })
    if (!landed) say(`nothing kept as ${ref}`)
    return landed
}

async function keepPulled(door, got, say) {
    try {
        await accept(door, got.bytes, got.fact, {
            ...(got.source != null ? { source: got.source } : {}),
            ...(got.proof != null ? { proof: got.proof } : {}),
        })
        return true
    } catch (err) {
        say("pulled, not kept", err)
        return false
    }
}

// The requested reading, not cache presence, determines what counts as an answer.
async function askRoom(ref, { pull, say }, legacyOrWork) {
    if (!pull) return null
    let got
    try { got = await pull(ref) } catch { got = null }
    if (got == null) { say(`the requested kept reading is unavailable for ${ref}`); return null }
    if (typeof got.message !== "string") { say("the room answered a shape we cannot read"); return null }
    let value
    try { value = read(got.message) } catch { say("the room answered unreadable bytes"); return null }
    const id = name(got.message)
    if (got.id !== id || (id !== ref && (!legacyOrWork || value.target !== ref))) {
        say("the room answered the wrong bytes")
        return null
    }
    return {
        bytes: got.message,
        proof: got.proof,
        source: verifiedSource(got.source, value, say),
        fact: Number.isFinite(got.at)
            ? { at: got.at, node: typeof got.node === "string" ? got.node : "" }
            : null,
    }
}

async function forkCorpus(word, { term, corpus, say }) {
    if (!corpus) { say("no corpus standing"); return null }
    let index = null
    try { index = await corpus.index() } catch { index = null }
    const r = resolve(word, { ambients: [], index })
    if (r.kind !== "fragment") { say(`nothing in the corpus called ${word}`); return null }
    const text = await corpus.fetch(r.name)
    if (typeof text !== "string") { say(`${r.name} has no page`); return null }
    const { title, source } = corpus.press(text)
    return term.forkBuffer({ source, name: title ?? r.name, addr: `~/${r.name}`, land: true }) ?? null
}
