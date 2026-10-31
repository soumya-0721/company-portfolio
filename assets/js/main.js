/* ==========================================================================
   NEXT360 — site interactions
   Navigation, reveals, filters, configuration bindings and enquiry forms.
   ========================================================================== */
(function () {
  "use strict";

  var config = window.NEXT360_CONFIG || {};
  var doc = document;
  var body = doc.body;
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function $(selector, context) {
    return (context || doc).querySelector(selector);
  }

  function $$(selector, context) {
    return Array.prototype.slice.call((context || doc).querySelectorAll(selector));
  }

  function hasValue(value) {
    return typeof value === "string" && value.trim().length > 0;
  }

  /* ----------------------------------------------------------------------
     Header state & back-to-top
     ---------------------------------------------------------------------- */
  var header = $("#site-header");
  var toTop = $("[data-to-top]");

  function onScroll() {
    if (header) {
      header.classList.toggle("is-scrolled", window.scrollY > 8);
    }
    if (toTop) {
      toTop.classList.toggle("is-visible", window.scrollY > 720);
    }
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ----------------------------------------------------------------------
     Mobile menu
     ---------------------------------------------------------------------- */
  var mobileMenu = $("#mobile-menu");
  var menuOpeners = $$("[data-menu-open]");
  var menuClosers = $$("[data-menu-close]");
  var lastFocused = null;

  function focusableIn(container) {
    return $$("a[href], button:not([disabled]), input, select, textarea", container).filter(function (el) {
      return !el.hasAttribute("hidden") && el.offsetParent !== null;
    });
  }

  function openMenu() {
    if (!mobileMenu) return;
    lastFocused = doc.activeElement;
    mobileMenu.hidden = false;
    mobileMenu.inert = false;
    mobileMenu.setAttribute("aria-hidden", "false");
    body.classList.add("menu-open");
    menuOpeners.forEach(function (btn) {
      btn.setAttribute("aria-expanded", "true");
    });
    window.requestAnimationFrame(function () {
      mobileMenu.classList.add("is-open");
    });
    window.setTimeout(function () {
      var first = focusableIn(mobileMenu)[0];
      if (first) first.focus();
    }, 80);
  }

  function closeMenu(returnFocus) {
    if (!mobileMenu) return;
    mobileMenu.classList.remove("is-open");
    mobileMenu.setAttribute("aria-hidden", "true");
    body.classList.remove("menu-open");
    menuOpeners.forEach(function (btn) {
      btn.setAttribute("aria-expanded", "false");
    });
    window.setTimeout(function () {
      mobileMenu.hidden = true;
      mobileMenu.inert = true;
      if (returnFocus !== false && lastFocused && typeof lastFocused.focus === "function") {
        lastFocused.focus();
      }
    }, reduceMotion ? 0 : 300);
  }

  menuOpeners.forEach(function (btn) {
    btn.addEventListener("click", openMenu);
  });

  menuClosers.forEach(function (btn) {
    btn.addEventListener("click", function () {
      closeMenu(true);
    });
  });

  if (mobileMenu) {
    mobileMenu.addEventListener("click", function (event) {
      var link = event.target.closest("a");
      if (link) closeMenu(false);
    });

    mobileMenu.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu(true);
        return;
      }
      if (event.key !== "Tab") return;
      var focusable = focusableIn(mobileMenu);
      if (!focusable.length) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (event.shiftKey && doc.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && doc.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  }

  window.addEventListener("resize", function () {
    if (window.innerWidth > 1020 && mobileMenu && mobileMenu.classList.contains("is-open")) {
      closeMenu(false);
    }
  });

  /* ----------------------------------------------------------------------
     Reveal on scroll
     ---------------------------------------------------------------------- */
  var revealItems = $$("[data-reveal]");

  if ("IntersectionObserver" in window && !reduceMotion) {
    var revealObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    revealItems.forEach(function (item) {
      revealObserver.observe(item);
    });
  } else {
    revealItems.forEach(function (item) {
      item.classList.add("is-visible");
    });
  }

  /* ----------------------------------------------------------------------
     FAQ accordions
     ---------------------------------------------------------------------- */
  $$(".faq__button").forEach(function (button) {
    var panel = doc.getElementById(button.getAttribute("aria-controls"));
    if (!panel) return;

    button.addEventListener("click", function () {
      var isOpen = button.getAttribute("aria-expanded") === "true";
      var group = button.closest(".faq");

      if (!isOpen && group) {
        $$('.faq__button[aria-expanded="true"]', group).forEach(function (other) {
          if (other === button) return;
          other.setAttribute("aria-expanded", "false");
          var otherPanel = doc.getElementById(other.getAttribute("aria-controls"));
          if (otherPanel) otherPanel.style.maxHeight = "0px";
        });
      }

      button.setAttribute("aria-expanded", isOpen ? "false" : "true");
      panel.style.maxHeight = isOpen ? "0px" : panel.scrollHeight + "px";
    });
  });

  window.addEventListener("resize", function () {
    $$('.faq__button[aria-expanded="true"]').forEach(function (button) {
      var panel = doc.getElementById(button.getAttribute("aria-controls"));
      if (panel) panel.style.maxHeight = panel.scrollHeight + "px";
    });
  });

  /* ----------------------------------------------------------------------
     Project filters
     ---------------------------------------------------------------------- */
  var filterButtons = $$("[data-filter]");
  var projectCards = $$("[data-project-card]");
  var filterStatus = $("[data-filter-status]");

  filterButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      var filter = button.getAttribute("data-filter");
      var visible = 0;

      filterButtons.forEach(function (item) {
        item.setAttribute("aria-pressed", item === button ? "true" : "false");
      });

      projectCards.forEach(function (card) {
        var categories = (card.getAttribute("data-category") || "").split(/\s+/);
        var show = filter === "all" || categories.indexOf(filter) !== -1;
        card.classList.toggle("is-filtered-out", !show);
        if (show) visible += 1;
      });

      if (filterStatus) {
        filterStatus.textContent = visible + (visible === 1 ? " project shown" : " projects shown");
      }
    });
  });

  /* ----------------------------------------------------------------------
     Configuration: contact details, marketplace, WhatsApp, map
     ---------------------------------------------------------------------- */
  var contact = config.contact || {};
  var links = config.links || {};

  function renderContact(selector, value, type) {
    $$(selector).forEach(function (el) {
      el.classList.toggle("is-pending", !hasValue(value));
      if (!hasValue(value)) {
        el.textContent = "To be confirmed";
        return;
      }

      var text = value;
      var href = type === "email" ? "mailto:" + value : "tel:" + value.replace(/[^\d+]/g, "");
      var a = doc.createElement("a");
      a.href = href;
      a.textContent = text;
      a.className = "link-underline";
      el.replaceChildren(a);
    });
  }

  renderContact("[data-contact-email]", contact.email, "email");
  renderContact("[data-contact-phone]", contact.phone, "phone");

  $$("[data-contact-address]").forEach(function (el) {
    var parts = [contact.addressLine, contact.city, contact.region, contact.country].filter(hasValue);
    el.textContent = parts.length ? parts.join(", ") : "Hyderabad, Telangana, India";
  });

  var whatsappNumber = hasValue(contact.whatsapp) ? contact.whatsapp.replace(/[^\d]/g, "") : "";
  var whatsappUrl = hasValue(contact.whatsappUrl)
    ? contact.whatsappUrl.trim().replace(/\/+$/, "")
    : whatsappNumber
      ? "https://wa.me/" + whatsappNumber
      : "";

  if (whatsappUrl) {
    $$("[data-whatsapp]").forEach(function (el) {
      var message = encodeURIComponent("Hello NEXT360, I would like to make an enquiry.");
      el.href = whatsappUrl + "?text=" + message;
      el.target = "_blank";
      el.rel = "noopener noreferrer";
      el.hidden = false;
    });
  }

  $$("[data-whatsapp-pending]").forEach(function (el) {
    el.hidden = Boolean(whatsappNumber);
  });

  /* NEXT360's other platforms: official website, company profile, CEO
     portfolio. Empty values keep the link hidden rather than shipping a
     placeholder URL. */
  var platforms = {
    website: links.officialWebsite,
    profile: links.companyProfile,
    ceo: links.ceoPortfolio,
    "ceo-linkedin": links.ceoLinkedIn
  };

  Object.keys(platforms).forEach(function (key) {
    var url = hasValue(platforms[key]) ? platforms[key].trim() : "";
    $$('[data-platform="' + key + '"]').forEach(function (el) {
      if (url) {
        el.href = url;
        el.target = "_blank";
        el.rel = "noopener noreferrer";
        el.hidden = false;
      } else {
        el.hidden = true;
      }
    });
  });

  var marketplaceUrl = hasValue(links.marketplace) ? links.marketplace.trim() : "";

  $$("[data-marketplace-link]").forEach(function (el) {
    if (marketplaceUrl) {
      el.href = marketplaceUrl;
      el.target = "_blank";
      el.rel = "noopener noreferrer";
      el.hidden = false;
    } else {
      el.hidden = true;
    }
  });

  $$("[data-marketplace-pending]").forEach(function (el) {
    el.hidden = Boolean(marketplaceUrl);
  });

  var social = links.social || {};
  var socialVisible = false;

  Object.keys(social).forEach(function (network) {
    var url = social[network];
    if (!hasValue(url)) return;
    $$('[data-social="' + network + '"]').forEach(function (el) {
      el.href = url;
      el.target = "_blank";
      el.rel = "noopener noreferrer";
      el.hidden = false;
      socialVisible = true;
    });
  });

  var socialList = $("[data-social-list]");
  if (socialList) socialList.hidden = !socialVisible;

  var mapContainer = $("[data-map-container]");
  if (mapContainer && hasValue(contact.mapEmbedUrl)) {
    var iframe = doc.createElement("iframe");
    iframe.src = contact.mapEmbedUrl;
    iframe.title = "NEXT360 location map";
    iframe.loading = "lazy";
    iframe.referrerPolicy = "no-referrer-when-downgrade";
    iframe.allowFullscreen = true;
    mapContainer.replaceChildren(iframe);
    var mapNote = $("[data-map-note]");
    if (mapNote) mapNote.hidden = true;
  }

  /* ----------------------------------------------------------------------
     Query prefill & routing cards
     ---------------------------------------------------------------------- */
  var params = new URLSearchParams(window.location.search);
  var prefillMap = {
    category: 'name="category"',
    service: 'name="service"',
    type: 'name="enquiry_type"',
    partnership: 'name="partnership_type"'
  };

  Object.keys(prefillMap).forEach(function (param) {
    var value = params.get(param);
    if (!hasValue(value)) return;
    var field = $("form [" + prefillMap[param] + "]");
    if (!field) return;

    if (field.tagName === "SELECT") {
      var matched = false;
      Array.prototype.forEach.call(field.options, function (option) {
        if (!matched && option.value.toLowerCase() === value.toLowerCase()) {
          field.value = option.value;
          matched = true;
        }
      });
      if (!matched) {
        Array.prototype.forEach.call(field.options, function (option) {
          if (!matched && option.value.toLowerCase().indexOf(value.toLowerCase()) !== -1) {
            field.value = option.value;
            matched = true;
          }
        });
      }
    } else {
      field.value = value;
    }
  });

  $$("[data-preset]").forEach(function (el) {
    el.addEventListener("click", function () {
      var preset = el.getAttribute("data-preset");
      var form = $("#contact-form");
      if (!form) return;
      var select = $('[name="enquiry_type"]', form);
      if (select && preset) select.value = preset;
      window.setTimeout(function () {
        form.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
        if (select) select.focus({ preventScroll: true });
      }, 10);
    });
  });

  /* ----------------------------------------------------------------------
     Enquiry forms
     ---------------------------------------------------------------------- */
  function setFieldError(field, show, message) {
    var wrapper = field.closest(".field");
    if (!wrapper) return;
    var error = $(".field__error", wrapper);
    wrapper.classList.toggle("has-error", show);
    field.setAttribute("aria-invalid", show ? "true" : "false");

    if (error) {
      if (message && show) error.textContent = message;
      if (!field.getAttribute("aria-describedby") && error.id) {
        field.setAttribute("aria-describedby", error.id);
      }
    }
  }

  function fieldLabel(field) {
    var label = field.closest(".field") ? $("label", field.closest(".field")) : null;
    return label ? label.textContent.replace("*", "").trim().toLowerCase() : "this field";
  }

  function validateField(field) {
    var value = field.type === "checkbox" ? field.checked : field.value.trim();
    var message = "";

    if (field.required && !value) {
      message = field.type === "checkbox"
        ? "Please confirm that we may contact you about this enquiry."
        : "Please complete " + fieldLabel(field) + ".";
    } else if (value && field.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
      message = "Please enter a valid email address.";
    } else if (value && field.name === "phone") {
      var digits = value.replace(/[^\d]/g, "");
      if (digits.length < 7 || digits.length > 15) {
        message = "Please enter a valid phone number (7–15 digits).";
      }
    } else if (value && field.type === "url" && !/^https?:\/\/.+\..+/.test(value)) {
      message = "Please enter a full website address starting with http:// or https://.";
    }

    setFieldError(field, Boolean(message), message);
    return !message;
  }

  function showFormStatus(status, type, message) {
    if (!status) return;
    status.className = "form-status is-visible is-" + type;
    status.textContent = message;
    status.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "nearest"
    });
  }

  function getUtmData() {
    var keys = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];
    var data = {};
    keys.forEach(function (key) {
      var value = params.get(key);
      if (hasValue(value)) data[key] = value;
    });
    return data;
  }

  $$("form[data-enquiry-form]").forEach(function (form) {
    var status = $("[data-form-status]", form);
    var submit = $('[type="submit"]', form);
    var submitLabel = submit ? submit.innerHTML : "";
    var fields = $$("input, select, textarea", form);

    fields.forEach(function (field) {
      if (field.type === "hidden" || field.name === "_gotcha") return;
      var clear = function () {
        setFieldError(field, false);
        if (status && status.classList.contains("is-error")) {
          status.className = "form-status";
          status.textContent = "";
        }
      };
      field.addEventListener("input", clear);
      field.addEventListener("change", clear);
    });

    form.addEventListener("submit", function (event) {
      event.preventDefault();

      var honeypot = $('[name="_gotcha"]', form);
      if (honeypot && honeypot.value) return;

      var valid = true;
      fields.forEach(function (field) {
        if (field.type === "hidden" || field.name === "_gotcha") return;
        if (!validateField(field)) valid = false;
      });

      if (!valid) {
        var firstInvalid = $('[aria-invalid="true"]', form);
        if (firstInvalid) firstInvalid.focus();
        showFormStatus(status, "error", "Please check the highlighted fields and try again.");
        return;
      }

      var data = {};
      new FormData(form).forEach(function (value, key) {
        if (key === "_gotcha") return;
        data[key] = typeof value === "string" ? value.trim() : value;
      });

      var consentField = $('[name="consent"]', form);
      data.consent = consentField ? consentField.checked : true;

      var payload = Object.assign({}, data, {
        formType: form.getAttribute("data-form-type") || "general",
        page: window.location.pathname + window.location.search,
        submittedAt: new Date().toISOString(),
        utm: getUtmData()
      });

      var endpoint = (config.forms && config.forms.endpoint) || "/api/enquiry";

      if (submit) {
        submit.disabled = true;
        submit.setAttribute("aria-busy", "true");
        submit.textContent = "Sending…";
      }
      if (status) {
        status.className = "form-status";
        status.textContent = "";
      }

      fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify(payload)
      })
        .then(function (response) {
          return response
            .json()
            .catch(function () {
              return {};
            })
            .then(function (result) {
              if (!response.ok || !result.ok) {
                throw new Error(result.message || "The enquiry could not be sent.");
              }
              return result;
            });
        })
        .then(function (result) {
          form.reset();
          fields.forEach(function (field) {
            setFieldError(field, false);
          });
          showFormStatus(
            status,
            "success",
            "Thank you. Your enquiry has been received" +
              (result.id ? " — reference " + result.id : "") +
              ". Our team will review it and respond using the contact details you provided."
          );
        })
        .catch(function () {
          showFormStatus(
            status,
            "error",
            "We could not send your enquiry just now. Please try again in a moment, or use the contact details on our Contact page."
          );
        })
        .finally(function () {
          if (submit) {
            submit.disabled = false;
            submit.removeAttribute("aria-busy");
            submit.innerHTML = submitLabel;
          }
        });
    });
  });

  /* ----------------------------------------------------------------------
     Footer year
     ---------------------------------------------------------------------- */
  $$("[data-year]").forEach(function (el) {
    el.textContent = String(new Date().getFullYear());
  });

  /* ----------------------------------------------------------------------
     Analytics — loaded only when a valid GA4 ID is configured
     ---------------------------------------------------------------------- */
  var gaId = config.analytics && config.analytics.gaMeasurementId ? config.analytics.gaMeasurementId.trim() : "";

  if (/^G-[A-Z0-9]{4,}$/i.test(gaId)) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () {
      window.dataLayer.push(arguments);
    };
    window.gtag("js", new Date());
    window.gtag("config", gaId, { anonymize_ip: true });

    var gaScript = doc.createElement("script");
    gaScript.async = true;
    gaScript.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(gaId);
    doc.head.appendChild(gaScript);
  }
})();
