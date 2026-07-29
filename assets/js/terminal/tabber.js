import { createArena } from "../kernel/arena.js"

export class Tabber {
    constructor(containerId = 'tabs', scaffoldId = 'tab-scaffold-root') {
        this.container = document.getElementById(containerId);
        this.scaffold = document.getElementById(scaffoldId);
        this.template = this.scaffold.cloneNode(true);
        // One arena per tab — closed with the tab, never left behind.
        this._arenas = new Map();
    }

    addTab(id, name) {
        const clone = this.template.cloneNode(true);
        const tab = this.configureTab(clone, id, name);
        this.insertTab(tab);
        this.activateTab(tab);
        return tab;
    }


    configureTab(element, id, name) {
        const arena = createArena();
        this._arenas.set(id, arena);

        // Configure main element
        Object.assign(element, {
            id: `tab-scaffold-${id}`,
            style: { visibility: 'visible' }
        });

        element.classList.add('tab-instance');
        element.dataset.tabId = id;
        element.style.display = "flex" //scaffold is hidden

        // Configure input
        const input = element.querySelector('input');
        if (input) {
            input.id = `tab-input-name-${id}`;
            input.value = name;
            this.resizeInput(input);

            arena.on(input, 'blur', () => {
                    this.dispatch('phx:opBuffer', { op: 'rename', target: id });
            });

            arena.on(input, 'keydown', e => {
                if (e.key === 'Enter') {
                    input.blur();
                }
            });


        }

        // Configure close button
        const close = element.querySelector('.close');
        if (close) {
            arena.on(close, 'click', (e) => {
                e.stopPropagation()
                this.dispatch('phx:opBuffer', { op: 'close', target: id })
            });
        }

        // Shift+click activates ambient without switching editor.
        // Long-press on mobile does the same.
        let longPressTimer = null;
        let longPressed = false;

        arena.on(element, 'click', (e) => {
            if (longPressed) { longPressed = false; return; }
            if (e.shiftKey) {
                this.dispatch('phx:opBuffer', { op: 'activate', target: id })
            } else {
                this.dispatch('phx:opBuffer', { op: 'select', target: id })
            }
        });

        // Long-press timer is cancelled by touchend/move — not surface lifetime,
        // so it stays a local clearTimeout pair, not arena.timer.
        arena.on(element, 'touchstart', () => {
            longPressed = false;
            longPressTimer = setTimeout(() => {
                longPressed = true;
                this.dispatch('phx:opBuffer', { op: 'activate', target: id });
            }, 500);
        }, { passive: true });
        arena.on(element, 'touchend', () => clearTimeout(longPressTimer));
        arena.on(element, 'touchmove', () => clearTimeout(longPressTimer));

        return element;
    }

    insertTab(tab) {
        this.container.insertBefore(tab, this.container.lastElementChild);
    }

    activateTab(tab) {
        // Deactivate all tabs
        this.container.querySelectorAll('.tab-instance')
            .forEach(t => {t.removeAttribute('data-alive')
                           t.querySelector('.close').removeAttribute('data-alive', '')}
                    );

        // Activate target tab
        tab.setAttribute('data-alive', '');
        this.scrolltoTab(tab)
        tab.querySelector('.close').setAttribute('data-alive', '')
    }

    scrolltoTab(tab) {

        // Calculate scroll position to center the tab
        const tabLeft = tab.offsetLeft;
        const tabWidth = tab.offsetWidth;
        const containerWidth = this.container.clientWidth;
        const currentScroll = this.container.scrollLeft;

        // Position to center the tab
        const targetScroll = tabLeft - (containerWidth / 2) + (tabWidth / 2);

        // Ensure we don't scroll beyond boundaries
        const maxScroll = this.container.scrollWidth - containerWidth;
        const boundedScroll = Math.max(0, Math.min(targetScroll, maxScroll));

        this.container.scrollTo({
            left: boundedScroll,
            behavior: 'smooth'
        });

    }

    focusTab(tab){
        const input = tab.querySelector('input');
        if (input) {
            input.disabled = false;
            input.focus();
            input.select();
        }

    }

    selectTab(targetId) {
        const target = this.container.querySelector(`[data-tab-id="${targetId}"]`);
        if (target) this.activateTab(target);
    }

    // Read the tab input's current value — the input is the live editing
    // surface for the name during a rename; the collection commits it on blur
    // (terminal.renameBuffer). This reads; it does not rename.
    readTabName(targetId) {
        const tab = this.container.querySelector(`[data-tab-id="${targetId}"]`);
        if (!tab) return;
        const input = tab.querySelector('input');
        if (input) {
            return input.value
        }
    }

    // Mark a tab as having an active ambient (green indicator).
    setActive(targetId) {
        const tab = this.container.querySelector(`[data-tab-id="${targetId}"]`);
        tab?.setAttribute('data-active', '');
    }

    clearActive(targetId) {
        const tab = this.container.querySelector(`[data-tab-id="${targetId}"]`);
        tab?.removeAttribute('data-active');
    }

    clearAllActive() {
        this.container.querySelectorAll('.tab-instance[data-active]')
            .forEach(t => t.removeAttribute('data-active'));
    }

    closeTab(targetId) {
        const tab = this.container.querySelector(`[data-tab-id="${targetId}"]`);
        if (!tab) return;
        this._arenas.get(targetId)?.destroy();
        this._arenas.delete(targetId);
        tab.remove();
    }

    resizeInput(input) {
        const length = Math.max(input.value.length || input.placeholder.length, 2);
        input.style.width = `${length + 0.5}ch`;
    }

    dispatch(eventName, detail) {
        window.dispatchEvent(new CustomEvent(eventName, { detail }));
    }
}
