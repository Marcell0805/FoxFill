/**
 * Phase 4: weighted confidence scoring + conflict margin.
 * Autocomplete tokens hard-map unless conflicting. Never guess when close.
 */
(function initFoxFillMatcher(global) {
  const SCORE = {
    autocomplete: 100,
    label: 80,
    ariaLabel: 70,
    nameIdStrong: 60,
    nameIdPartial: 40,
    placeholder: 30,
    nearbyText: 10,
  };

  // Label-tier (+80) with a clear margin is enough to Will fill.
  // Autocomplete remains +100. Medium band is 60–79.
  const HIGH = 80;
  const MEDIUM = 60;
  const MARGIN = 20;

  const SHORT_ALIAS_MAX = 8;

  function normalize(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[*•·]/g, " ")
      .replace(/[_./\\-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function compact(value) {
    return normalize(value).replace(/\s+/g, "");
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function looksLikeCountryDialCode(text) {
    const n = normalize(text);
    if (!n) return false;
    const blockers = global.FoxFillFieldPatterns?.countryCodeBlockers || [];
    if (blockers.some((blocker) => n.includes(normalize(blocker)))) return true;
    // "country … code" / "region … code" without "residence"
    if (
      /\b(country|region)\b/.test(n) &&
      /\bcode\b/.test(n) &&
      !/\bresidence\b/.test(n)
    ) {
      return true;
    }
    return false;
  }

  function looksLikeJobTitleField(fingerprint) {
    const blockers = global.FoxFillFieldPatterns?.titleBlockers || [];
    const blob = normalize(
      [
        fingerprint.label,
        fingerprint.ariaLabel,
        fingerprint.name,
        fingerprint.id,
        fingerprint.placeholder,
        fingerprint.nearbyText,
      ].join(" ")
    );
    if (!blob) return false;
    if (blockers.some((b) => blob.includes(normalize(b)))) return true;
    if (
      /\b(job|position|occupation|role|work|employment)\b/.test(blob) &&
      /\btitle\b/.test(blob)
    ) {
      return true;
    }
    return false;
  }

  const HONORIFIC_OPTION_RE =
    /^(mr|mrs|ms|miss|dr|prof|rev|past|pastor|mx|adv|sir|lady|hon|lord|dame)\.?$/i;

  function looksLikeHonorificSelect(fingerprint) {
    if (String(fingerprint.type || "").toLowerCase() !== "select") return false;
    if (looksLikeJobTitleField(fingerprint)) return false;
    const options = Array.isArray(fingerprint.options)
      ? fingerprint.options
      : [];
    let hits = 0;
    for (const opt of options) {
      const text = normalize(opt.text || "").replace(/\.$/, "");
      const val = normalize(opt.value || "").replace(/\.$/, "");
      if (HONORIFIC_OPTION_RE.test(text) || HONORIFIC_OPTION_RE.test(val)) {
        hits += 1;
      }
      if (hits >= 3) return true;
    }
    return false;
  }

  function looksLikeTitleField(fingerprint) {
    if (looksLikeJobTitleField(fingerprint)) return false;
    const label = normalize(fingerprint.label || "");
    const aria = normalize(fingerprint.ariaLabel || "");
    const placeholder = normalize(fingerprint.placeholder || "");
    const title =
      label ||
      aria ||
      stripPromptNoise(placeholder) ||
      normalize(fingerprint.name || "") ||
      normalize(fingerprint.id || "");
    if (
      title === "title" ||
      title === "title *" ||
      /^title\s*\*?$/.test(title) ||
      title === "salutation" ||
      title === "honorific"
    ) {
      return true;
    }
    return looksLikeHonorificSelect(fingerprint);
  }

  const RESIDENCE_OPTION_RE =
    /^(house|townhouse|town\s*house|flat|apartment|duplex|cluster|condo|cottage|farm|estate)(\b|$)/i;

  function looksLikeResidenceTypeSelect(fingerprint) {
    if (String(fingerprint.type || "").toLowerCase() !== "select") return false;
    const options = Array.isArray(fingerprint.options)
      ? fingerprint.options
      : [];
    let hits = 0;
    for (const opt of options) {
      const text = String(opt.text || "").trim();
      const val = String(opt.value || "").trim();
      if (
        RESIDENCE_OPTION_RE.test(text) ||
        RESIDENCE_OPTION_RE.test(val) ||
        /\b(ground\s*floor|above\s*ground)\b/i.test(text)
      ) {
        hits += 1;
      }
      if (hits >= 2) return true;
    }
    return false;
  }

  function looksLikeResidenceTypeField(fingerprint) {
    const label = normalize(
      fingerprint.label ||
        fingerprint.ariaLabel ||
        stripPromptNoise(fingerprint.placeholder || "") ||
        ""
    );
    if (
      /\b(type of residence|residence type|dwelling type|type of dwelling|type of property|property type|accommodation type|home type|housing type)\b/.test(
        label
      )
    ) {
      return true;
    }
    return looksLikeResidenceTypeSelect(fingerprint) &&
      /\b(residence|dwelling|property|accommodation|home|housing|type)\b/.test(
        normalize(
          [
            fingerprint.label,
            fingerprint.ariaLabel,
            fingerprint.name,
            fingerprint.id,
            fingerprint.nearbyText,
          ].join(" ")
        )
      );
  }

  function fingerprintDialCode(fingerprint) {
    const blob = [
      fingerprint.label,
      fingerprint.ariaLabel,
      fingerprint.name,
      fingerprint.id,
      fingerprint.placeholder,
      fingerprint.nearbyText,
    ].join(" ");
    return looksLikeCountryDialCode(blob);
  }

  function autocompleteMap(token, patterns) {
    const raw = String(token || "").trim().toLowerCase();
    if (
      !raw ||
      raw === "off" ||
      raw === "on" ||
      raw === "new-password" ||
      raw === "current-password"
    ) {
      return null;
    }

    const t = raw.replace(/\s+/g, "-");
    const parts = t.split("-").filter(Boolean);
    const candidates = new Set([t]);
    if (parts.length > 1) {
      candidates.add(parts.slice(-2).join("-"));
      candidates.add(parts[parts.length - 1]);
    }

    for (const field of patterns) {
      for (const auto of field.autocomplete || []) {
        if (candidates.has(auto)) return field.key;
      }
    }

    // Local/area tel tokens still belong to the phone family; compound splits values.
    if (
      [...candidates].some(
        (c) => c === "tel-local" || c.endsWith("-tel-local") || c === "tel-national"
      )
    ) {
      return "phone";
    }
    return null;
  }

  function stripPromptNoise(text) {
    return normalize(text)
      .replace(
        /^(please\s+)?(enter|type|fill in|provide|insert|your|the)\s+/g,
        ""
      )
      .replace(/\s+(here|below|above)$/g, "")
      .replace(/\s*\*$/g, "")
      .trim();
  }

  /**
   * Returns matched alias string or null.
   * Avoid substring traps like "state" inside "statement".
   */
  function bestAliasInText(text, field) {
    const raw = String(text || "");
    const n = normalize(raw);
    if (!n) return null;

    const aliases = [...(field.aliases || [])].sort(
      (a, b) => b.length - a.length
    );

    for (const alias of aliases) {
      const na = normalize(alias);
      if (!na) continue;

      if (n === na) return alias;

      const wordRe = new RegExp(
        `(?:^|\\s)${escapeRegExp(na)}(?:\\s|$)`
      );
      if (wordRe.test(n)) return alias;

      // Attribute tokens: first_name / firstName / first-name
      const tokenBlob = raw
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
      const tokens = tokenBlob.split(/\s+/).filter(Boolean);
      const aliasTokens = na.split(/\s+/).filter(Boolean);
      if (
        aliasTokens.length === 1 &&
        tokens.includes(aliasTokens[0])
      ) {
        return alias;
      }
      if (
        aliasTokens.length > 1 &&
        aliasTokens.every((t) => tokens.includes(t))
      ) {
        return alias;
      }

      // Long multi-word phrases may appear inside longer labels.
      if (na.length > SHORT_ALIAS_MAX && n.includes(na)) {
        return alias;
      }
    }
    return null;
  }

  function isForeignText(text) {
    const blob = normalize(text);
    if (!blob) return false;
    const patterns = global.FoxFillFieldPatterns?.foreignSectionPatterns || [];
    return patterns.some((p) => blob.includes(normalize(p)));
  }

  function sectionBlob(fingerprint) {
    return normalize(
      [
        fingerprint.sectionHeading,
        fingerprint.label,
        fingerprint.ariaLabel,
        fingerprint.nearbyText,
        fingerprint.name,
        fingerprint.id,
        fingerprint.placeholder,
      ].join(" ")
    );
  }

  function isForeignSection(fingerprint) {
    return isForeignText(sectionBlob(fingerprint));
  }

  /**
   * Demote personal matches that sit under emergency/bank/etc. headings.
   * Tracks section sticky state in document order so autocomplete hard-maps
   * under "Emergency Contact" cannot fill the user's own profile.
   */
  function applyForeignSectionGuard(matches) {
    let foreignActive = false;
    let lastHeading = "";

    for (const match of matches) {
      const heading = normalize(match.fingerprint?.sectionHeading || "");
      if (heading && heading !== lastHeading) {
        lastHeading = heading;
        foreignActive = isForeignText(heading);
      }

      const fieldForeign =
        isForeignText(sectionBlob(match.fingerprint || {})) || foreignActive;

      if (
        fieldForeign &&
        (match.status === "will_fill" ||
          match.status === "matched" ||
          match.status === "needs_review")
      ) {
        match.status = "unmatched";
        match.profileKey = null;
        match.profileLabel = null;
        match.method = null;
        match.fillValue = "";
        match.score = 0;
        match.reason =
          "foreign section (emergency/bank/other) — not filled from personal profile";
        match.compound = undefined;
      }
    }

    return matches;
  }

  function looksLikeAreaCodeLocal(fingerprint) {
    const parse = global.FoxFillPhoneParse;
    if (parse?.looksLikeAreaCodeField) {
      return parse.looksLikeAreaCodeField(fingerprint);
    }
    const blob = normalize(
      [fingerprint.label, fingerprint.ariaLabel, fingerprint.name, fingerprint.id].join(" ")
    );
    return /\barea\s*code\b/.test(blob);
  }

  /**
   * Bare "Name" (not "First Name" / "Last Name" / "Name on Account") is
   * usually the given-name field when surname sits nearby on quote forms.
   */
  function looksLikeBareFirstNameField(fingerprint) {
    if (isForeignSection(fingerprint)) return false;
    const label = normalize(fingerprint.label || "");
    const aria = normalize(fingerprint.ariaLabel || "");
    const placeholder = normalize(fingerprint.placeholder || "");
    const title = label || aria || placeholder;
    if (!title) return false;

    // Exact bare name only — never "last name", "company name", etc.
    if (!(title === "name" || title === "name *" || /^name\s*\*?$/.test(title))) {
      return false;
    }

    const blob = sectionBlob(fingerprint);
    if (
      /\b(last|sur|family|full|company|business|account|user|display|file)\b/.test(
        blob
      )
    ) {
      return false;
    }
    return true;
  }

  /**
   * Bare "Date" labels under personal sections are usually DOB
   * (bank signature dates are already foreign-section excluded).
   */
  function looksLikePersonalDobField(fingerprint) {
    if (isForeignSection(fingerprint)) return false;
    const label = normalize(fingerprint.label || "");
    const aria = normalize(fingerprint.ariaLabel || "");
    const placeholder = normalize(fingerprint.placeholder || "");
    const section = normalize(fingerprint.sectionHeading || "");
    const name = normalize(
      `${fingerprint.name || ""} ${fingerprint.id || ""}`.replace(/[_-]+/g, " ")
    );

    const title = label || aria;
    const isBareDate =
      title === "date" ||
      title === "date *" ||
      /^date\s*\*?$/.test(title);

    const hasDobHint =
      /birth|dob|bday/.test(`${title} ${name} ${placeholder}`) ||
      /dd|mm|yyyy/.test(placeholder) ||
      (fingerprint.type || "").toLowerCase() === "date";

    const personalSection =
      !section ||
      /personal|about you|your details|applicant|employee/.test(section);

    if (isBareDate && personalSection) return true;
    if (hasDobHint && personalSection && /date/.test(`${title} ${name}`)) {
      return true;
    }
    return false;
  }

  /**
   * Discovery-style: radio "ID number" + text input named idField with weak labels.
   */
  function looksLikeIdNumberField(fingerprint) {
    if (isForeignSection(fingerprint)) return false;

    const type = String(fingerprint.type || "").toLowerCase();
    // Years-with-insurer etc. are selects — never treat as ID.
    if (type === "select" || type === "textarea") return false;

    const name = compact(fingerprint.name || "");
    const id = compact(fingerprint.id || "");
    const nameId = `${name} ${id}`;
    const label = normalize(fingerprint.label || "");
    const aria = normalize(fingerprint.ariaLabel || "");
    const nearby = normalize(fingerprint.nearbyText || "");
    const placeholder = normalize(fingerprint.placeholder || "");

    // Hard exclusions — these must never become idNumber
    if (
      /year|insurer|previous|passport|consent|policy|claim|vehicle|address|email|phone|mobile|cell/.test(
        nameId
      )
    ) {
      return false;
    }
    if (
      /\b(years?|insurer|previous insurer|passport)\b/.test(
        `${label} ${aria} ${nearby}`
      ) &&
      !/^(idfield|idnumber|rsaid)$/.test(name || id)
    ) {
      return false;
    }

    // Strong attribute names (Discovery idField)
    if (
      name === "idfield" ||
      id === "idfield" ||
      name === "idnumber" ||
      id === "idnumber" ||
      name === "rsaid" ||
      id === "rsaid" ||
      name === "said" ||
      id === "said"
    ) {
      return true;
    }

    // Explicit personal ID labels on the control itself
    if (/\b(id number|rsa id|sa id|identity number|identification number)\b/.test(label || aria)) {
      return true;
    }

    // Nearby "ID number" alone is not enough (contaminates siblings).
    // Require the control to also look ID-ish.
    if (
      /\b(id number|rsa id|sa id)\b/.test(nearby) &&
      (/id/.test(nameId) || /id/.test(placeholder))
    ) {
      return true;
    }

    return false;
  }

  function scoreFieldAgainstFingerprint(fingerprint, field) {
    if (field.key === "title" && looksLikeJobTitleField(fingerprint)) {
      return { key: field.key, score: 0, reasons: [] };
    }
    if (
      field.key === "idNumber" &&
      String(fingerprint.type || "").toLowerCase() === "select"
    ) {
      return { key: field.key, score: 0, reasons: [] };
    }

    let score = 0;
    const reasons = [];

    const labelAlias = bestAliasInText(fingerprint.label, field);
    if (labelAlias) {
      score += SCORE.label;
      reasons.push(`label+${SCORE.label}~${labelAlias}`);
    }

    const ariaAlias = bestAliasInText(fingerprint.ariaLabel, field);
    if (ariaAlias) {
      score += SCORE.ariaLabel;
      reasons.push(`aria+${SCORE.ariaLabel}~${ariaAlias}`);
    }

    const nameText = fingerprint.name || "";
    const idText = fingerprint.id || "";
    const nameAlias = bestAliasInText(nameText, field);
    const idAlias = bestAliasInText(idText, field);
    const attrAlias = nameAlias || idAlias;
    if (attrAlias) {
      const nc = compact(nameText);
      const ic = compact(idText);
      const ac = compact(attrAlias);
      const strong = nc === ac || ic === ac;
      const pts = strong ? SCORE.nameIdStrong : SCORE.nameIdPartial;
      score += pts;
      reasons.push(`${nameAlias ? "name" : "id"}+${pts}~${attrAlias}`);
    }

    // Placeholders like "Enter city" are often the only reliable clue on
    // modern forms — strip prompt words and score strong hits like labels.
    const placeholderRaw = fingerprint.placeholder || "";
    const placeholderStripped = stripPromptNoise(placeholderRaw);
    const placeholderAlias =
      bestAliasInText(placeholderStripped, field) ||
      bestAliasInText(placeholderRaw, field);

    if (placeholderAlias) {
      const strippedNorm = normalize(placeholderStripped);
      const aliasNorm = normalize(placeholderAlias);
      const strongPrompt =
        Boolean(placeholderStripped) &&
        (strippedNorm === aliasNorm ||
          compact(placeholderStripped) === compact(placeholderAlias));
      const pts = strongPrompt ? SCORE.label : SCORE.placeholder;
      score += pts;
      reasons.push(`placeholder+${pts}~${placeholderAlias}`);
    }

    const nearbyAlias = bestAliasInText(fingerprint.nearbyText, field);
    if (nearbyAlias && !labelAlias) {
      // Nearby visual label with no formal <label> — treat as label-tier.
      const nearbyNorm = normalize(fingerprint.nearbyText);
      const aliasNorm = normalize(nearbyAlias);
      const nearbyIsShortLabel =
        nearbyNorm.length <= 64 &&
        (nearbyNorm === aliasNorm ||
          nearbyNorm.startsWith(aliasNorm) ||
          nearbyNorm.includes(aliasNorm));
      const pts = nearbyIsShortLabel ? SCORE.label : SCORE.nearbyText;
      score += pts;
      reasons.push(`nearby+${pts}~${nearbyAlias}`);
    } else if (nearbyAlias) {
      score += SCORE.nearbyText;
      reasons.push(`nearby+${SCORE.nearbyText}~${nearbyAlias}`);
    }

    return { key: field.key, score, reasons };
  }

  function classify(best, second) {
    const bestScore = best ? best.score : 0;
    const secondScore = second ? second.score : 0;
    const margin = bestScore - secondScore;

    if (bestScore < MEDIUM) {
      return {
        status: "unmatched",
        profileKey: null,
        reason: bestScore
          ? `low confidence (${bestScore})`
          : "no alias match",
      };
    }

    if (margin < MARGIN) {
      return {
        status: "needs_review",
        profileKey: null,
        reason: `close scores ${best.key}:${bestScore} vs ${
          second ? second.key : "?"
        }:${secondScore} (need ≥${MARGIN})`,
      };
    }

    if (bestScore >= HIGH) {
      return {
        status: "will_fill",
        profileKey: best.key,
        reason: `score ${bestScore} (margin ${margin})`,
      };
    }

    return {
      status: "needs_review",
      profileKey: best.key,
      reason: `medium confidence ${bestScore} — review before fill`,
    };
  }

  function matchFingerprint(fingerprint, patterns) {
    if (isForeignSection(fingerprint)) {
      return {
        status: "unmatched",
        profileKey: null,
        method: null,
        score: 0,
        scores: [],
        reason: "foreign section (emergency/bank/other) — not filled from personal profile",
        ambiguousWith: [],
      };
    }

    if (fingerprintDialCode(fingerprint) || looksLikeAreaCodeLocal(fingerprint)) {
      return {
        status: "unmatched",
        profileKey: null,
        method: null,
        score: 0,
        scores: [],
        reason: looksLikeAreaCodeLocal(fingerprint)
          ? "area code skipped — not filled from profile phone"
          : "looks like dial/country code — skipped",
        ambiguousWith: [],
      };
    }

    const autoKey = autocompleteMap(fingerprint.autocomplete, patterns);
    if (autoKey) {
      return {
        status: "will_fill",
        profileKey: autoKey,
        method: "autocomplete",
        score: SCORE.autocomplete,
        scores: [{ key: autoKey, score: SCORE.autocomplete }],
        reason: `autocomplete=${fingerprint.autocomplete}`,
        ambiguousWith: [],
      };
    }

    const scored = patterns
      .map((field) => scoreFieldAgainstFingerprint(fingerprint, field))
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score || b.key.localeCompare(a.key));

    const best = scored[0] || null;
    const second = scored[1] || null;
    const decision = classify(best, second);

    const ambiguousWith =
      decision.status === "needs_review" && best && second && best.score - second.score < MARGIN
        ? [best.key, second.key]
        : [];

    const result = {
      status: decision.status,
      profileKey: decision.profileKey,
      method: best ? "score" : null,
      score: best ? best.score : 0,
      scores: scored.slice(0, 5).map((s) => ({
        key: s.key,
        score: s.score,
        reasons: s.reasons,
      })),
      reason: best
        ? `${decision.reason}; ${best.reasons.join(", ")}`
        : decision.reason,
      ambiguousWith,
    };

    if (
      (!result.profileKey || result.status === "unmatched") &&
      looksLikeBareFirstNameField(fingerprint)
    ) {
      result.status = "will_fill";
      result.profileKey = "firstName";
      result.method = "name_heuristic";
      result.score = Math.max(result.score || 0, SCORE.label);
      result.reason = "bare name label → first name";
      result.ambiguousWith = [];
    }

    if (
      (!result.profileKey || result.status === "unmatched") &&
      looksLikeTitleField(fingerprint)
    ) {
      result.status = "will_fill";
      result.profileKey = "title";
      result.method = "title_heuristic";
      result.score = Math.max(result.score || 0, SCORE.label);
      result.reason = looksLikeHonorificSelect(fingerprint)
        ? "honorific select → title"
        : "title / salutation field";
      result.ambiguousWith = [];
    }

    if (
      (!result.profileKey || result.status === "unmatched") &&
      looksLikeResidenceTypeField(fingerprint)
    ) {
      result.status = "will_fill";
      result.profileKey = "residenceType";
      result.method = "residence_heuristic";
      result.score = Math.max(result.score || 0, SCORE.label);
      result.reason = looksLikeResidenceTypeSelect(fingerprint)
        ? "residence-type select"
        : "type of residence field";
      result.ambiguousWith = [];
    }

    if (
      (!result.profileKey || result.status === "unmatched") &&
      looksLikeIdNumberField(fingerprint)
    ) {
      result.status = "will_fill";
      result.profileKey = "idNumber";
      result.method = "id_heuristic";
      result.score = Math.max(result.score || 0, SCORE.label);
      result.reason = "id field / id number control";
      result.ambiguousWith = [];
    }

    if (
      (!result.profileKey || result.status === "unmatched") &&
      looksLikePersonalDobField(fingerprint)
    ) {
      result.status = "will_fill";
      result.profileKey = "dateOfBirth";
      result.method = "dob_heuristic";
      result.score = Math.max(result.score || 0, SCORE.label);
      result.reason = "personal date field → date of birth";
      result.ambiguousWith = [];
      result.datePattern =
        global.FoxFillDateFormat?.detectPattern?.(fingerprint) || "YYYY-MM-DD";
    }

    // Format DOB to match the field's placeholder/pattern when possible.
    if (
      result.profileKey === "dateOfBirth" &&
      (result.status === "will_fill" || result.status === "needs_review")
    ) {
      result.datePattern =
        result.datePattern ||
        global.FoxFillDateFormat?.detectPattern?.(fingerprint) ||
        "YYYY-MM-DD";
    }

    return result;
  }

  function matchFields(fingerprints) {
    const patterns = global.FoxFillFieldPatterns?.fields;
    if (!patterns || !Array.isArray(fingerprints)) {
      return [];
    }

    const matches = fingerprints.map((fp, index) => {
      const match = matchFingerprint(fp, patterns);
      const pattern = patterns.find((p) => p.key === match.profileKey);
      return {
        index,
        fingerprint: fp,
        ...match,
        profileLabel: pattern ? pattern.label : null,
      };
    });

    return applyForeignSectionGuard(matches);
  }

  global.FoxFillMatchFields = matchFields;
  global.FoxFillScoreConfig = { HIGH, MEDIUM, MARGIN, SCORE };
})(typeof globalThis !== "undefined" ? globalThis : self);
