// Buffer persistence — localStorage read/write.
// Knows nothing about buffer shapes or defaults.
// That concern belongs to buffers.js.

export const createStorage = (namespace = "@paperlands.buffers@inner") => {
    const load = () => {
        try {
            const stored = localStorage.getItem(namespace);
            return stored ? JSON.parse(stored) : null;
        } catch (e) {
            console.warn('Storage load failed:', e);
            return null;
        }
    };

    const save = (data) => {
        try {
            localStorage.setItem(namespace, JSON.stringify(data));
            return true;
        } catch (e) {
            console.warn('Storage save failed:', e);
            return false;
        }
    };

    return { load, save };
};
