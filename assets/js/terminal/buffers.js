// Buffer collection — pure data management.
// Zero imports. Zero side effects. Every function returns a new value.
//
// A buffer is a plain value:
//   { id, name, content, mode, created, lastModified }
//
// A collection is a plain value:
//   { items: Map<id, buffer>, currentId: string | null }

const DEFAULT_CONTENT = `label 'hello.' 10\njmp 50`;
const DEFAULT_MODE = 'plang';
const DEFAULT_NAME = 'Papert';

// --- Construction ---

export const createCollection = (nameGen, idGen) => {
    const id = idGen();
    const buffer = {
        id,
        name: DEFAULT_NAME,
        content: DEFAULT_CONTENT,
        mode: DEFAULT_MODE,
        created: Date.now(),
        lastModified: Date.now(),
    };
    const items = new Map([[id, buffer]]);
    return { items, currentId: id };
};

export const loadCollection = (serialized, nameGen, idGen) => {
    const entries = Object.values(serialized || {});
    if (entries.length === 0) return createCollection(nameGen, idGen);

    const items = new Map();
    let currentId = null;

    for (const raw of entries) {
        const buffer = fillDefaults(raw, nameGen, idGen);
        items.set(buffer.id, buffer);
        if (raw.active) currentId = buffer.id;
    }

    if (!currentId) currentId = items.keys().next().value;

    return { items, currentId };
};

// --- Transitions (all return new collections) ---

export const addBuffer = (collection, opts = {}, nameGen, idGen) => {
    const id = idGen();
    const buffer = {
        id,
        name: opts.name || nameGen(),
        content: opts.content ?? '',
        mode: opts.mode ?? DEFAULT_MODE,
        created: Date.now(),
        lastModified: Date.now(),
    };
    const items = new Map(collection.items);
    items.set(id, buffer);
    return { collection: { items, currentId: id }, id };
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

export const renameCurrent = (collection, id, name) => {
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
    }));

// --- Serialization ---

export const serialize = (collection) => {
    const data = {};
    for (const [id, buffer] of collection.items) {
        data[id] = {
            id,
            name: buffer.name,
            active: collection.currentId === id,
            content: buffer.content,
            mode: buffer.mode,
            created: buffer.created,
            lastModified: buffer.lastModified,
        };
    }
    return data;
};

// --- Internal ---

const fillDefaults = (raw, nameGen, idGen) => ({
    id: raw.id ?? idGen(),
    name: raw.name ?? nameGen(),
    content: raw.content ?? DEFAULT_CONTENT,
    mode: raw.mode ?? DEFAULT_MODE,
    created: raw.created ?? Date.now(),
    lastModified: raw.lastModified ?? Date.now(),
});
