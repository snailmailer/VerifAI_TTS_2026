(function (root) {
  const categories = [
    "date of birth", "name", "street address", "email address",
    "Social Security number", "bank account number", "payment card number",
    "phone number", "Social Insurance number", "health card number",
    "driver's license number"
  ];
  function valid(event) {
    return Array.isArray(event.categories) && event.categories.length > 0 &&
      event.categories.length <= categories.length &&
      event.categories.every((value) => categories.includes(value)) &&
      new Set(event.categories).size === event.categories.length &&
      Number.isInteger(event.redactionCount) && event.redactionCount >= event.categories.length &&
      event.redactionCount <= 10000 && typeof event.editApplied === "boolean";
  }
  const api = { valid };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.VerifAIRedactionMetadata = api;
})(globalThis);
