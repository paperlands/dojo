export class Tabber {
    constructor(containerId = 'tabs', scaffoldId = 'tab-scaffold-root') {
        this.container = document.getElementById(containerId);
        this.scaffold = document.getElementById(scaffoldId);
        this.template = this.scaffold.cloneNode(true);
    }

    handleOperation({ op, target }) {
        const operations = {
            add: () => this.addTab(),
            select: () => this.selectTab(target),
            rename: () => this.renameTab(target),
            close: () => this.closeTab(target)
        };

        operations[op]?.();
    }

    addTab(id, name) {
        const clone = this.template.cloneNode(true);
        const tab = this.configureTab(clone, id, name);
        this.insertTab(tab);
        this.activateTab(tab);
        return tab;
    }


    configureTab(element, id, name) {
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

            input.addEventListener('blur', e => {
                    this.dispatch('phx:opBuffer', { op: 'rename', target: id });
            });

            input.addEventListener('keydown', e => {
                if (e.key === 'Enter') {
                    input.blur();
                }
            });


        }

        // Configure close button
        const close = element.querySelector('.close');
        close?.addEventListener('click', (e) => {
            e.stopPropagation()
            this.dispatch('phx:opBuffer', { op: 'close', target: id })
        });

        // Shift+click activates ambient without switching editor.
        // Long-press on mobile does the same.
        let longPressTimer = null;
        let longPressed = false;

        element.addEventListener('click', (e) => {
            if (longPressed) { longPressed = false; return; }
            if (e.shiftKey) {
                this.dispatch('phx:opBuffer', { op: 'activate', target: id })
            } else {
                this.dispatch('phx:opBuffer', { op: 'select', target: id })
            }
        });

        element.addEventListener('touchstart', () => {
            longPressed = false;
            longPressTimer = setTimeout(() => {
                longPressed = true;
                this.dispatch('phx:opBuffer', { op: 'activate', target: id });
            }, 500);
        }, { passive: true });
        element.addEventListener('touchend', () => clearTimeout(longPressTimer));
        element.addEventListener('touchmove', () => clearTimeout(longPressTimer));

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

    renameTab(targetId) {
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
        tab.remove();
    }

    resizeInput(input) {
        const length = Math.max(input.value.length || input.placeholder.length, 2);
        input.style.width = `${length + 0.5}ch`;
    }

    dispatch(eventName, detail) {
        window.dispatchEvent(new CustomEvent(eventName, { detail }));
    }

    pushEvent(eventName, data) {
        // Assuming this method exists in the context
        // Implementation depends on your Phoenix LiveView setup
        console.log('pushEvent:', eventName, data);
    }
}
