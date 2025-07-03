export const temporal = {
    debounce: (fn, ms) => {
        let lastCall = 0;
        return (...args) => {
            const now = Date.now();
            if (now - lastCall >= ms) {
                lastCall = now;
                fn(...args);
            }
        };
    },

    debounceIdem: (fn, ms) => {
        let timer, lastKey;
        return (...args) => {
            const key = JSON.stringify(args);
            if (lastKey === key) return;
            lastKey = key;
            clearTimeout(timer);
            timer = setTimeout(() => fn(...args), ms);
        };
    },

    throttle: (fn, ms) => {
        let last = 0;
        return (...args) => {
            const now = Date.now();
            if (now - last >= ms) {
                last = now;
                fn(...args);
            }
        };
    }
};
