// Buffer collection — pure data management.
// Zero imports. Zero side effects. Every function returns a new value.
//
// A buffer is a plain value:
//   { id, work_id, name, content, mode, created, lastModified, origin }
//   origin: null | { id, addr, source, time, name } — fork lineage
//   work_id: the work this tab is of — a mint, hex64 (id:kb-work, id:kb-2a).
//            UI-only buffer.id never reaches the log; work_id becomes target.
//
// A collection is a plain value:
//   { items: Map<id, buffer>, currentId: string | null }
//
// Mints arrive as one bag — { name, id, work } — so the next continuant is free
// instead of a fourth positional everywhere (id:kb-2a). This file stays
// zero-import. Blank tab mints a new river; same-river / fork-from-keep rejoins
// via opts.work_id = parent.work_id | keep.target.

const DEFAULT_CONTENT = `label 'hello.' 10\njmp 50`;
const DEFAULT_MODE = 'plang';
const DEFAULT_NAME = 'Papert';

// --- Construction ---

export const createCollection = (mints) => {
    const id = mints.id();
    const buffer = {
        id,
        work_id: mints.work(),
        name: DEFAULT_NAME,
        content: DEFAULT_CONTENT,
        mode: DEFAULT_MODE,
        attend: null,
        created: Date.now(),
        lastModified: Date.now(),
    };
    const items = new Map([[id, buffer]]);
    return { items, currentId: id };
};

export const loadCollection = (serialized, mints) => {
    const entries = Object.values(serialized || {});
    if (entries.length === 0) return createCollection(mints);

    const items = new Map();
    let currentId = null;

    for (const raw of entries) {
        const buffer = fillDefaults(raw, mints);
        items.set(buffer.id, buffer);
        if (raw.active) currentId = buffer.id;
    }

    if (!currentId) currentId = items.keys().next().value;

    return { items, currentId };
};

// --- Transitions (all return new collections) ---

// A blank tab is a NEW river (id:kb-vet2-work). Pass opts.work_id to rejoin
// an existing one (same river, or fork-from-keep).
export const addBuffer = (collection, opts = {}, mints) => {
    const id = mints.id();
    const buffer = {
        id,
        work_id: opts.work_id ?? mints.work(),
        name: opts.name || mints.name(),
        content: opts.content ?? '',
        mode: opts.mode ?? DEFAULT_MODE,
        origin: opts.origin ?? null,
        attend: null,
        created: Date.now(),
        lastModified: Date.now(),
    };
    const items = new Map(collection.items);
    items.set(id, buffer);
    return { collection: { items, currentId: collection.currentId }, id };
};

export const removeBuffer = (collection, id) => {
    if (!collection.items.has(id)) return collection;
    if (collection.items.size <= 1) return collection;

    const items = new Map(collection.items);
    items.delete(id);

    let currentId = collection.currentId;
    if (currentId === id) {
        const ids = Array.from(collection.items.keys());
        const idx = ids.indexOf(id);
        currentId = ids[idx + 1] || ids[idx - 1];
    }

    return { items, currentId };
};

export const selectCurrent = (collection, id) => {
    if (!collection.items.has(id)) return collection;
    return { items: collection.items, currentId: id };
};

export const renameBuffer = (collection, id, name) => {
    if (!collection.items.has(id)) return collection;
    const items = new Map(collection.items);
    const buffer = { ...items.get(id), name, lastModified: Date.now() };
    items.set(id, buffer);
    return { items, currentId: collection.currentId };
};

export const updateContent = (collection, id, content) => {
    if (!collection.items.has(id)) return collection;
    const items = new Map(collection.items);
    const buffer = { ...items.get(id), content, lastModified: Date.now() };
    items.set(id, buffer);
    return { items, currentId: collection.currentId };
};

// Where the reader last was in this buffer — an offset, not a line: this never
// crosses the reflect projection a friend's attention does, so there is nothing
// to translate. Attention that DOES cross the seam is line-addressed instead
// (attention is the address, D021).
export const updateAttend = (collection, id, offset) => {
    if (!collection.items.has(id)) return collection;
    const items = new Map(collection.items);
    items.set(id, { ...items.get(id), attend: offset });
    return { items, currentId: collection.currentId };
};

// --- Navigation ---

export const nextId = (collection) => {
    const ids = Array.from(collection.items.keys());
    const idx = ids.indexOf(collection.currentId);
    return ids[(idx + 1) % ids.length];
};

export const prevId = (collection) => {
    const ids = Array.from(collection.items.keys());
    const idx = ids.indexOf(collection.currentId);
    return ids[idx === 0 ? ids.length - 1 : idx - 1];
};

// --- Query ---

export const currentBuffer = (collection) =>
    collection.currentId ? collection.items.get(collection.currentId) ?? null : null;

export const bufferList = (collection) =>
    Array.from(collection.items.values()).map(b => ({
        id: b.id,
        name: b.name,
        mode: b.mode,
        active: b.id === collection.currentId,
        modified: b.lastModified,
        hasOrigin: b.origin !== null,
    }));

// --- Serialization ---

export const serialize = (collection) => {
    const data = {};
    for (const [id, buffer] of collection.items) {
        data[id] = {
            id,
            work_id: buffer.work_id,
            name: buffer.name,
            active: collection.currentId === id,
            content: buffer.content,
            mode: buffer.mode,
            attend: buffer.attend ?? null,
            origin: buffer.origin ?? null,
            created: buffer.created,
            lastModified: buffer.lastModified,
        };
    }
    return data;
};

// --- Internal ---

// ?? mints.work() is the whole migration (id:kb-2a): buffers already in
// localStorage have no work_id; first load mints one and it sticks.
const fillDefaults = (raw, mints) => ({
    id: raw.id ?? mints.id(),
    work_id: raw.work_id ?? mints.work(),
    name: raw.name ?? mints.name(),
    content: raw.content ?? DEFAULT_CONTENT,
    mode: raw.mode ?? DEFAULT_MODE,
    attend: raw.attend ?? null,
    origin: raw.origin ?? null,
    created: raw.created ?? Date.now(),
    lastModified: raw.lastModified ?? Date.now(),
});
