(() => {
  const month =
    "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
  const date =
    `(?:\\d{4}[/-]\\d{1,2}[/-]\\d{1,2}|\\d{1,2}[/-]\\d{1,2}(?:[/-]\\d{2,4})?|${month}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?|\\d{1,2}(?:st|nd|rd|th)?\\s+${month}(?:,?\\s+\\d{4})?)`;
  const patterns = [
    {
      category: "date of birth",
      regex: new RegExp(
        `\\b(?:my\\s+)?(?:date of birth|birth\\s*date|d\\.?o\\.?b\\.?|birthday|bday)\\s*(?:[:=]\\s*)?(?:(?:is|was)\\s+)?(?:on\\s+)?${date}`,
        "gi"
      )
    },
    {
      category: "date of birth",
      regex: new RegExp(`\\b(?:i was born|born)\\s+(?:on\\s+)?${date}`, "gi")
    },
    {
      category: "name",
      regex:
        /\b(?:(?:my\s+)?(?:(?:full|first|last|patient|customer|employee)\s+)?name\s*(?::|=|\bis\b)|call me)\s*[\p{L}][\p{L}'’-]*(?:[ \t]+[\p{L}][\p{L}'’-]*){0,2}/giu
    },
    {
      category: "name",
      regex: /\b(?:resident|patient|customer|employee)[ \t]*(?::|=)[ \t]*[\p{L}][\p{L}\p{M}'’-]*(?:[ \t]+[\p{L}][\p{L}\p{M}'’-]*){0,4}/giu
    },
    {
      category: "Social Insurance number",
      regex: /\b(?:sin|social[ \t]+insurance(?:[ \t]+number)?)[ \t]*(?::|=|#|\bis\b)?[ \t]*\d{3}[ -]?\d{3}[ -]?\d{3}\b/gi
    },
    {
      category: "health card number",
      regex: /\b(?:health[ \t]+card(?:[ \t]+number)?(?:[ \t]*\(OHIP\))?|OHIP(?:[ \t]+(?:card|number))?)[ \t]*(?::|=|#|\bis\b)?[ \t]*\d{4}[ -]?\d{3}[ -]?\d{3}(?:[ -]?[A-Z]{2})?\b/gi
    },
    {
      category: "driver's license number",
      regex: /\bdriver['’]?s?[ \t]+licen[cs]e(?:[ \t]+(?:number|no\.?))?[ \t]*(?::|=|#|\bis\b)?[ \t]*[A-Z]\d{4}[ -]?\d{5}[ -]?\d{5}\b/gi
    },
    {
      category: "street address",
      // Labeled address records include unit, city, province and postal code on the same line.
      regex: /\b(?:(?:home|mailing|residential)[ \t]+)?address[ \t]*(?::|=|\bis\b)[ \t]*\d{1,6}[ \t]+[^\r\n;]+/gi
    },
    {
      category: "street address",
      regex:
        /\b(?:my address is|i live at)\s+\d{1,6}\s+[\p{L}\d.'’-]+(?:\s+[\p{L}\d.'’-]+){0,5}\s+(?:street|st\.?|avenue|ave\.?|road|rd\.?|boulevard|blvd\.?|drive|dr\.?|lane|ln\.?|court|ct\.?|way)\b(?:\s*,\s*(?:apt|unit|suite|#)\s*[\w-]+)?/giu
    },
    {
      category: "email address",
      regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
    },
    {
      category: "Social Security number",
      regex: /\b\d{3}[- ]\d{2}[- ]\d{4}\b/g
    },
    {
      category: "Social Security number",
      regex: /\b(?:ssn|social security(?: number)?)\s*(?::|=|#|\bis\b)?\s*\d{9}\b/gi
    },
    {
      category: "bank account number",
      regex: /\b(?:bank[_\s-]+)?account(?:[_\s-]+(?:number|no\.?))?\s*[:#=-]?\s*\d{6,17}\b/gi
    },
    {
      category: "bank institution number",
      regex: /\bbank[_\s-]+institution(?:[_\s-]+(?:number|code|id))?\s*[:#=-]?\s*\d{3}\b/gi
    },
    {
      category: "bank transit number",
      regex: /\b(?:bank[_\s-]+)?transit(?:[_\s-]+(?:number|no\.?))?\s*[:#=-]?\s*\d{5}\b/gi
    },
    {
      category: "payment card number",
      regex: /\b(?:\d[ -]?){13,19}\b/g,
      validate: passesLuhn
    },
    {
      category: "phone number",
      regex: /(?<!\w)(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?!\w)/g
    }
  ];

  function passesLuhn(value) {
    const digits = value.replace(/\D/g, "");
    if (digits.length < 13 || digits.length > 19) return false;
    let sum = 0;
    let doubleDigit = false;
    for (let index = digits.length - 1; index >= 0; index -= 1) {
      let digit = Number(digits[index]);
      if (doubleDigit) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
      doubleDigit = !doubleDigit;
    }
    return sum % 10 === 0;
  }

  function redactSensitiveText(value) {
    const text = String(value);
    const matches = [];

    for (const { category, regex, validate } of patterns) {
      regex.lastIndex = 0;
      for (const match of text.matchAll(regex)) {
        if (!validate || validate(match[0])) {
          matches.push({
            start: match.index,
            end: match.index + match[0].length,
            category
          });
        }
      }
    }

    matches.sort((left, right) =>
      left.start - right.start || right.end - left.end
    );
    const accepted = [];
    for (const match of matches) {
      const previous = accepted[accepted.length - 1];
      if (previous && match.start < previous.end) continue;
      accepted.push(match);
    }

    const categories = [...new Set(accepted.map((match) => match.category))];
    let redacted = text;
    for (const match of [...accepted].reverse()) {
      redacted =
        redacted.slice(0, match.start) +
        `[REDACTED: ${match.category.toUpperCase()}]` +
        redacted.slice(match.end);
    }

    return { text: redacted, categories, count: accepted.length, matches: accepted };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { redactSensitiveText };
  } else {
    globalThis.VerifAIRedaction = Object.freeze({ redactSensitiveText });
  }
})();
