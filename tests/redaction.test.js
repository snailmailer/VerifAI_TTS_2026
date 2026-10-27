const test = require("node:test");
const assert = require("node:assert/strict");
const { redactSensitiveText } = require("../redaction-core.js");

test("redacts birth dates stated with birthday context", () => {
  const result = redactSensitiveText("My birthday is October 25, 1990.");
  assert.equal(result.text, "[REDACTED: DATE OF BIRTH].");
  assert.deepEqual(result.categories, ["date of birth"]);
});

test("redacts self-identified names and street addresses", () => {
  const result = redactSensitiveText(
    "My name is Alex Doe. I live at 22 King Street, Apt 4."
  );
  assert.match(result.text, /\[REDACTED: NAME\]/);
  assert.match(result.text, /\[REDACTED: STREET ADDRESS\]/);
});

test("redacts numeric date of birth, email, and common identifiers", () => {
  const input =
    "DOB: 10/25/1990, email alex@example.com, SSN 123-45-6789, phone (416) 555-0198, card 4111 1111 1111 1111, account 123456789012";
  const result = redactSensitiveText(input);
  assert.match(result.text, /\[REDACTED: DATE OF BIRTH\]/);
  assert.match(result.text, /\[REDACTED: EMAIL ADDRESS\]/);
  assert.match(result.text, /\[REDACTED: SOCIAL SECURITY NUMBER\]/);
  assert.match(result.text, /\[REDACTED: PHONE NUMBER\]/);
  assert.match(result.text, /\[REDACTED: PAYMENT CARD NUMBER\]/);
  assert.match(result.text, /\[REDACTED: BANK ACCOUNT NUMBER\]/);
  assert.equal(result.categories.length, 6);
});

test("does not modify ordinary prompt text", () => {
  const input = "Summarize the themes in this public report.";
  assert.deepEqual(redactSensitiveText(input), { text: input, categories: [], count: 0, matches: [] });
});

test("returns ascending non-overlapping match offsets for editor range replacement", () => {
  const input = "SIN: 987-654-321 and test.person@example.com";
  const { matches } = redactSensitiveText(input);
  assert.deepEqual(matches.map((match) => input.slice(match.start, match.end)),
    ["SIN: 987-654-321", "test.person@example.com"]);
  assert.deepEqual(matches.map((match) => match.category), ["Social Insurance number", "email address"]);
  assert.ok(matches[0].end <= matches[1].start);
});

test("redacts case-insensitive name labels and common SSN and birthday formats", () => {
  for (const input of [
    "MY NAME IS alex doe.",
    "Full name: Alex Doe.",
    "Patient name = alex doe.",
    "First name: alex\nLast name: doe",
    "SSN: 123456789",
    "Social security number is 123456789",
    "SSN 123 45 6789",
    "My birthday is on October 25, 1990.",
    "Birth date: 1990-10-25",
    "D.O.B.: 25/10/1990"
  ]) {
    const result = redactSensitiveText(input);
    assert.ok(result.count > 0, input);
    assert.equal(redactSensitiveText(result.text).count, 0, "replacement is idempotent");
  }
  assert.equal(redactSensitiveText("Reference 123456789").count, 0);
});

test("redacts every field in a Canadian resident record without leaving address fragments", () => {
  const input = [
    "Resident: Émile-André Exemple",
    "SIN: 987-654-321",
    "Health Card Number (OHIP): 9999-888-777-ZZ",
    "Driver's License: Z9876-54321-09876",
    "Address: 200 Example St W, Toronto, ON M5V 0A1"
  ].join("\n");
  const result = redactSensitiveText(input);
  assert.equal(result.text, [
    "[REDACTED: NAME]",
    "[REDACTED: SOCIAL INSURANCE NUMBER]",
    "[REDACTED: HEALTH CARD NUMBER]",
    "[REDACTED: DRIVER'S LICENSE NUMBER]",
    "[REDACTED: STREET ADDRESS]"
  ].join("\n"));
  assert.equal(result.count, 5);
  assert.equal(require("../redaction-metadata.js").valid({
    categories: result.categories, redactionCount: result.count, editApplied: true
  }), true);
  assert.equal(redactSensitiveText(result.text).count, 0);
});

test("Canadian labels support common separators without consuming the next record", () => {
  for (const input of [
    "SIN 987654321", "Social Insurance Number: 987 654 321",
    "OHIP: 9999888777ZZ", "Health card: 9999 888 777",
    "Driver’s licence number: Z98765432109876",
    "Resident: E\u0301mile Exemple", "Address: 200 Example St W, Toronto, ON M5V 0A1"
  ]) {
    const result = redactSensitiveText(`${input}\nKeep this line.`);
    assert.equal(result.count, 1, input);
    assert.ok(result.text.endsWith("\nKeep this line."), input);
  }
  for (const input of ["SIN: not supplied", "OHIP program information",
    "Driver's license renewal instructions", "Address: not supplied"]) {
    assert.equal(redactSensitiveText(input).count, 0, input);
  }
});

test("redacts labeled Canadian banking fields using spaces, underscores, or hyphens", () => {
  const input = [
    "BANK_INSTITUTION: 003",
    "BANK_TRANSIT: 04122",
    "BANK_ACCOUNT: 88301924",
    "Keep this line."
  ].join("\n");
  const result = redactSensitiveText(input);
  assert.equal(result.text, [
    "[REDACTED: BANK INSTITUTION NUMBER]",
    "[REDACTED: BANK TRANSIT NUMBER]",
    "[REDACTED: BANK ACCOUNT NUMBER]",
    "Keep this line."
  ].join("\n"));
  assert.equal(result.count, 3);
  assert.deepEqual(result.categories, [
    "bank institution number",
    "bank transit number",
    "bank account number"
  ]);
  assert.equal(redactSensitiveText(result.text).count, 0);

  for (const field of [
    "Bank institution number: 003",
    "Bank transit number = 04122",
    "Bank account number: 88301924",
    "Transit: 04122",
    "Account: 88301924"
  ]) {
    assert.equal(redactSensitiveText(field).count, 1, field);
  }
});
