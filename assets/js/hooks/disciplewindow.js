const DiscipleWindow = {
  mounted() {

      // make sure uniq
    this.visibleDisciples = new Set();

    this.observedElements = new Map(); // ref -> element

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

    //  mutation observer to detect DOM changes
    this.mutationObserver = new MutationObserver((mutations) => {
      let needsUpdate = false;

      mutations.forEach(mutation => {
        // check for added/removed nodes
        if (mutation.type === 'childList') {
          needsUpdate = true;
        }
        // attrs changes that might indicate phx_ref changes
        else if (mutation.type === 'attributes' &&
                (mutation.attributeName === 'data-phx-ref' ||
                 mutation.attributeName === 'phx-value-disciple-phx_ref' ||
                 mutation.attributeName === 'phx-value-addr')) {
          needsUpdate = true;
        }
      });

      if (needsUpdate) {
        this.resetObservations();
      }
    });

    // start observing DOM
    this.mutationObserver.observe(this.el, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-phx-ref', 'phx-value-disciple-phx_ref', 'phx-value-addr']
    });

    // init observation
    this.initializeObservation();

    // throttle scroll listener
    this.scrollThrottleTimer = null;
    this.handleScroll = this.handleScroll.bind(this);
    this.el.addEventListener('scroll', this.handleScroll, { passive: true });
  },

  updated() {
    // Clean and re-initialize on updates
    this.resetObservations();
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
      const ref = this.ensurePhxRefAttribute(element);
      if (ref) {
        // Store the element reference to avoid duplicate observations
        this.observedElements.set(ref, element);
        // Start observing this element
        this.observer.observe(element);
      }
    });

    // Cull any disciples that no longer exist in the DOM
    this.cullInvisibleDisciples();
  },

  cullInvisibleDisciples() {
    // Get current disciples in the DOM
    const currentDiscipleRefs = new Set();
    this.observedElements.forEach((_, ref) => {
      currentDiscipleRefs.add(ref);
    });

    // Find disciples in our visible set that no longer exist
    const toRemove = [];
    this.visibleDisciples.forEach(ref => {
      if (!currentDiscipleRefs.has(ref)) {
        toRemove.push(ref);
      }
    });

    // Remove disciples that no longer exist from the visible set
    let changed = false;
    toRemove.forEach(ref => {
      this.visibleDisciples.delete(ref);
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
      const discipleRef = element.getAttribute("data-phx-ref");

      if (!discipleRef) return;

      if (entry.isIntersecting) {
        // Add to visible set
        if (!this.visibleDisciples.has(discipleRef)) {
          this.visibleDisciples.add(discipleRef);
          changed = true;
        }
      } else {
        // Remove from visible set
        if (this.visibleDisciples.has(discipleRef)) {
          this.visibleDisciples.delete(discipleRef);
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
      const ref = this.ensurePhxRefAttribute(element);
      if (ref && !this.observedElements.has(ref)) {
        // new element found, start observing it
        this.observedElements.set(ref, element);
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

  ensurePhxRefAttribute(element) {
    if (element.hasAttribute("data-phx-ref")) {
      return element.getAttribute("data-phx-ref");
    }

    const phxRef = element.getAttribute("phx-value-disciple-phx_ref") ||
                  element.querySelector("[phx-value-addr]")?.getAttribute("phx-value-addr");

    if (phxRef) {
      element.setAttribute("data-phx-ref", phxRef);
      return phxRef;
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
