/**
 * FoxFill country list + dial helpers (local only, no network).
 */
(function initFoxFillCountries(global) {
  /** Canonical English name + E.164 dial digits (no +). */
  const COUNTRIES = [
    { name: "Afghanistan", dial: "93" },
    { name: "Albania", dial: "355" },
    { name: "Algeria", dial: "213" },
    { name: "Argentina", dial: "54" },
    { name: "Australia", dial: "61" },
    { name: "Austria", dial: "43" },
    { name: "Bahrain", dial: "973" },
    { name: "Bangladesh", dial: "880" },
    { name: "Belgium", dial: "32" },
    { name: "Botswana", dial: "267" },
    { name: "Brazil", dial: "55" },
    { name: "Bulgaria", dial: "359" },
    { name: "Canada", dial: "1" },
    { name: "Chile", dial: "56" },
    { name: "China", dial: "86" },
    { name: "Colombia", dial: "57" },
    { name: "Croatia", dial: "385" },
    { name: "Cyprus", dial: "357" },
    { name: "Czech Republic", dial: "420" },
    { name: "Denmark", dial: "45" },
    { name: "Egypt", dial: "20" },
    { name: "Estonia", dial: "372" },
    { name: "Ethiopia", dial: "251" },
    { name: "Finland", dial: "358" },
    { name: "France", dial: "33" },
    { name: "Germany", dial: "49" },
    { name: "Ghana", dial: "233" },
    { name: "Greece", dial: "30" },
    { name: "Hong Kong", dial: "852" },
    { name: "Hungary", dial: "36" },
    { name: "India", dial: "91" },
    { name: "Indonesia", dial: "62" },
    { name: "Ireland", dial: "353" },
    { name: "Israel", dial: "972" },
    { name: "Italy", dial: "39" },
    { name: "Japan", dial: "81" },
    { name: "Jordan", dial: "962" },
    { name: "Kenya", dial: "254" },
    { name: "Kuwait", dial: "965" },
    { name: "Latvia", dial: "371" },
    { name: "Lebanon", dial: "961" },
    { name: "Lithuania", dial: "370" },
    { name: "Luxembourg", dial: "352" },
    { name: "Malaysia", dial: "60" },
    { name: "Malta", dial: "356" },
    { name: "Mexico", dial: "52" },
    { name: "Morocco", dial: "212" },
    { name: "Mozambique", dial: "258" },
    { name: "Namibia", dial: "264" },
    { name: "Netherlands", dial: "31" },
    { name: "New Zealand", dial: "64" },
    { name: "Nigeria", dial: "234" },
    { name: "Norway", dial: "47" },
    { name: "Oman", dial: "968" },
    { name: "Pakistan", dial: "92" },
    { name: "Philippines", dial: "63" },
    { name: "Poland", dial: "48" },
    { name: "Portugal", dial: "351" },
    { name: "Qatar", dial: "974" },
    { name: "Romania", dial: "40" },
    { name: "Russia", dial: "7" },
    { name: "Saudi Arabia", dial: "966" },
    { name: "Singapore", dial: "65" },
    { name: "Slovakia", dial: "421" },
    { name: "Slovenia", dial: "386" },
    { name: "South Africa", dial: "27" },
    { name: "South Korea", dial: "82" },
    { name: "Spain", dial: "34" },
    { name: "Sri Lanka", dial: "94" },
    { name: "Sweden", dial: "46" },
    { name: "Switzerland", dial: "41" },
    { name: "Taiwan", dial: "886" },
    { name: "Tanzania", dial: "255" },
    { name: "Thailand", dial: "66" },
    { name: "Turkey", dial: "90" },
    { name: "Uganda", dial: "256" },
    { name: "Ukraine", dial: "380" },
    { name: "United Arab Emirates", dial: "971" },
    { name: "United Kingdom", dial: "44" },
    { name: "United States", dial: "1" },
    { name: "Vietnam", dial: "84" },
    { name: "Zambia", dial: "260" },
    { name: "Zimbabwe", dial: "263" },
  ];

  const LOCALE_TO_COUNTRY = {
    ZA: "South Africa",
    US: "United States",
    GB: "United Kingdom",
    UK: "United Kingdom",
    AU: "Australia",
    NZ: "New Zealand",
    CA: "Canada",
    IN: "India",
    DE: "Germany",
    FR: "France",
    NL: "Netherlands",
    IE: "Ireland",
    NG: "Nigeria",
    KE: "Kenya",
    GH: "Ghana",
    ZW: "Zimbabwe",
    BW: "Botswana",
    NA: "Namibia",
    MZ: "Mozambique",
    BR: "Brazil",
    MX: "Mexico",
    ES: "Spain",
    IT: "Italy",
    PT: "Portugal",
    CN: "China",
    JP: "Japan",
    SG: "Singapore",
    AE: "United Arab Emirates",
    SA: "Saudi Arabia",
    PK: "Pakistan",
    PH: "Philippines",
    MY: "Malaysia",
    ID: "Indonesia",
    TH: "Thailand",
    KR: "South Korea",
    TW: "Taiwan",
    HK: "Hong Kong",
    SE: "Sweden",
    NO: "Norway",
    DK: "Denmark",
    FI: "Finland",
    CH: "Switzerland",
    AT: "Austria",
    BE: "Belgium",
    PL: "Poland",
    EG: "Egypt",
    TR: "Turkey",
    IL: "Israel",
  };

  function normalize(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function listCountries() {
    return COUNTRIES.map((c) => ({ name: c.name, dial: c.dial }));
  }

  function dialForCountry(countryName) {
    const n = normalize(countryName);
    if (!n) return "";
    if (n === "uk" || n === "u.k." || n === "great britain") return "44";
    if (n === "usa" || n === "u.s." || n === "u.s.a." || n === "america") {
      return "1";
    }
    if (n === "uae") return "971";
    for (const c of COUNTRIES) {
      const cn = normalize(c.name);
      if (cn === n || cn.includes(n) || n.includes(cn)) return c.dial;
    }
    return "";
  }

  function phonePlaceholderForCountry(countryName) {
    const dial = dialForCountry(countryName);
    return dial ? `+${dial}…` : "+…";
  }

  function guessCountryFromLocale(lang) {
    const raw = String(lang || "").trim();
    if (!raw) return "United States";
    const parts = raw.replace(/_/g, "-").split("-");
    const region = (parts[1] || parts[0] || "").toUpperCase();
    if (LOCALE_TO_COUNTRY[region]) return LOCALE_TO_COUNTRY[region];
    const langOnly = (parts[0] || "").toLowerCase();
    if (langOnly === "en") return "United States";
    return "United States";
  }

  /**
   * UI labels for province / postal fields (profile keys unchanged).
   */
  function addressLabelsForCountry(countryName) {
    const n = normalize(countryName);
    if (
      n === "united states" ||
      n === "usa" ||
      n.includes("united states") ||
      n === "canada"
    ) {
      return { province: "State", postalCode: "ZIP" };
    }
    if (
      n === "united kingdom" ||
      n === "uk" ||
      n.includes("united kingdom") ||
      n === "great britain"
    ) {
      return { province: "County", postalCode: "Postcode" };
    }
    return { province: "Province", postalCode: "Postal Code" };
  }

  function countryToDialMap() {
    const map = {
      uk: "44",
      usa: "1",
      uae: "971",
    };
    for (const c of COUNTRIES) {
      map[normalize(c.name)] = c.dial;
    }
    map["united arab emirates"] = "971";
    return map;
  }

  global.FoxFillCountries = {
    listCountries,
    dialForCountry,
    phonePlaceholderForCountry,
    guessCountryFromLocale,
    addressLabelsForCountry,
    countryToDialMap,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
