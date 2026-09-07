/**
 * Companion / compound field post-processing.
 * Phone: country-dial companions only. Area-code fields are skipped
 * (we do not invent/split SA-style 076 + local from a mobile number).
 */
(function initFoxFillCompound(global) {
  function cloneMatch(match) {
    return {
      ...match,
      fingerprint: { ...(match.fingerprint || {}) },
      scores: Array.isArray(match.scores)
        ? match.scores.map((s) => ({ ...s }))
        : match.scores,
      ambiguousWith: Array.isArray(match.ambiguousWith)
        ? [...match.ambiguousWith]
        : [],
    };
  }

  function parentKey(fp) {
    return (fp && fp.parentContext) || "";
  }

  function distance(a, b) {
    return Math.abs((a.index || 0) - (b.index || 0));
  }

  function sameContainer(a, b) {
    const pa = parentKey(a.fingerprint);
    const pb = parentKey(b.fingerprint);
    return Boolean(pa && pb && pa === pb);
  }

  function findCompanion(phoneMatch, matches, predicate) {
    const phoneIdx = phoneMatch.index;
    const candidates = [];

    for (const m of matches) {
      if (m === phoneMatch) continue;
      const fp = m.fingerprint || {};
      if (!predicate(fp)) continue;

      let score = 0;
      const dist = distance(phoneMatch, m);
      if (dist === 1) score += 50;
      else if (dist === 2) score += 35;
      else if (dist <= 4) score += 20;
      else continue;

      if (sameContainer(phoneMatch, m)) score += 25;
      if ((fp.type || "").toLowerCase() === "select" || fp.tag === "SELECT") {
        score += 15;
      }
      if ((m.index || 0) < phoneIdx) score += 10;

      candidates.push({ match: m, score });
    }

    candidates.sort((a, b) => b.score - a.score);
    if (!candidates.length || candidates[0].score < 40) return null;
    if (
      candidates.length > 1 &&
      candidates[0].score - candidates[1].score < 10
    ) {
      return null;
    }
    return candidates[0].match;
  }

  function applyDateFormats(matches, profile) {
    const fmt = global.FoxFillDateFormat;
    if (!fmt || !profile?.dateOfBirth) return matches;

    for (const m of matches) {
      if (m.profileKey !== "dateOfBirth") continue;
      if (m.status !== "will_fill" && m.status !== "needs_review") continue;
      const pattern =
        m.datePattern || fmt.detectPattern(m.fingerprint) || "YYYY-MM-DD";
      m.datePattern = pattern;
      m.fillValue = fmt.formatDate(profile.dateOfBirth, pattern);
      m.fillMode = "date_formatted";
      m.reason = `${m.reason || "dob"}; format ${pattern}`;
    }
    return matches;
  }

  function skipAreaCodeFields(matches, parse) {
    for (const m of matches) {
      if (!parse.looksLikeAreaCodeField?.(m.fingerprint)) continue;
      m.status = "unmatched";
      m.profileKey = null;
      m.profileLabel = null;
      m.method = null;
      m.fillValue = "";
      m.score = 0;
      m.compound = undefined;
      m.reason = "area code skipped — not filled from profile phone";
    }
    return matches;
  }

  function fullPhoneValue(phoneParsed, profile, fingerprint) {
    const raw =
      phoneParsed.fullNumber ||
      phoneParsed.nationalWithZero ||
      profile?.phone ||
      "";
    if (typeof global.FoxFillFitValue === "function") {
      return global.FoxFillFitValue(raw, fingerprint, {
        profileKey: "phone",
        phoneParsed,
      });
    }
    return raw;
  }

  function nationalPhoneValue(phoneParsed, fingerprint) {
    const preferred =
      phoneParsed.nationalNumber ||
      phoneParsed.nationalWithZero ||
      "";
    // When +CC is already shown, prefer subscriber digits (no leading 0).
    // fitValue may still pick nationalWithZero if maxlength asks for 10.
    const candidates = [
      phoneParsed.nationalNumber,
      phoneParsed.nationalWithZero,
      phoneParsed.fullNumber,
    ].filter(Boolean);

    if (typeof global.FoxFillFitValue === "function") {
      // Seed with national-first raw so fit prefers local shapes
      return global.FoxFillFitValue(
        preferred || candidates[0] || "",
        fingerprint,
        {
          profileKey: "phone",
          phoneParsed,
          preferNational: true,
        }
      );
    }
    return preferred;
  }

  /**
   * @param {object[]} matches
   * @param {{ phone?: string, country?: string, dateOfBirth?: string }} profile
   */
  function applyPhoneCompounds(matches, profile) {
    const parse = global.FoxFillPhoneParse;
    if (!parse || !Array.isArray(matches)) return matches || [];

    let out = matches.map(cloneMatch);
    out = skipAreaCodeFields(out, parse);

    const phoneParsed = parse.parsePhone(
      profile?.phone || "",
      profile?.country || ""
    );
    const used = new Set();
    const groups = [];

    const phoneMatches = out.filter((m) => {
      if (m.status === "unmatched" && m.reason?.includes("foreign section")) {
        return false;
      }
      if (m.status === "unmatched" && m.reason?.includes("area code skipped")) {
        return false;
      }
      if (m.profileKey === "phone") return true;
      return parse.looksLikePhoneField(m.fingerprint);
    });

    for (const phone of phoneMatches) {
      if (used.has(phone.index)) continue;

      const dial = findCompanion(phone, out, (fp) =>
        parse.looksLikeDialCodeField(fp)
      );

      if (dial && !used.has(dial.index)) {
        used.add(dial.index);
        used.add(phone.index);
        const groupId = `phone-dial-${phone.index}-${dial.index}`;
        const options = Array.isArray(dial.fingerprint?.options)
          ? dial.fingerprint.options
          : [];
        const bestOption = parse.findBestDialOption(
          options,
          phoneParsed.dialDigits,
          profile?.country || ""
        );

        dial.profileKey = "phoneCountryCode";
        dial.profileLabel = "Country Code";
        dial.method = "compound";
        dial.compound = {
          type: "phone",
          role: "dial",
          groupId,
          pairedIndex: phone.index,
        };

        phone.profileKey = "phone";
        phone.profileLabel = phone.profileLabel || "Phone";
        phone.method = "compound";
        phone.compound = {
          type: "phone",
          role: "phone",
          groupId,
          pairedIndex: dial.index,
        };

        if (bestOption && phoneParsed.nationalNumber) {
          dial.status = "will_fill";
          dial.score = Math.max(dial.score || 0, bestOption.score);
          dial.fillValue = bestOption.value;
          dial.fillLabel = bestOption.text;
          dial.reason = `compound dial → ${bestOption.text || bestOption.value}`;

          // With a country-code dropdown, phone gets national digits (no invented area split).
          phone.fillValue =
            typeof global.FoxFillFitValue === "function"
              ? global.FoxFillFitValue(
                  phoneParsed.nationalWithZero || phoneParsed.nationalNumber,
                  phone.fingerprint,
                  { profileKey: "phone", phoneParsed }
                )
              : phoneParsed.nationalWithZero || phoneParsed.nationalNumber;
          phone.fillMode = "phone_national";
          phone.status = "will_fill";
          phone.reason = `compound phone national (${phoneParsed.countryCode})`;
        } else {
          dial.status = "needs_review";
          dial.fillValue = "";
          dial.reason = phoneParsed.dialDigits
            ? `compound dial +${phoneParsed.dialDigits} — no confident option`
            : "compound dial — could not parse country code";

          phone.status = "will_fill";
          phone.fillValue =
            typeof global.FoxFillFitValue === "function"
              ? global.FoxFillFitValue(
                  phoneParsed.nationalWithZero || phoneParsed.nationalNumber || "",
                  phone.fingerprint,
                  { profileKey: "phone", phoneParsed }
                )
              : phoneParsed.nationalWithZero || phoneParsed.nationalNumber || "";
          phone.fillMode = "phone_national";
          phone.reason =
            "compound phone ready (national only); dial needs review";
          if (!phone.fillValue) {
            phone.status = "needs_review";
            phone.reason = "phone group needs review";
          }
        }

        groups.push({
          type: "phone",
          groupId,
          scenario: "dial",
          phoneIndex: phone.index,
          dialIndex: dial.index,
        });
        continue;
      }

      // Single phone / mobile / home number field → full profile number,
      // unless a static +CC prefix is already shown beside the input.
      if (
        (phone.profileKey === "phone" ||
          parse.looksLikePhoneField(phone.fingerprint)) &&
        (phone.status === "will_fill" || phone.status === "matched")
      ) {
        const staticPrefix =
          parse.detectStaticDialPrefix?.(phone.fingerprint) ||
          phone.fingerprint?.staticDialPrefix ||
          "";
        const prefixDigits = String(staticPrefix).replace(/\D+/g, "");
        const matchesProfileDial =
          prefixDigits &&
          phoneParsed.dialDigits &&
          prefixDigits === phoneParsed.dialDigits;

        if (staticPrefix && (matchesProfileDial || prefixDigits)) {
          phone.fillValue = nationalPhoneValue(
            phoneParsed,
            phone.fingerprint
          );
          phone.fillMode = "phone_national";
          phone.compound = {
            type: "phone",
            role: "phone",
            scenario: "static_prefix",
            staticDialPrefix: staticPrefix,
          };
          phone.reason = `static ${staticPrefix} prefix — national only (${phone.fillValue})`;
          if (!phone.profileKey) {
            phone.profileKey = "phone";
            phone.profileLabel = "Phone";
          }
        } else {
          phone.fillValue = fullPhoneValue(
            phoneParsed,
            profile,
            phone.fingerprint
          );
          phone.fillMode = "phone_full";
          phone.compound = { type: "phone", role: "phone", scenario: "A" };
          const fitted =
            phone.fillValue !==
            (phoneParsed.fullNumber || phoneParsed.nationalWithZero || "");
          phone.reason = fitted
            ? `phone fitted to field constraints (${phone.fillValue})`
            : "full profile phone (area codes not used)";
        }
        used.add(phone.index);
      }
    }

    out = applyDateFormats(out, profile);
    out = applyValueConstraints(out, profile, phoneParsed);

    if (groups.length) {
      console.groupCollapsed(`[FoxFill] Phone compounds — ${groups.length}`);
      console.table(groups);
      console.groupEnd();
    }

    return out;
  }

  /**
   * Fit every fillable value to maxlength / pattern / mask on the field.
   * Review UI shows the fitted value; filler re-checks live constraints.
   */
  function applyValueConstraints(matches, profile, phoneParsed) {
    if (typeof global.FoxFillFitValue !== "function") return matches;

    for (const m of matches) {
      if (!m || m.status === "unmatched") continue;
      if (m.profileKey === "phoneCountryCode") continue;

      let raw = "";
      if (m.fillValue != null && String(m.fillValue).trim() !== "") {
        raw = String(m.fillValue).trim();
      } else if (m.profileKey && profile?.[m.profileKey]) {
        raw = String(profile[m.profileKey]).trim();
      }
      if (!raw) continue;

      const fitted = global.FoxFillFitValue(raw, m.fingerprint || {}, {
        profileKey: m.profileKey || null,
        phoneParsed:
          m.profileKey === "phone" || m.fillMode?.startsWith("phone")
            ? phoneParsed
            : null,
      });

      if (fitted && fitted !== raw) {
        m.fillValue = fitted;
        const max = m.fingerprint?.maxLength;
        const constraintBit =
          max != null ? `maxlength ${max}` : "field constraints";
        m.reason = m.reason
          ? `${m.reason} · fitted to ${constraintBit}`
          : `fitted to ${constraintBit} (${fitted})`;
        m.fitted = true;
      } else if (!m.fillValue && fitted) {
        m.fillValue = fitted;
      }
    }

    return matches;
  }

  global.FoxFillApplyPhoneCompounds = applyPhoneCompounds;
})(typeof globalThis !== "undefined" ? globalThis : self);
