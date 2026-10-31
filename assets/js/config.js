/**
 * NEXT360 website configuration
 * --------------------------------------------------------------------------
 * Update this file before publishing. Leave a value empty ("") to keep the
 * matching item hidden or marked as pending. No fake contact details, social
 * profiles, marketplace URLs or analytics IDs are included in this build.
 *
 * NEXT360 already operates other platforms. The portfolio links out to them
 * instead of duplicating them:
 *   officialWebsite — the NEXT360 company website / organic marketplace
 *   companyProfile   — the Official Company Profile at next360.in
 *   ceoPortfolio     — the CEO's separate, personal portfolio
 *   ceoLinkedIn      — the CEO's LinkedIn profile
 */
window.NEXT360_CONFIG = {
  siteUrl: "https://profile.next360.in",

  contact: {
    email: "office@next360.in",
    phone: "+91 9989163332",
    whatsapp: "919989163332",
    whatsappUrl: "https://wa.me/919989163332",
    addressLine: "",
    city: "Hyderabad",
    region: "Telangana",
    country: "India",
    mapEmbedUrl: ""
  },

  links: {
    officialWebsite: "https://next360.in",
    companyProfile: "https://next360.in",
    ceoPortfolio: "https://samhithreddysangam.next360.in/",
    ceoLinkedIn: "https://in.linkedin.com/in/samhithreddysangam",
    marketplace: "https://next360.in",
    social: {
      linkedin: "",
      instagram: "",
      facebook: "",
      youtube: ""
    }
  },

  forms: {
    endpoint: "/api/enquiry"
  },

  analytics: {
    gaMeasurementId: ""
  }
};
