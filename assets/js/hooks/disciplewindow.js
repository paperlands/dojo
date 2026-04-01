const DiscipleWindow = {
  mounted() {
    // Visibility tracking: set of names currently visible
    this.visibleDisciples = new Set();

    // DOM element tracking: name -> element reference
    this.observedElements = new Map();

    // Name set for detecting morphing/element replacement
    this.lastNames = null;

    // debounce config
    this.debounceTimeout = null;
    this.debounceDelay = 150; // milliseconds

    // intersection observer config
    this.observer = new IntersectionObserver(
      (entries) => this.handleIntersection(entries),
      {
        root: null, // use viewport
        rootMargin: '50px', // load slightly before visible
        threshold: 0.1 // 10% visibility is enuff
      }
    );

    //  mutation observer for attribute changes only (childList handled by updated() hook)
    this.mutationObserver = new MutationObserver((mutations) => {
      const attrChanged = mutations.some(m => m.type === 'attributes');
      if (attrChanged) {
        this.resetObservations();
      }
    });

    // start observing DOM — no childList, that's handled by updated()
    this.mutationObserver.observe(this.el, {
      childList: false,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-name', 'phx-value-disciple-name', 'phx-value-addr']
    });

    // init observation
    this.initializeObservation();

    // throttle scroll listener
    this.scrollThrottleTimer = null;
    this.handleScroll = this.handleScroll.bind(this);
    this.el.addEventListener('scroll', this.handleScroll, { passive: true });
    var el = document.getElementById('disciple_panels');
    el.addEventListener('wheel', function(e) {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
          e.preventDefault();
          el.scrollLeft += e.deltaY;
        }
      }, { passive: false })
  },

  updated() {
    // Reset observations if disciple identity (name set) changed, not just count
    // This handles element replacement from LiveView morphing (reorder/replace)
    // without over-resetting on attribute changes to existing elements (image URL, class, etc)
    const currentNames = new Set(
      this.findDiscipleElements()
        .map(el => this.ensureNameAttribute(el))
        .filter(Boolean)
    );

    const namesChanged =
      !this.lastNames ||
      currentNames.size !== this.lastNames.size ||
      [...currentNames].some(name => !this.lastNames.has(name));

    if (namesChanged) {
      this.lastNames = currentNames;
      this.resetObservations();
    }
  },

  disconnected() {
    // Clean up all resources
    this.cleanup();
  },

  resetObservations() {
    // Disconnect existing observers
    this.observer.disconnect();
    this.observedElements.clear();

    // Re-initialize observation
    this.initializeObservation();
  },

  initializeObservation() {
    // Find all disciples and start observing them
    const disciples = this.findDiscipleElements();

    disciples.forEach(element => {
      const name = this.ensureNameAttribute(element);
      if (name) {
        // Store the element reference to avoid duplicate observations
        this.observedElements.set(name, element);
        // Start observing this element
        this.observer.observe(element);
      }
    });

    // Cull any disciples that no longer exist in the DOM
    this.cullInvisibleDisciples();
  },

  cullInvisibleDisciples() {
    // Get current disciples in the DOM
    const currentNames = new Set();
    this.observedElements.forEach((_, name) => {
      currentNames.add(name);
    });

    // Find disciples in our visible set that no longer exist
    const toRemove = [];
    this.visibleDisciples.forEach(name => {
      if (!currentNames.has(name)) {
        toRemove.push(name);
      }
    });

    // Remove disciples that no longer exist from the visible set
    let changed = false;
    toRemove.forEach(name => {
      this.visibleDisciples.delete(name);
      changed = true;
    });

    // Send update if needed
    if (changed) {
      this.debounceSendVisibleDisciples();
    }
  },

  handleIntersection(entries) {
    let changed = false;

    entries.forEach(entry => {
      const element = entry.target;
      const name = element.getAttribute("data-name");

      if (!name) return;

      if (entry.isIntersecting) {
        // Add to visible set
        if (!this.visibleDisciples.has(name)) {
          this.visibleDisciples.add(name);
          changed = true;
        }
      } else {
        // Remove from visible set
        if (this.visibleDisciples.has(name)) {
          this.visibleDisciples.delete(name);
          changed = true;
        }
      }
    });

    // Only update if visibility changed
    if (changed) {
      this.debounceSendVisibleDisciples();
    }
  },

  handleScroll() {
    if (!this.scrollThrottleTimer) {
      this.scrollThrottleTimer = setTimeout(() => {
        this.scrollThrottleTimer = null;
        this.checkForNewElements();
        this.cullInvisibleDisciples();
      }, 250); // throttle to 250ms
    }
  },

  checkForNewElements() {
    const disciples = this.findDiscipleElements();

    disciples.forEach(element => {
      const name = this.ensureNameAttribute(element);
      if (name && !this.observedElements.has(name)) {
        // new element found, start observing it
        this.observedElements.set(name, element);
        this.observer.observe(element);
      }
    });
  },

  debounceSendVisibleDisciples() {
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
    }

    this.debounceTimeout = setTimeout(() => {
      const visibleArray = Array.from(this.visibleDisciples);

      // sort for consistent order
      visibleArray.sort();

      this.pushEvent("seeDisciples", {
        visible_disciples: visibleArray
      });
    }, this.debounceDelay);
  },

  findDiscipleElements() {
    // find all disciples, prioritizing the container if it exists
    const container = this.el.querySelector(".disciples-container") || this.el;
    return Array.from(container.children).filter(el => {
      return !el.classList.contains("non-disciple");
    });
  },

  ensureNameAttribute(element) {
    if (element.hasAttribute("data-name")) {
      return element.getAttribute("data-name");
    }

    const name = element.getAttribute("phx-value-disciple-name") ||
                  element.querySelector("[phx-value-addr]")?.getAttribute("phx-value-addr");

    if (name) {
      element.setAttribute("data-name", name);
      return name;
    }

    return null;
  },

  cleanup() {
    // Clear all timeouts
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
      this.debounceTimeout = null;
    }

    if (this.scrollThrottleTimer) {
      clearTimeout(this.scrollThrottleTimer);
      this.scrollThrottleTimer = null;
    }

    // dc observers
    this.observer.disconnect();
    this.mutationObserver.disconnect();

    this.el.removeEventListener('scroll', this.handleScroll);

    // Clear data structures
    this.visibleDisciples.clear();
    this.observedElements.clear();
  }
};

export default DiscipleWindow;
