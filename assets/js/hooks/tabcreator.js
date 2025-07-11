import { idGen, nameGen } from "../utils/nama.js"
// Phoenix Hook for Dynamic Tab Creation
const TabCreator = {
  mounted() {
    this.tabContainer = document.getElementById('tabs');
    this.scaffold = document.getElementById('tab-scaffold-root');

    // Store the original template for cloning
    this.template = this.scaffold.cloneNode(true);
    this.nameGen = nameGen()

    // Listen for opBuffer events
    this.handleEvent('opBuffer', this.handleOperation.bind(this));

  },

  handleOperation(detail) {
    const { op, target } = detail;
    switch(op) {
      case 'add':
        this.addTab();
        break;
      case 'select':
        this.selectTab(target);
        break;
      case 'rename':
        this.renameTab(target);
        break;
      case 'close':
        this.closeTab(target);
        break;
    }
  },

  addTab() {
    const newTab = this.createTabFromTemplate();
    this.insertTab(newTab);
    this.activateTab(newTab);
  },

  createTabFromTemplate() {
    const clone = this.template.cloneNode(true);
    const timestamp = Date.now();


    // Update the cloned element with unique identifiers
    this.updateClonedElement(clone, idGen());


    return clone;
  },

  updateClonedElement(element, id) {
    // Update main element
    element.setAttribute('id', "tab-scaffold-"+ id)
    element.classList.add('tab-instance');
    element.setAttribute('data-tab-id', id);
    element.style.visibility = "visible"
    // Update phx-click dispatch
    const clickHandler = `phx:opBuffer`;
    element.setAttribute('phx-click', '');
    element.addEventListener('click', () => {
      this.dispatch('phx:opBuffer', { op: 'select', target: id });
    });

    // Update input element
    const input = element.querySelector('input');
    if (input) {
      input.id = `tab-input-name-${id}`;
      input.value = this.nameGen();

      // Update input width
      this.resizeInput(input);

      // Update keydown handler
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          this.dispatch('phx:opBuffer', { op: 'rename', target: input.id });
          input.blur();
        }
      });
    }

    const close = element.querySelector('.close');
    if (close) {
      close.addEventListener('click', () => {
      this.dispatch('phx:opBuffer', { op: 'close', target: id });
      });
    }

    return element;
  },

  insertTab(tabElement) {
    // Insert before the "New Tab" button (last child)
    const newTabButton = this.tabContainer.lastElementChild;
    this.tabContainer.insertBefore(tabElement, newTabButton);
  },

  activateTab(tabElement) {
    // Remove active state from other tabs
    this.tabContainer.querySelectorAll('.tab-instance').forEach(tab => {
      tab.removeAttribute('data-alive');
    });

    // Add active state to new tab
    tabElement.setAttribute('data-alive', "");

    // Focus the input for immediate editing
    const input = tabElement.querySelector('input');
    if (input) {
      input.disabled = false;
      input.focus();
      input.select();
    }
  },

  selectTab(target) {
    // Handle tab selection logic
    const allTabs = this.tabContainer.querySelectorAll('.tab-instance');
    allTabs.forEach(tab => tab.removeAttribute('data-alive'));

    const targetTab = this.tabContainer.querySelector(`[data-tab-id="${target}"]`);
    if (targetTab) {
      targetTab.setAttribute('data-alive', "");
    }
  },

  renameTab(target) {
    const input = document.getElementById(target);
    if (input) {
      const newName = input.value;
        // Dispatch rename event to server if needed
        this.pushEvent('tab_renamed', {
          target: input.id,
          name: newName
        });
      }
    },

  closeTab(target) {
    const tabElement = this.tabContainer.querySelector(`[data-tab-id="${target}"]`);
    const input = tabElement.querySelector('input');
    const ok = prompt('Are you sure you want to kill ' + input.value + '?');
    if (tabElement && ok == '') {
      tabElement.remove();
    }
  },

  resizeInput(input) {
    const length = Math.max(input.value.length || input.placeholder.length, 2);
    input.style.width = (length + 0.5) + 'ch';
  },

  dispatch(eventName, detail) {
    window.dispatchEvent(new CustomEvent(eventName, { detail }));
  }
};




export default TabCreator
